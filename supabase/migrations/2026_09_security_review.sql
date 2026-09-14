-- Migration: what a security review of the partner features turned up.
--
-- Four separate problems, all in the same corner of the app, all of them the
-- kind that fail in silence. Safe to run more than once.
--
-- 1. A PARTNER LINK WAS ONE-SIDED WHERE IT MATTERED.
--    `settings.partner_id` is a column on YOUR OWN row, and the settings
--    UPDATE policy is `auth.uid() = user_id` — so any signed-in account could
--    PATCH its own partner_id to any user id it liked. The partner SELECT
--    policies on `budgets` and `overrides` asked only "is this row's owner the
--    person I say is my partner", so pointing that column at a stranger handed
--    over their budget limits, their hidden categories and every vendor rule
--    they had ever taught — which is a list of the merchants they shop at.
--    Nobody was asked and nobody was told. The link code exists precisely so
--    that handing it over IS the permission; this went around it.
--
--    The fix is `linked_partner_id()` below: a partner is only a partner when
--    BOTH rows point at each other, which is the state `link_partner_by_code`
--    creates and `unlink_partner` clears. It has to be SECURITY DEFINER —
--    checking that their row points back at you means reading their settings
--    row, which RLS on `settings` rightly forbids.
--
-- 2. PARTNER TRANSACTION SHARING COULD NEVER RETURN A ROW.
--    The policy added with `share_level` asked
--    `EXISTS (SELECT 1 FROM settings owner WHERE owner.user_id = ... )` — a
--    sub-select against `settings`, which is itself RLS'd to your own row. A
--    policy's sub-selects are subject to the referenced table's own policies,
--    so that EXISTS was false for every partner, always. Verified against a
--    throwaway copy of the schema: a correct, mutual link with the owner's
--    share_level at 'transactions' still showed the partner zero rows. Same
--    SECURITY DEFINER fix.
--
-- 3. DELETING YOUR ACCOUNT LEFT YOUR DATA BEHIND.
--    `delete_own_account` removed `budgets` and `notification_rules`, then
--    deleted the auth user. There is not one foreign key in this schema, so
--    nothing cascaded: every transaction, every vendor rule, every community
--    contribution and the settings row itself stayed in the database forever,
--    keyed to a user id that no longer exists and that nobody can ever
--    authenticate as to delete them. Google Play requires account deletion to
--    actually delete the account's data, so this was a store blocker as well
--    as a privacy one.
--
-- 4. LINK CODES WERE GUESSABLE AND NEVER EXPIRED.
--    The client minted them with `Math.random().toString(36).substring(2, 8)`.
--    Math.random is not a cryptographic generator, that slice is not always
--    six characters (Math.random() can return a value whose base-36 form is
--    short, and the code comes out shorter with it), nothing checked the code
--    was unique, and once written it sat on the row until somebody claimed it.
--    Minting now happens in the database from `gen_random_bytes`, on an
--    alphabet with no 0/O or 1/I/L to misread, unique by construction, and
--    good for thirty minutes.

-- ---------------------------------------------------------------------------
-- 1 + 2. A partner is someone whose row points back at you.

CREATE OR REPLACE FUNCTION public.linked_partner_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT mine.partner_id
    FROM public.settings mine
    JOIN public.settings theirs ON theirs.user_id = mine.partner_id
   WHERE mine.user_id = auth.uid()
     AND mine.partner_id IS NOT NULL
     AND theirs.partner_id = mine.user_id;
$$;

COMMENT ON FUNCTION public.linked_partner_id() IS
  'The mutually-confirmed partner of the calling user, or NULL. SECURITY '
  'DEFINER because confirming the other row points back requires reading it. '
  'Every partner SELECT policy goes through this — a one-sided partner_id is '
  'not a link.';

-- Your partner's own answer to "how much of my spending do they see". Asked of
-- the OWNER of the rows, never of the reader, so a screen that forgets to
-- check cannot leak anything the owner did not offer.
CREATE OR REPLACE FUNCTION public.partner_share_level()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.share_level FROM public.settings s WHERE s.user_id = public.linked_partner_id();
$$;

-- Transactions: mutual link AND the owner sharing at the row level.
DROP POLICY IF EXISTS "Users can view partner transactions" ON public.transactions;
CREATE POLICY "Users can view partner transactions" ON public.transactions
  FOR SELECT TO authenticated
  USING (
    user_id = public.linked_partner_id()
    AND public.partner_share_level() = 'transactions'
  );

-- Vendor rules name merchants, which is exactly what share_level below
-- 'transactions' is for hiding. They follow the same gate as the rows
-- themselves. The cost when a partner shares less: their rules stop being
-- borrowed to categorise your captures, so a capture lands in Review instead
-- of filing itself. That is the right way round.
DROP POLICY IF EXISTS "Users can view partner overrides" ON public.overrides;
CREATE POLICY "Users can view partner overrides" ON public.overrides
  FOR SELECT TO authenticated
  USING (
    user_id = public.linked_partner_id()
    AND public.partner_share_level() = 'transactions'
  );

