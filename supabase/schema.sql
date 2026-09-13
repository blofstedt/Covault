-- ============================================================
-- COVAULT DATABASE SCHEMA — INTROSPECTED FROM PRODUCTION
-- ============================================================
-- This file is the canonical schema for the Covault project as it
-- actually exists in production. It was regenerated from PostgREST
-- introspection of the live https://<your-project-ref>.supabase.co project and
-- supplemented with the RLS policy intent from the original repo
-- files.
--
-- IMPORTANT: This file is the source of truth for what the live DB
-- looks like. If you change the DB, update this file. The CI drift
-- check (scripts/check_schema_drift.sh) compares the introspection
-- of the live DB against this file's expected shape and fails if
-- they diverge.
--
-- What this file is:
--   - A reference / spec of the live DB
--   - A starting point for a brand-new project
--   - A drift-detection target
--
-- What this file is NOT:
--   - A migration to apply on top of the live DB. Applying this on
--     the live DB will be a no-op (CREATE TABLE IF NOT EXISTS) for
--     everything and would only add what's missing.
--
-- Sections NOT introspected (intentional placeholders):
--   - Indexes (PostgREST does not expose index metadata)
--   - CHECK constraints beyond enum membership
--   - Triggers (e.g. on_auth_user_created, update_budgets_updated_at)
--   - Foreign keys (only user_id -> auth.users was inferable)
-- These are reconstructed from the original schema intent and
-- marked with "(RECONSTRUCTED)" comments.
-- ============================================================


-- ============================================================
-- ENUMS
-- ============================================================

-- The Budgets enum is referenced by transactions.budget and
-- overrides.category_id. RLS-restricted tables don't expose enum
-- type details via PostgREST, but the valid members were confirmed
-- by attempting inserts via the API.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Budgets') THEN
    CREATE TYPE public."Budgets" AS ENUM (
      'Housing', 'Groceries', 'Leisure', 'Utilities',
      'Transport', 'Services', 'Other',
      -- The later additions. They are seeded hidden into a vault that already
      -- has rows (OPT_IN_CATEGORIES in constants.ts) but they are ordinary
      -- members of the enum, and a database created without them rejects any
      -- transaction filed under one — silently, because the insert is the
      -- thing that fails rather than anything the user can see.
      'Shopping', 'Personal', 'Travel'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Type') THEN
    CREATE TYPE public."Type" AS ENUM ('Manual', 'Automatic');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Recurrence') THEN
    -- 'Yearly' was added by 2026_add_yearly_recurrence.sql. Leaving it out of
    -- a fresh database is not a cosmetic omission: the recurring-charge lookup
    -- FILTERS on the full list of cadences, and a filter naming a label the
    -- enum does not have fails the whole query — which is how that lookup
    -- returned 400 for months and saw no rows at all.
    CREATE TYPE public."Recurrence" AS ENUM ('One-time', 'Biweekly', 'Monthly', 'Yearly');
  END IF;
END $$;


-- ============================================================
-- 1. SETTINGS  (one row per user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settings (
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  partner_id uuid,
  partner_email text,
  partner_name text,
  budgeting_solo boolean DEFAULT true,
  monthly_income numeric DEFAULT 0 CHECK (monthly_income >= 0),
  rollover_enabled boolean DEFAULT true,
  leisure_buffer_enabled boolean DEFAULT true,
  show_savings_insight boolean DEFAULT true,
  app_notifications_enabled boolean DEFAULT false,
  -- Added by 2026_add_smart_notifications_column.sql. The app had been
  -- writing this since smart notifications shipped, but the column did not
  -- exist, so every toggle failed with PGRST204 and was only logged.
  smart_notifications_enabled boolean NOT NULL DEFAULT true,
  theme_selected text DEFAULT 'dark',
  trial_started_at timestamp with time zone,
  trial_ends_at timestamp with time zone,
  trial_consumed boolean DEFAULT false,
  -- The live DB has `DEFAULT false` (confirmed 2026-07-25), i.e. the text
  -- 'false', which is NOT in the CHECK set — Postgres does not validate
  -- defaults when a CHECK is added. It is currently unreachable: the only
  -- inserter is handle_new_user(), which names subscription_status explicitly,
  -- and the app only ever PATCHes this table. So it is a latent landmine, not
  -- an active bug — any future INSERT that omits the column would fail.
  -- 2026_fix_subscription_status_default.sql replaces it with 'none' below.
  subscription_status text DEFAULT 'none'
    CHECK (subscription_status = ANY (ARRAY['none', 'active', 'expired'])),
  link_code text,
  -- Added by 2026_08_01_sync_schema_to_app.sql. Off by default: auto-filing
  -- records a purchase the user never sees, so it has to be chosen.
  auto_accept_known_vendors boolean NOT NULL DEFAULT false,
  haptics_enabled boolean NOT NULL DEFAULT true,
  -- The shared vendor pool: take suggestions by default, volunteer nothing
  -- until asked. See lib/communityRules.ts.
  community_rules_enabled boolean NOT NULL DEFAULT true,
  community_rules_contribute boolean NOT NULL DEFAULT false,
  -- Closed-testing accounts, which skip the paywall.
  is_tester boolean NOT NULL DEFAULT false,
  CONSTRAINT settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT settings_email_key UNIQUE (email),
  CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id),
  CONSTRAINT settings_partner_id_fkey FOREIGN KEY (partner_id)
    REFERENCES auth.users(id)
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'settings' AND policyname = 'Users can view own settings') THEN
    CREATE POLICY "Users can view own settings" ON public.settings
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'settings' AND policyname = 'Users can view partner settings') THEN
    CREATE POLICY "Users can view partner settings" ON public.settings
      FOR SELECT TO authenticated
      USING (
        user_id IN (
          SELECT s.partner_id FROM public.settings s
          WHERE s.user_id = auth.uid() AND s.partner_id IS NOT NULL
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'settings' AND policyname = 'Users can insert own settings') THEN
    CREATE POLICY "Users can insert own settings" ON public.settings
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'settings' AND policyname = 'Users can update own settings') THEN
    CREATE POLICY "Users can update own settings" ON public.settings
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 2. TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor text NOT NULL,
  amount numeric NOT NULL,
  date date NOT NULL,
  is_projected boolean NOT NULL DEFAULT false,
  budget public."Budgets" NOT NULL,
  type public."Type" NOT NULL DEFAULT 'Manual',
  recur public."Recurrence" NOT NULL DEFAULT 'One-time',
  created_at timestamp with time zone DEFAULT now(),
  caught_cleared boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source = ANY (ARRAY['executor', 'notification', 'manual', 'import'])),
  confidence numeric,
  -- Added by 2026_add_refunded_column.sql / 2026_learned_rules_and_refunded.sql.
  refunded boolean NOT NULL DEFAULT false,
  -- Added by 2026_learned_rules_and_refunded.sql. Powers the capture
  -- reviewer's "View original notification" expander.
  raw_notification text,
  -- Filed by a learned rule without the user seeing it first. The reviewer
  -- separates these from the rows waiting on a decision — see
  -- lib/reviewQueue.ts, which is the single definition of "waiting".
  auto_filed boolean NOT NULL DEFAULT false,
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
);

