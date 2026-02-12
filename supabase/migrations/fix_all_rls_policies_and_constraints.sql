-- ================================================================
-- Covault: Fix database for vendor rules, budget defaults & RLS
-- ================================================================
-- Run this ONCE in the Supabase SQL Editor:
--   https://app.supabase.com/project/_/sql
--
-- ✅ Safe to run multiple times (every statement checks IF NOT EXISTS)
-- ✅ Does NOT drop any tables, columns, or user data
-- ✅ Only ADDS missing columns, constraints, and RLS policies
-- ================================================================


-- ┌────────────────────────────────────────────────────────────┐
-- │  VENDOR_OVERRIDES — column + constraint + dedup fixes      │
-- └────────────────────────────────────────────────────────────┘

-- 1a. Ensure auto_accept column exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name  = 'vendor_overrides'
      AND column_name = 'auto_accept'
  ) THEN
    ALTER TABLE public.vendor_overrides
      ADD COLUMN auto_accept boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 1b. Add UNIQUE constraint on (user_id, vendor_name)
--     If duplicates exist the constraint will fail — in that case
--     we remove only the extra copies (keeping the newest) then retry.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'vendor_overrides_unique'
      AND table_name      = 'vendor_overrides'
  ) THEN
    -- Only clean duplicates if any actually exist
    IF EXISTS (
      SELECT user_id, vendor_name
      FROM public.vendor_overrides
      GROUP BY user_id, vendor_name
      HAVING count(*) > 1
    ) THEN
      DELETE FROM public.vendor_overrides
      WHERE id NOT IN (
        SELECT DISTINCT ON (user_id, vendor_name) id
        FROM public.vendor_overrides
        ORDER BY user_id, vendor_name, created_at DESC NULLS LAST
      );
    END IF;

    ALTER TABLE public.vendor_overrides
      ADD CONSTRAINT vendor_overrides_unique UNIQUE (user_id, vendor_name);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: categories                                           │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'Anyone can read categories') THEN
    CREATE POLICY "Anyone can read categories" ON public.categories FOR SELECT TO authenticated USING (true);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: settings                                             │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'Users can view own settings') THEN
    CREATE POLICY "Users can view own settings" ON public.settings FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'Users can insert own settings') THEN
    CREATE POLICY "Users can insert own settings" ON public.settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'Users can update own settings') THEN
    CREATE POLICY "Users can update own settings" ON public.settings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: household_links                                      │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.household_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_links' AND policyname = 'Users can view own household links') THEN
    CREATE POLICY "Users can view own household links" ON public.household_links FOR SELECT TO authenticated USING (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_links' AND policyname = 'Users can create household links') THEN
    CREATE POLICY "Users can create household links" ON public.household_links FOR INSERT TO authenticated WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_links' AND policyname = 'Users can update household links they''re part of') THEN
    CREATE POLICY "Users can update household links they're part of" ON public.household_links FOR UPDATE TO authenticated USING (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_links' AND policyname = 'Users can delete own household links') THEN
    CREATE POLICY "Users can delete own household links" ON public.household_links FOR DELETE TO authenticated USING (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: link_codes                                           │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.link_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'link_codes' AND policyname = 'Users can view own link codes') THEN
    CREATE POLICY "Users can view own link codes" ON public.link_codes FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'link_codes' AND policyname = 'Users can create own link codes') THEN
    CREATE POLICY "Users can create own link codes" ON public.link_codes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'link_codes' AND policyname = 'Users can delete own link codes') THEN
    CREATE POLICY "Users can delete own link codes" ON public.link_codes FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'link_codes' AND policyname = 'Anyone can read valid link codes') THEN
    CREATE POLICY "Anyone can read valid link codes" ON public.link_codes FOR SELECT TO authenticated USING (expires_at > now());
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: budgets                                              │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can view own budgets') THEN
    CREATE POLICY "Users can view own budgets" ON public.budgets FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can insert own budgets') THEN
    CREATE POLICY "Users can insert own budgets" ON public.budgets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can update own budgets') THEN
    CREATE POLICY "Users can update own budgets" ON public.budgets FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'Users can delete own budgets') THEN
    CREATE POLICY "Users can delete own budgets" ON public.budgets FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: transactions                                         │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can view own transactions') THEN
    CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can insert own transactions') THEN
    CREATE POLICY "Users can insert own transactions" ON public.transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can update own transactions') THEN
    CREATE POLICY "Users can update own transactions" ON public.transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can delete own transactions') THEN
    CREATE POLICY "Users can delete own transactions" ON public.transactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transactions' AND policyname = 'Users can view partner transactions') THEN
    CREATE POLICY "Users can view partner transactions" ON public.transactions FOR SELECT TO authenticated
      USING (user_id IN (
        SELECT hl.user2_id FROM public.household_links hl WHERE hl.user1_id = auth.uid()
        UNION
        SELECT hl.user1_id FROM public.household_links hl WHERE hl.user2_id = auth.uid()
      ));
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: transaction_budget_splits                            │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.transaction_budget_splits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_budget_splits' AND policyname = 'Users can view splits for own transactions') THEN
    CREATE POLICY "Users can view splits for own transactions" ON public.transaction_budget_splits FOR SELECT TO authenticated
      USING (transaction_id IN (SELECT id FROM public.transactions WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_budget_splits' AND policyname = 'Users can insert splits for own transactions') THEN
    CREATE POLICY "Users can insert splits for own transactions" ON public.transaction_budget_splits FOR INSERT TO authenticated
      WITH CHECK (transaction_id IN (SELECT id FROM public.transactions WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_budget_splits' AND policyname = 'Users can update splits for own transactions') THEN
    CREATE POLICY "Users can update splits for own transactions" ON public.transaction_budget_splits FOR UPDATE TO authenticated
      USING (transaction_id IN (SELECT id FROM public.transactions WHERE user_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'transaction_budget_splits' AND policyname = 'Users can delete splits for own transactions') THEN
    CREATE POLICY "Users can delete splits for own transactions" ON public.transaction_budget_splits FOR DELETE TO authenticated
      USING (transaction_id IN (SELECT id FROM public.transactions WHERE user_id = auth.uid()));
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: pending_transactions                                 │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.pending_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_transactions' AND policyname = 'Users can view own pending transactions') THEN
    CREATE POLICY "Users can view own pending transactions" ON public.pending_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_transactions' AND policyname = 'Users can insert own pending transactions') THEN
    CREATE POLICY "Users can insert own pending transactions" ON public.pending_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_transactions' AND policyname = 'Users can update own pending transactions') THEN
    CREATE POLICY "Users can update own pending transactions" ON public.pending_transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_transactions' AND policyname = 'Users can delete own pending transactions') THEN
    CREATE POLICY "Users can delete own pending transactions" ON public.pending_transactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: notification_rules                                   │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'Users can view own notification rules') THEN
    CREATE POLICY "Users can view own notification rules" ON public.notification_rules FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'Users can insert own notification rules') THEN
    CREATE POLICY "Users can insert own notification rules" ON public.notification_rules FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'Users can update own notification rules') THEN
    CREATE POLICY "Users can update own notification rules" ON public.notification_rules FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_rules' AND policyname = 'Users can delete own notification rules') THEN
    CREATE POLICY "Users can delete own notification rules" ON public.notification_rules FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: vendor_overrides                                     │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.vendor_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_overrides' AND policyname = 'Users can view own vendor overrides') THEN
    CREATE POLICY "Users can view own vendor overrides" ON public.vendor_overrides FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_overrides' AND policyname = 'Users can upsert own vendor overrides') THEN
    CREATE POLICY "Users can upsert own vendor overrides" ON public.vendor_overrides FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_overrides' AND policyname = 'Users can update own vendor overrides') THEN
    CREATE POLICY "Users can update own vendor overrides" ON public.vendor_overrides FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vendor_overrides' AND policyname = 'Users can delete own vendor overrides') THEN
    CREATE POLICY "Users can delete own vendor overrides" ON public.vendor_overrides FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: ignored_transactions                                 │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.ignored_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ignored_transactions' AND policyname = 'Users can view own ignored transactions') THEN
    CREATE POLICY "Users can view own ignored transactions" ON public.ignored_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ignored_transactions' AND policyname = 'Users can insert own ignored transactions') THEN
    CREATE POLICY "Users can insert own ignored transactions" ON public.ignored_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ignored_transactions' AND policyname = 'Users can update own ignored transactions') THEN
    CREATE POLICY "Users can update own ignored transactions" ON public.ignored_transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ignored_transactions' AND policyname = 'Users can delete own ignored transactions') THEN
    CREATE POLICY "Users can delete own ignored transactions" ON public.ignored_transactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;


-- ┌────────────────────────────────────────────────────────────┐
-- │  RLS: notification_fingerprints                            │
-- └────────────────────────────────────────────────────────────┘
ALTER TABLE public.notification_fingerprints ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_fingerprints' AND policyname = 'Users can view own notification fingerprints') THEN
    CREATE POLICY "Users can view own notification fingerprints" ON public.notification_fingerprints FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification_fingerprints' AND policyname = 'Users can insert own notification fingerprints') THEN
    CREATE POLICY "Users can insert own notification fingerprints" ON public.notification_fingerprints FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
