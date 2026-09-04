-- Collaborative vendor rules: the household layer and the community pool.
--
-- Three separate things, in one migration because they are one feature:
--
--   1. A partner may READ your rules. Copied verbatim in shape from the
--      partner policies already live on `transactions` and `budgets` — "rows
--      whose owner is the partner_id on my own settings row". Nothing else
--      about `overrides` changes: a partner still cannot write, update or
--      delete your rules.
--
--   2. `rule_contributions` — what a household has volunteered to the pool.
--      WRITE-ONLY from the client, deliberately: there is an INSERT policy and
--      a DELETE policy and NO SELECT policy at all, so a phone can add its own
--      pairs and take them back, and no client can ever enumerate what anyone
--      else contributed. The aggregation below runs as SECURITY DEFINER and is
--      the only reader.
--
--   3. `community_rules` — the published tally, and the only part any client
--      reads. Globally readable, writable by nobody (service role only),
--      exactly like `public.banks`.
--
-- What a contribution contains is the whole privacy argument: a merchant slug
-- and one of seven fixed category names. No amount, no date, no bank, no
-- notification text, no vendor spelling of the user's own, and no indication
-- of how often anybody shops anywhere.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The household layer
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'overrides'
      AND policyname = 'Users can view partner overrides'
  ) THEN
    CREATE POLICY "Users can view partner overrides" ON public.overrides
      FOR SELECT TO authenticated
      USING (
        user_id IN (
          SELECT s.partner_id FROM public.settings s
          WHERE s.user_id = auth.uid() AND s.partner_id IS NOT NULL
        )
      );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Contributions to the pool
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rule_contributions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_key text NOT NULL,
  category_id public."Budgets" NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  -- One opinion per household per merchant. Teaching the same merchant a
  -- second category REPLACES the contribution rather than stuffing the ballot
  -- box, which is what makes the household count below meaningful.
  CONSTRAINT rule_contributions_pkey PRIMARY KEY (user_id, match_key)
);

ALTER TABLE public.rule_contributions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- INSERT and UPDATE, so a phone can volunteer a pair and change its mind.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rule_contributions' AND policyname = 'Households can contribute') THEN
    CREATE POLICY "Households can contribute" ON public.rule_contributions
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rule_contributions' AND policyname = 'Households can amend their contribution') THEN
    CREATE POLICY "Households can amend their contribution" ON public.rule_contributions
      FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  -- Withdrawal has to be real, or the opt-in was never a meaningful choice.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rule_contributions' AND policyname = 'Households can withdraw') THEN
    CREATE POLICY "Households can withdraw" ON public.rule_contributions
      FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;

  -- NO SELECT POLICY, ON PURPOSE. Do not add one. With RLS enabled and no
  -- SELECT policy, every client read returns zero rows — which is what makes
  -- "a phone can never enumerate another household's contributions" a property
  -- of the database rather than a promise about the app. An UPDATE policy
  -- cannot leak rows either: it can only rewrite rows the caller already owns.
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The published pool
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.community_rules (
  match_key text NOT NULL,
  category_id public."Budgets" NOT NULL,
  household_count integer NOT NULL,
  agreement numeric NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT community_rules_pkey PRIMARY KEY (match_key)
);

ALTER TABLE public.community_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'community_rules' AND policyname = 'Anyone can read community rules') THEN
    -- Readable by every signed-in user, writable by none of them. The same
    -- shape as public.banks, which is the app's existing globally-shipped
    -- lookup table.
    CREATE POLICY "Anyone can read community rules" ON public.community_rules
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. The tally
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Publishes a merchant only when the answer is decisive: at least
-- MIN_HOUSEHOLDS separate households have taught it, and one category holds at
-- least MIN_AGREEMENT of them. A split vote publishes NOTHING for that
-- merchant — silence is the correct answer to a genuinely ambiguous merchant,
-- and it is also what keeps a rare merchant (which is to say, an identifying
-- one) out of the pool entirely.
--
-- Households, not users: a couple sharing a vault is one opinion. The pairing
-- is re-derived here on every run rather than stamped onto the contribution,
-- so two people who link accounts next month stop counting twice from the next
-- refresh, with nothing to migrate.
CREATE OR REPLACE FUNCTION public.refresh_community_rules()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  MIN_HOUSEHOLDS constant integer := 5;
  MIN_AGREEMENT  constant numeric := 0.7;
  -- Categories too revealing to aggregate, whatever the household count. The
  -- vocabulary has none today; if a health-shaped category is ever added to
  -- the Budgets enum it belongs here on the same day.
  EXCLUDED_CATEGORIES constant public."Budgets"[] := ARRAY[]::public."Budgets"[];