-- (RECONSTRUCTED) Indexes based on original schema intent:
--   idx_transactions_user_id     ON (user_id)
--   idx_transactions_date        ON (date)
--   idx_transactions_user_vendor ON (user_id, vendor)
CREATE INDEX IF NOT EXISTS idx_transactions_user_id
  ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date
  ON public.transactions (date);
CREATE INDEX IF NOT EXISTS idx_transactions_user_vendor
  ON public.transactions (user_id, vendor);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'Users can view own transactions') THEN
    CREATE POLICY "Users can view own transactions" ON public.transactions
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'Users can insert own transactions') THEN
    CREATE POLICY "Users can insert own transactions" ON public.transactions
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'Users can update own transactions') THEN
    CREATE POLICY "Users can update own transactions" ON public.transactions
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'Users can delete own transactions') THEN
    CREATE POLICY "Users can delete own transactions" ON public.transactions
      FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  -- (LIVE ONLY) service_delete: lets the service role bypass RLS for
  -- maintenance. Created automatically by Supabase when the service role
  -- key is used. Documented here for completeness.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'transactions' AND policyname = 'service_delete') THEN
    -- No-op: this policy is created by Supabase itself; we just note its existence.
    NULL;
  END IF;
END $$;


-- ============================================================
-- 3. BUDGETS
-- ============================================================
-- Note: live DB has NO primary key on this table. Each row is
-- identified by the (user_uuid, budget) tuple. The app uses
-- `on_conflict=user_uuid,budget` upserts, so a unique index on
-- that pair is required for upsert semantics to work.
CREATE TABLE IF NOT EXISTS public.budgets (
  user_uuid uuid,
  budget public."Budgets",
  amount numeric,
  -- Quoted deliberately. An unquoted `Visible` folds to `visible`, but every
  -- write in the app sends the JSON key "Visible"
  -- (lib/hooks/useUserSettings.ts:81,141,428,486 and
  -- lib/hooks/useDataLoading.ts:49) and PostgREST matches column names
  -- case-sensitively. Creating a fresh project from an unquoted definition
  -- would make every budget-limit and visibility write fail with PGRST204.
  -- The `row.visible ?? row.Visible` fallback on the read path exists to
  -- tolerate both spellings; the write path does not have one.
  "Visible" boolean NOT NULL DEFAULT true,
  -- Live DB has a FK on user_uuid and NO primary key.
  CONSTRAINT budgets_user_uuid_fkey FOREIGN KEY (user_uuid)
    REFERENCES auth.users(id)
);

