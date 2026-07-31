-- ============================================================
-- Covault — bring the database in line with the app
-- ============================================================
-- Run this whole file once in the Supabase SQL editor.
-- Every statement is idempotent; re-running it is safe.
--
-- WHAT THIS FIXES
--   1. Three settings columns the app writes that don't exist yet.
--   2. A contradictory DEFAULT on settings.subscription_status.
--   3. Partner linking, which cannot work under the current RLS policies.
--
-- READ THIS ABOUT (3): sections 1 and 2 take effect the moment you run this.
-- Section 3 installs the functions partner linking needs, but the app still
-- calls the old REST paths — so linking keeps failing until the matching client
-- change ships. Installing them now just means you only have to run SQL once.
-- ============================================================


-- ============================================================
-- 1. Missing settings columns
-- ============================================================
-- All three are in SETTING_DB_KEYS (components/Dashboard.tsx), so the app
-- PATCHes them today and gets PGRST204 back. saveSettingToDb only logs a failed
-- response, and the UI has already applied the change optimistically and
-- written it to localStorage — so the toggle looks like it worked, the setting
-- works on that device, and it silently never reaches the database. It doesn't
-- sync to a linked partner and is lost on reinstall.
--
-- The read path already tolerates their absence: useDataLoading requests them
-- in a separate select that falls back to the base column list, because
-- PostgREST 400s the entire select when any named column is unknown.

-- Smart notifications. Default true to match DEFAULT_SETTINGS in App.tsx and
-- the `?? true` read-side fallback, so existing users keep what they have.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS smart_notifications_enabled boolean NOT NULL DEFAULT true;

-- Auto-file known vendors. Default FALSE deliberately: this one files money
-- into a budget without ever showing it to the user, so it has to be something
-- they turned on, not something that appeared after an update.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS auto_accept_known_vendors boolean NOT NULL DEFAULT false;

-- Haptics. Default true — cosmetic, reversible, and the kind of feedback people
-- miss when it's absent but rarely go looking for.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS haptics_enabled boolean NOT NULL DEFAULT true;


-- ============================================================
-- 2. settings.subscription_status default
-- ============================================================
-- The column is `text DEFAULT false CHECK (subscription_status = ANY
-- (ARRAY['none','active','expired']))`. `DEFAULT false` on a text column
-- resolves to the string 'false', which the CHECK forbids. Postgres validates a
-- CHECK against existing rows when it's added but does NOT validate defaults,
-- so the contradiction is accepted at definition time and only fails later, on
-- the first INSERT that omits the column.
--
-- Not currently reachable: handle_new_user() names the column explicitly, and
-- the app only ever PATCHes /settings. This removes a landmine, not an outage.
ALTER TABLE public.settings
  ALTER COLUMN subscription_status SET DEFAULT 'none';

-- Repair any row written before the CHECK existed.
UPDATE public.settings
   SET subscription_status = 'none'
 WHERE subscription_status IS NOT NULL
   AND subscription_status NOT IN ('none', 'active', 'expired');


-- ============================================================
-- 3. Partner linking
-- ============================================================
-- WHY THIS IS BROKEN TODAY
--
-- settings has SELECT and UPDATE policies gated on `auth.uid() = user_id` —
-- own row only. But linking a partner has to touch the OTHER person's row:
--
--   * useHouseholdLinking.ts reads  /settings?link_code=eq.<CODE>  and
--     /settings?email=eq.<EMAIL> — rows belonging to someone else, so RLS
--     filters them out and the lookup reports "invalid or expired link code".
--   * It then PATCHes /settings?user_id=eq.<otherUserId> to write partner_id
--     onto their row, which matches zero rows.
--   * Unlink has the same problem: it clears its own row, but the PATCH that
--     clears the partner's row does nothing, so they stay linked to you.
--
-- WHY NOT JUST LOOSEN THE POLICIES
--
-- RLS decides row by row and cannot see the client's WHERE clause, so there is
-- no way to express "you may read this row only if you already knew its link
-- code". A policy permissive enough to make the current code work would let any
-- authenticated user read every account's name and email.
--
-- So the linking handshake moves into SECURITY DEFINER functions, which run
-- with the definer's rights and can therefore touch both rows — but only along
-- the exact path they implement. `SET search_path` is pinned on each one so a
-- caller cannot shadow the tables they reference.