-- Budget limits are not spending — they are the lines the household draws, and
-- 'combined' budget mode needs both sides' at every share level. Mutual link
-- only.
DROP POLICY IF EXISTS "Users can view partner budgets" ON public.budgets;
CREATE POLICY "Users can view partner budgets" ON public.budgets
  FOR SELECT TO authenticated
  USING (user_uuid = public.linked_partner_id());

-- The two RPCs that answer for a partner should agree with the policies rather
-- than re-deriving the link themselves.
CREATE OR REPLACE FUNCTION public.partner_monthly_income()
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.monthly_income FROM public.settings s WHERE s.user_id = public.linked_partner_id();
$$;

CREATE OR REPLACE FUNCTION public.partner_month_summary(p_month text)
RETURNS TABLE (share_level text, budget text, total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_partner uuid; v_level text;
BEGIN
  IF p_month IS NULL OR p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Month must look like 2026-09';
  END IF;
  v_partner := public.linked_partner_id();
  IF v_partner IS NULL THEN RETURN; END IF;
  v_level := public.partner_share_level();
  IF v_level IS NULL OR v_level = 'transactions' THEN RETURN; END IF;

  IF v_level = 'categories' THEN
    RETURN QUERY
      SELECT v_level, t.budget::text, SUM(t.amount)::numeric
        FROM public.transactions t
       WHERE t.user_id = v_partner AND to_char(t.date, 'YYYY-MM') = p_month
         AND t.is_projected = false
       GROUP BY t.budget;
  ELSE
    RETURN QUERY
      SELECT v_level, NULL::text, COALESCE(SUM(t.amount), 0)::numeric
        FROM public.transactions t
       WHERE t.user_id = v_partner AND to_char(t.date, 'YYYY-MM') = p_month
         AND t.is_projected = false;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_household_budget_mode(p_mode text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_me uuid := auth.uid(); v_partner uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_mode NOT IN ('separate', 'combined') THEN RAISE EXCEPTION 'Unknown budget mode'; END IF;
  v_partner := public.linked_partner_id();
  UPDATE public.settings s SET budget_mode = p_mode WHERE s.user_id = v_me;
  IF v_partner IS NOT NULL THEN
    UPDATE public.settings s SET budget_mode = p_mode WHERE s.user_id = v_partner;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1 (second half). The columns that decide who your partner is, and whether
-- you have paid, are not the client's to write.
--
-- Every column left out below is written either by a SECURITY DEFINER function
-- (which runs as the table's owner and is unaffected by these grants) or by
-- the signup trigger. Before this, a PATCH of `{"is_tester": true}` from any
-- signed-in account unlocked the app permanently, and
-- `{"trial_ends_at": "2099-01-01"}` did the same thing with a longer name. The
-- paywall still is not proof against a determined person — that needs a
-- verified Play purchase — but it should at least not be one REST call.
--
-- It has to be done in this order. A column-level REVOKE does nothing while
-- the role still holds UPDATE on the whole table: table-level UPDATE already
-- covers every column, including ones added later. So the table grant goes
-- first and the columns the app legitimately writes are handed back by name.
-- A column added in future is NOT writable by the client until it is added
-- here — which is the safe direction to fail, but it is also exactly how a
-- new setting silently stops sticking. See the "a setting doesn't stick"
-- row in CLAUDE.md.
REVOKE UPDATE ON public.settings FROM authenticated;
GRANT UPDATE (
  name, email,
  budgeting_solo, monthly_income,
  rollover_enabled, leisure_buffer_enabled, show_savings_insight,
  app_notifications_enabled, smart_notifications_enabled,
  auto_accept_known_vendors, haptics_enabled,
  community_rules_enabled, community_rules_contribute,
  theme_selected,
  -- Yours alone to set, and deliberately not symmetric — it is your data.
  share_level
) ON public.settings TO authenticated;
-- budget_mode is deliberately absent: it belongs to the household, not to one
-- row, and set_household_budget_mode writes both sides. A client able to PATCH
-- its own would let the two rows disagree about which budgets the vials draw.

-- ---------------------------------------------------------------------------
-- 3. Deleting the account deletes the account's data.

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Detach anyone still pointing at us first, so no row is left claiming a
  -- partner who no longer exists.
  UPDATE public.settings
     SET partner_id = NULL, partner_name = NULL, partner_email = NULL
   WHERE partner_id = v_me;

  -- There are no foreign keys in this schema, so nothing here cascades and
  -- every table has to be named. A table added later and forgotten here
  -- outlives the account that made it.
  DELETE FROM public.transactions       WHERE user_id   = v_me;
  DELETE FROM public.overrides          WHERE user_id   = v_me;
  DELETE FROM public.rule_contributions WHERE user_id   = v_me;
  DELETE FROM public.notification_rules WHERE user_id   = v_me;
  DELETE FROM public.budgets            WHERE user_uuid = v_me;
  DELETE FROM public.settings           WHERE user_id   = v_me;

  DELETE FROM auth.users WHERE id = v_me;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Link codes are minted in the database, and they go stale.

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS link_code_expires_at timestamptz;

-- Any code minted before this migration has no expiry and was made by the old
-- generator. Clearing them costs one tap to mint a new one and closes the
-- window on every code ever handed out.
UPDATE public.settings SET link_code = NULL WHERE link_code IS NOT NULL AND link_code_expires_at IS NULL;

CREATE OR REPLACE FUNCTION public.generate_link_code()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- No 0/O, no 1/I/L. The code is read off one person's screen and typed into
  -- another's, so a character that can be misread is a support problem.
  v_alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_me uuid := auth.uid();
  v_code text;
  v_try int := 0;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  LOOP
    v_try := v_try + 1;
    IF v_try > 20 THEN RAISE EXCEPTION 'Could not mint a link code'; END IF;

    SELECT string_agg(substr(v_alphabet, 1 + (get_byte(b.bytes, i) % length(v_alphabet)), 1), '')
      INTO v_code
      -- pgcrypto lives in the `extensions` schema on Supabase, not `public`,
      -- so this has to be qualified: the pinned search_path that makes a
      -- SECURITY DEFINER function safe is exactly what keeps it out of reach.
      FROM (SELECT extensions.gen_random_bytes(8) AS bytes) b,
           generate_series(0, 7) AS i;

    -- Unique among codes that are still live. Two accounts holding the same
    -- code would make "claim the row with this code" ambiguous.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.settings s
       WHERE s.link_code = v_code AND s.link_code_expires_at > now()
    );
  END LOOP;

  UPDATE public.settings s
     SET link_code = v_code, link_code_expires_at = now() + interval '30 minutes'
   WHERE s.user_id = v_me;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_partner_by_code(p_code text)
RETURNS TABLE(partner_id uuid, partner_name text, partner_email text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me          uuid := auth.uid();
  v_my_name     text;
  v_my_email    text;
  v_other_id    uuid;
  v_other_name  text;
  v_other_email text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'Invalid or expired link code';
  END IF;

  SELECT s.name, s.email INTO v_my_name, v_my_email
    FROM public.settings s WHERE s.user_id = v_me;

  -- Claim the code and write our side onto their row in one statement, so two
  -- people racing on the same code cannot both win: the second finds no row
  -- with that code still set.
  UPDATE public.settings s
     SET partner_id           = v_me,
         partner_name         = v_my_name,
         partner_email        = v_my_email,
         link_code            = NULL,
         link_code_expires_at = NULL
   WHERE upper(s.link_code) = upper(btrim(p_code))
     AND s.link_code_expires_at > now()
     AND s.user_id <> v_me
  RETURNING s.user_id, s.name, s.email
       INTO v_other_id, v_other_name, v_other_email;

  IF v_other_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired link code';
  END IF;

  UPDATE public.settings s
     SET partner_id    = v_other_id,
         partner_name  = v_other_name,
         partner_email = v_other_email
   WHERE s.user_id = v_me;

  RETURN QUERY SELECT v_other_id, v_other_name, v_other_email;
END;
$$;

-- ---------------------------------------------------------------------------
-- Housekeeping the advisor asked for.

-- Your own contributions to the shared rule pool were writable but not
-- readable — there was no SELECT policy at all, so the app could never show
-- you what it had contributed on your behalf.
DROP POLICY IF EXISTS "Households can see their own contributions" ON public.rule_contributions;
CREATE POLICY "Households can see their own contributions" ON public.rule_contributions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Nothing in this app is read before signing in. RLS already refused anon on
-- every table except `banks`; this stops the tables being listed at all.
REVOKE ALL ON public.transactions       FROM anon;
REVOKE ALL ON public.settings           FROM anon;
REVOKE ALL ON public.budgets            FROM anon;
REVOKE ALL ON public.overrides          FROM anon;
REVOKE ALL ON public.notification_rules FROM anon;
REVOKE ALL ON public.rule_contributions FROM anon;
REVOKE ALL ON public.community_rules    FROM anon;
REVOKE ALL ON public.banks              FROM anon;

-- `banks` is a public lookup list of banking apps, but it was readable by the
-- anonymous role through a `TO public` policy. Signed-in users only.
DROP POLICY IF EXISTS "Anyone can read Banking" ON public.banks;
CREATE POLICY "Signed-in users can read the bank list" ON public.banks
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON FUNCTION public.linked_partner_id()      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_share_level()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_link_code()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_own_account()     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_partner_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.linked_partner_id()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_share_level() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_link_code()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_account()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_partner_by_code(text) TO authenticated;