-- Required for the upsert at lib/hooks/useDataLoading.ts:53
-- (`on_conflict=user_uuid,budget`). Without a unique index or constraint on
-- exactly these columns Postgres raises 42P10; it does NOT degrade to a plain
-- insert (an earlier version of this comment said otherwise and was wrong).
--
-- In the live DB this is a bare UNIQUE INDEX, not a table constraint
-- (confirmed 2026-07-25). ON CONFLICT accepts either, so the upsert works —
-- but note that a plain schema export lists constraints and will appear to
-- show nothing here. It also prevents duplicate rows, which matters because
-- saveBudgetLimit writes via PATCH-then-plain-POST rather than an upsert.
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_budget
  ON public.budgets USING btree (user_uuid, budget);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'budgets' AND policyname = 'Users can view own budgets') THEN
    CREATE POLICY "Users can view own budgets" ON public.budgets
      FOR SELECT TO authenticated
      USING (auth.uid() = user_uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'budgets' AND policyname = 'Users can upsert own budgets') THEN
    CREATE POLICY "Users can upsert own budgets" ON public.budgets
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'budgets' AND policyname = 'Users can update own budgets') THEN
    CREATE POLICY "Users can update own budgets" ON public.budgets
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_uuid);
  END IF;
END $$;


-- ============================================================
-- 4. OVERRIDES  (vendor reclassification memory)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category_id public."Budgets" NOT NULL,
  proper_name text,
  match_key text,
  -- Both added by 2026_learned_rules_and_refunded.sql.
  match_type text NOT NULL DEFAULT 'exact'
    CHECK (match_type IN ('exact', 'prefix', 'contains')),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT overrides_pkey PRIMARY KEY (id),
  -- Live constraint name retains the table's former name.
  CONSTRAINT vendor_overrides_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
);

ALTER TABLE public.overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'overrides' AND policyname = 'Users can view own overrides') THEN
    CREATE POLICY "Users can view own overrides" ON public.overrides
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'overrides' AND policyname = 'Users can insert own overrides') THEN
    CREATE POLICY "Users can insert own overrides" ON public.overrides
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'overrides' AND policyname = 'Users can update own overrides') THEN
    CREATE POLICY "Users can update own overrides" ON public.overrides
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- 5. BANKS  (banking app display name lookup)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.banks (
  package_name text NOT NULL,
  display_name text NOT NULL,
  CONSTRAINT banks_pkey PRIMARY KEY (package_name)
);

ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'banks' AND policyname = 'Anyone can read Banking') THEN
    CREATE POLICY "Anyone can read banks" ON public.banks
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;


-- ============================================================
-- 6. NOTIFICATION_RULES  (trained "not a transaction" skip patterns)
-- ============================================================
-- Confirmed present in the live DB (2026-07-25). Read by
-- lib/notificationRules.ts (checkNotificationRules, listNotificationRules)
-- and written by createNotificationRule / deleteNotificationRule /
-- bumpRuleUseCount.
--
-- The app has NO fallback if this table is missing: a failed fetch is
-- treated as "no rules", so trained skip patterns would silently stop
-- applying and filtered notifications would start being captured again.
CREATE TABLE IF NOT EXISTS public.notification_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pattern text NOT NULL,
  -- Matches NotATxRuleType in components/transaction_parsing/NotATransactionModal.tsx
  -- ('exact' | 'contains'). Note this is a NARROWER set than
  -- overrides.match_type, which also allows 'prefix'.
  pattern_type text NOT NULL DEFAULT 'exact'
    CHECK (pattern_type = ANY (ARRAY['exact', 'contains'])),
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  -- Added by 2026_09_skip_rule_recent_uses.sql. The last few alerts this rule
  -- actually silenced, newest first, trimmed to five by the app. A skip rule
  -- works by making things disappear, so this is the only evidence there is
  -- about what one has been doing.
  recent_uses jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Added by 2026_09_skip_rule_source_text.sql. The whole alert the rule was
  -- made from; `pattern` may be a span of a few words out of it.
  source_text text,
  CONSTRAINT notification_rules_pkey PRIMARY KEY (id),
  CONSTRAINT notification_rules_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
);

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 7. COMMUNITY_RULES  (the shared vendor pool, read side)
-- ============================================================
-- One row per merchant slug: where most households file it, and how much
-- they agree. Every household may read the whole table — that is the point
-- of it — and nobody may write it from the client; it is derived from
-- rule_contributions below. See lib/communityRules.ts.
CREATE TABLE IF NOT EXISTS public.community_rules (
  match_key text NOT NULL,
  category_id public."Budgets" NOT NULL,
  household_count integer NOT NULL,
  agreement numeric NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT community_rules_pkey PRIMARY KEY (match_key)
);