-- ── Link by code (the consenting flow) ──────────────────────
-- The other user generates a code and gives it to you. Knowing the code is the
-- consent. The code is consumed on use.
CREATE OR REPLACE FUNCTION public.link_partner_by_code(p_code text)
RETURNS TABLE (partner_id uuid, partner_name text, partner_email text)
LANGUAGE plpgsql
SECURITY DEFINER
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
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'Invalid or expired link code';
  END IF;

  SELECT s.name, s.email INTO v_my_name, v_my_email
    FROM public.settings s WHERE s.user_id = v_me;

  -- Claim the code and write our side onto their row in one statement, so two
  -- people racing on the same code cannot both win: the second finds no row
  -- with that code still set.
  UPDATE public.settings s
     SET partner_id    = v_me,
         partner_name  = v_my_name,
         partner_email = v_my_email,
         link_code     = NULL
   WHERE upper(s.link_code) = upper(btrim(p_code))
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

-- ── Link by email ───────────────────────────────────────────
-- HEADS UP: this links the two accounts on one person's say-so — the other
-- party is never asked. That is what the app does today, so this preserves the
-- existing behaviour rather than quietly changing it. The guard below at least
-- stops you from hijacking someone who is already linked to somebody else.
-- If you would rather this required consent, say so and it can become a
-- request the other person accepts; the code flow above is already consenting.
CREATE OR REPLACE FUNCTION public.link_partner_by_email(p_email text)
RETURNS TABLE (partner_id uuid, partner_name text, partner_email text)
LANGUAGE plpgsql
SECURITY DEFINER
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
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'No Covault account found for that email';
  END IF;

  SELECT s.name, s.email INTO v_my_name, v_my_email
    FROM public.settings s WHERE s.user_id = v_me;

  SELECT s.user_id, s.name, s.email
    INTO v_other_id, v_other_name, v_other_email
    FROM public.settings s
   WHERE lower(s.email) = lower(btrim(p_email))
     AND s.user_id <> v_me
   LIMIT 1;

  IF v_other_id IS NULL THEN
    RAISE EXCEPTION 'No Covault account found for that email';
  END IF;

  -- Don't break an existing pairing.
  IF EXISTS (
    SELECT 1 FROM public.settings s
     WHERE s.user_id = v_other_id
       AND s.partner_id IS NOT NULL
       AND s.partner_id <> v_me
  ) THEN
    RAISE EXCEPTION 'That account is already linked to someone else';
  END IF;

  UPDATE public.settings s
     SET partner_id    = v_me,
         partner_name  = v_my_name,
         partner_email = v_my_email
   WHERE s.user_id = v_other_id;

  UPDATE public.settings s
     SET partner_id    = v_other_id,
         partner_name  = v_other_name,
         partner_email = v_other_email
   WHERE s.user_id = v_me;

  RETURN QUERY SELECT v_other_id, v_other_name, v_other_email;
END;
$$;

-- ── Unlink ──────────────────────────────────────────────────
-- Clears BOTH sides. Today the app clears its own row and silently fails to
-- clear the partner's, leaving them still pointing at you — so they keep seeing
-- your transactions and budgets through the partner SELECT policies.
CREATE OR REPLACE FUNCTION public.unlink_partner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_other uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT s.partner_id INTO v_other
    FROM public.settings s WHERE s.user_id = v_me;

  UPDATE public.settings s
     SET partner_id = NULL, partner_name = NULL, partner_email = NULL
   WHERE s.user_id = v_me;

  -- Only clear the other row if it actually points back at us, so this can
  -- never be used to detach two unrelated accounts.
  IF v_other IS NOT NULL THEN
    UPDATE public.settings s
       SET partner_id = NULL, partner_name = NULL, partner_email = NULL
     WHERE s.user_id = v_other
       AND s.partner_id = v_me;
  END IF;
END;
$$;

-- Signed-in users only. PUBLIC includes `anon`, which must not be able to
-- enumerate accounts by email.
REVOKE ALL ON FUNCTION public.link_partner_by_code(text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_partner_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlink_partner()            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.link_partner_by_code(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_partner_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_partner()            TO authenticated;


-- ============================================================
-- Verify
-- ============================================================
-- Expect three rows: auto_accept_known_vendors | false,
--                    haptics_enabled           | true,
--                    smart_notifications_enabled | true
SELECT column_name, data_type, column_default, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'settings'
   AND column_name IN ('smart_notifications_enabled',
                       'auto_accept_known_vendors',
                       'haptics_enabled')
 ORDER BY column_name;

-- Expect: 'none'::text
SELECT column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'settings'
   AND column_name  = 'subscription_status';

-- Expect three rows.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('link_partner_by_code', 'link_partner_by_email', 'unlink_partner')
 ORDER BY p.proname;