BEGIN
  DELETE FROM public.community_rules;

  WITH households AS (
    -- One row per (household, merchant, category). A household is identified
    -- by the lower of the two linked ids so both partners collapse onto the
    -- same key regardless of which of them taught the rule.
    SELECT DISTINCT
      COALESCE(LEAST(c.user_id, s.partner_id), c.user_id) AS household_key,
      c.match_key,
      c.category_id
    FROM public.rule_contributions c
    LEFT JOIN public.settings s ON s.user_id = c.user_id
    WHERE c.match_key <> ''
      AND c.category_id <> ALL (EXCLUDED_CATEGORIES)
  ),
  tally AS (
    SELECT
      match_key,
      category_id,
      COUNT(*) AS votes,
      SUM(COUNT(*)) OVER (PARTITION BY match_key) AS total_votes,
      ROW_NUMBER() OVER (PARTITION BY match_key ORDER BY COUNT(*) DESC, category_id) AS rank
    FROM households
    GROUP BY match_key, category_id
  )
  -- Rebuilt outright rather than merged. A merchant that stops being decisive
  -- — because contributions were withdrawn, or because opinion split — has to
  -- DISAPPEAR, not stand at its last known answer, and a rebuild inside one
  -- transaction is the version of that with nothing to get wrong. The table is
  -- a few thousand short rows.
  INSERT INTO public.community_rules (match_key, category_id, household_count, agreement, updated_at)
  SELECT
    match_key,
    category_id,
    total_votes::integer,
    ROUND(votes::numeric / total_votes, 3),
    now()
  FROM tally
  WHERE rank = 1
    AND total_votes >= MIN_HOUSEHOLDS
    AND votes::numeric / total_votes >= MIN_AGREEMENT;
END $$;

REVOKE ALL ON FUNCTION public.refresh_community_rules() FROM PUBLIC;
-- Deliberately NOT granted to `authenticated`: the tally is recomputed by a
-- scheduled job running as the service role, never on demand by a client. A
-- client that could trigger a refresh could time it against its own
-- contribution and learn something about the size of the pool.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. The two switches
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Separate columns because they are separate acts. Using the pool is on by
-- default: you receive a suggestion and nothing about you leaves. Contributing
-- is off by default and stays off until somebody deliberately turns it on.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS community_rules_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS community_rules_contribute boolean NOT NULL DEFAULT false;

-- Serving the pack: every client reads the whole table, ordered, once a week.
CREATE INDEX IF NOT EXISTS idx_community_rules_key ON public.community_rules (match_key);
-- The aggregation groups by merchant across all households.
CREATE INDEX IF NOT EXISTS idx_rule_contributions_match_key ON public.rule_contributions (match_key);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Running the tally
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Nothing calls refresh_community_rules() on its own. Until something does, the
-- published table stays empty and every client simply gets no community answer
-- — which is the correct behaviour for an empty pool, and the reason the whole
-- layer is written to fail closed rather than to assume it has data.
--
-- To start it, enable pg_cron on the project and schedule it daily. Deliberately
-- left commented out: enabling an extension is a decision about the project, not
-- something a feature migration should make on its owner's behalf.
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule(
--     'refresh-community-rules',
--     '17 4 * * *',
--     $$SELECT public.refresh_community_rules()$$
--   );
--
-- Once a day is generous: the pool moves in weeks, the pack on each phone is
-- refreshed daily, and a tally that changed its mind hourly would be a tally
-- worth ignoring.