CREATE INDEX IF NOT EXISTS idx_community_rules_key
  ON public.community_rules (match_key);

ALTER TABLE public.community_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'community_rules'
                   AND policyname = 'Anyone can read community rules') THEN
    CREATE POLICY "Anyone can read community rules" ON public.community_rules
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;


-- ============================================================
-- 8. RULE_CONTRIBUTIONS  (the shared vendor pool, write side)
-- ============================================================
-- What one household has volunteered about a merchant. Deliberately
-- write-only from the client: there is INSERT, UPDATE and DELETE for your own
-- rows and NO select policy at all, so no household can read what another has
-- contributed. What comes back out is the aggregate in community_rules.
--
-- Losing that asymmetry would turn an anonymous pool into a way of asking
-- "where does this person shop", so a SELECT policy must never be added here.
CREATE TABLE IF NOT EXISTS public.rule_contributions (
  user_id uuid NOT NULL,
  match_key text NOT NULL,
  category_id public."Budgets" NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rule_contributions_pkey PRIMARY KEY (user_id, match_key),
  CONSTRAINT rule_contributions_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rule_contributions_match_key
  ON public.rule_contributions (match_key);

ALTER TABLE public.rule_contributions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'rule_contributions'
                   AND policyname = 'Households can contribute') THEN
    CREATE POLICY "Households can contribute" ON public.rule_contributions
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'rule_contributions'
                   AND policyname = 'Households can amend their contribution') THEN
    CREATE POLICY "Households can amend their contribution" ON public.rule_contributions
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'rule_contributions'
                   AND policyname = 'Households can withdraw') THEN
    CREATE POLICY "Households can withdraw" ON public.rule_contributions
      FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;


-- ============================================================
-- PENDING_TRANSACTIONS — DOES NOT EXIST IN THE LIVE DB
-- ============================================================
-- Still absent, re-confirmed 2026-09-13 by listing the live schema: the
-- tables are banks, budgets, community_rules, notification_rules, overrides,
-- rule_contributions, settings and transactions. The app still references it:
--   lib/hooks/useDataLoading.ts    (loadPendingTransactions — the read)
--   lib/hooks/useTransactionOps.ts (approve / reject / clear-filtered)
--
-- Its absence is tolerated on the read path — loadPendingTransactions treats
-- a 404 as an empty queue — so the app runs without it. In practice the
-- separate review queue is inert and captured transactions land directly in
-- `transactions`, which is what the review UI reads.
--
-- Worth being precise about what "dead" means here, because it is stronger
-- than it looks: the read can never return a row, so appState.pendingTransactions
-- is permanently empty, so the approve/reject/clear handlers built on it are
-- unreachable rather than merely failing. Removing them is a deletion of a
-- feature surface, not a tidy-up, which is why it is still a decision and not
-- something to do in passing.
--
-- Decide one of:
--   a) create the table, if the pending/approve flow is still wanted; or
--   b) remove the dead references above.
-- Leaving it as-is means those insert/patch calls fail on every captured
-- notification and are swallowed.
-- ============================================================


-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create a settings row when a new user signs up. The
-- original schema also set monthly_income=5000 and a 14-day trial;
-- the live DB's handle_new_user may not. This trigger is preserved
-- here for documentation; verify the live DB version matches before
-- relying on it.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.settings (user_id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name',
             split_part(NEW.email, '@', 1),
             'User'),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- DEAD CODE — flagged for cleanup
-- ============================================================
-- The following exist in the live DB but are not used by the app:
--   - public.get_my_partner_id (RPC)  — references missing
--     public.profiles table, fails on call
--   - public.generate_transaction_hash (RPC)  — not called
--     by the app or tests
--
-- Drop them by running the snippet in
-- supabase/migrations/2026_cleanup_dead_rpcs.sql.
-- ============================================================
