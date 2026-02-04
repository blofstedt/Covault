-- ============================================================
-- COVAULT DATABASE SCHEMA (CORRECT VERSION)
-- Based on the problem statement requirements
-- ============================================================

-- DROP ALL EXISTING TABLES
DROP TABLE IF EXISTS public.transaction_budget_splits CASCADE;
DROP TABLE IF EXISTS public.validation_baselines CASCADE;
DROP TABLE IF EXISTS public.pending_transactions CASCADE;
DROP TABLE IF EXISTS public.link_codes CASCADE;
DROP TABLE IF EXISTS public.household_links CASCADE;
DROP TABLE IF EXISTS public.budgets CASCADE;
DROP TABLE IF EXISTS public.vendor_overrides CASCADE;
DROP TABLE IF EXISTS public.flag_reports CASCADE;
DROP TABLE IF EXISTS public.user_budgets CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.notification_rules CASCADE;
DROP TABLE IF EXISTS public.linked_partners CASCADE;
DROP TABLE IF EXISTS public.settings CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;

-- ============================================================
-- 1. CATEGORIES
-- ============================================================
CREATE TABLE public.categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_order integer NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT categories_pkey PRIMARY KEY (id)
);

-- Insert default categories
INSERT INTO public.categories (name, display_order) VALUES
  ('Housing', 1),
  ('Groceries', 2),
  ('Transport', 3),
  ('Utilities', 4),
  ('Leisure', 5),
  ('Other', 6);

-- ============================================================
-- 2. SETTINGS
-- ============================================================
CREATE TABLE public.settings (
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  partner_id uuid,
  partner_email text,
  partner_name text,
  has_joint_accounts boolean DEFAULT false,
  budgeting_solo boolean DEFAULT true,
  monthly_income numeric DEFAULT 0 CHECK (monthly_income >= 0::numeric),
  rollover_enabled boolean DEFAULT true,
  rollover_overspend boolean DEFAULT false,
  use_leisure_as_buffer boolean DEFAULT true,
  show_savings_insight boolean DEFAULT true,
  theme text DEFAULT 'light'::text CHECK (theme = ANY (ARRAY['light'::text, 'dark'::text])),
  has_seen_tutorial boolean DEFAULT false,
  app_notifications_enabled boolean DEFAULT false,
  CONSTRAINT settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT settings_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES auth.users(id)
);

-- ============================================================
-- 3. LINKED PARTNERS
-- ============================================================
CREATE TABLE public.linked_partners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  partner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT linked_partners_pkey PRIMARY KEY (id),
  CONSTRAINT linked_partners_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT linked_partners_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES auth.users(id)
);

-- ============================================================
-- 4. NOTIFICATION RULES
-- ============================================================
CREATE TABLE public.notification_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bank_app_id text NOT NULL,
  bank_name text NOT NULL,
  amount_regex text NOT NULL,
  vendor_regex text NOT NULL,
  default_category_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  flagged_count integer NOT NULL DEFAULT 0,
  last_flagged_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_rules_pkey PRIMARY KEY (id),
  CONSTRAINT notification_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT notification_rules_default_category_id_fkey FOREIGN KEY (default_category_id) REFERENCES public.categories(id)
);

-- ============================================================
-- 5. TRANSACTIONS
-- ============================================================
CREATE TABLE public.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor text NOT NULL,
  amount numeric NOT NULL,
  date date NOT NULL,
  category_id uuid NOT NULL,
  recurrence text NOT NULL DEFAULT 'One-time'::text CHECK (recurrence = ANY (ARRAY['One-time'::text, 'Biweekly'::text, 'Monthly'::text])),
  label text NOT NULL DEFAULT 'Manual'::text CHECK (label = ANY (ARRAY['Auto-Added'::text, 'Manual'::text, 'Auto-Added + Edited'::text])),
  is_projected boolean NOT NULL DEFAULT false,
  split_group_id uuid,
  source_hash text,
  user_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);

-- ============================================================
-- 6. USER BUDGETS
-- ============================================================
CREATE TABLE public.user_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category_id uuid NOT NULL,
  total_limit numeric NOT NULL DEFAULT 0 CHECK (total_limit >= 0::numeric),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_budgets_pkey PRIMARY KEY (id),
  CONSTRAINT user_budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_budgets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);

-- ============================================================
-- 7. VENDOR OVERRIDES
-- ============================================================
CREATE TABLE public.vendor_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  vendor_name text NOT NULL,
  category_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT vendor_overrides_pkey PRIMARY KEY (id),
  CONSTRAINT vendor_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT vendor_overrides_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id)
);

-- ============================================================
-- 8. FLAG REPORTS
-- ============================================================
CREATE TABLE public.flag_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  notification_rule_id uuid,
  raw_notification text NOT NULL,
  expected_vendor text,
  expected_amount numeric,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT flag_reports_pkey PRIMARY KEY (id),
  CONSTRAINT flag_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT flag_reports_notification_rule_id_fkey FOREIGN KEY (notification_rule_id) REFERENCES public.notification_rules(id)
);

-- ============================================================
-- ADDITIONAL TABLES REQUIRED BY THE APP
-- ============================================================

-- ============================================================
-- 9. BUDGETS (per-user category spending limits)
-- ============================================================
CREATE TABLE public.budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL,
  limit_amount numeric NOT NULL,
  user_id uuid NOT NULL,
  is_household boolean DEFAULT true,
  parent_category text,
  icon text,
  color text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT budgets_pkey PRIMARY KEY (id),
  CONSTRAINT budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- ============================================================
-- 10. HOUSEHOLD LINKS (links two users as household partners)
-- ============================================================
CREATE TABLE public.household_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user1_id uuid NOT NULL,
  user2_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  user1_name text,
  user2_name text,
  CONSTRAINT household_links_pkey PRIMARY KEY (id),
  CONSTRAINT household_links_user1_id_fkey FOREIGN KEY (user1_id) REFERENCES auth.users(id),
  CONSTRAINT household_links_user2_id_fkey FOREIGN KEY (user2_id) REFERENCES auth.users(id),
  CONSTRAINT household_links_no_self CHECK (user1_id <> user2_id),
  CONSTRAINT household_links_unique UNIQUE (user1_id, user2_id)
);

-- ============================================================
-- 11. LINK CODES (for joining households via code)
-- ============================================================
CREATE TABLE public.link_codes (
  code text NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT link_codes_pkey PRIMARY KEY (code),
  CONSTRAINT link_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- ============================================================
-- 12. PENDING TRANSACTIONS (awaiting user approval)
-- ============================================================
CREATE TABLE public.pending_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  app_package text NOT NULL,
  app_name text NOT NULL,
  notification_title text NOT NULL,
  notification_text text NOT NULL,
  notification_timestamp bigint NOT NULL,
  posted_at timestamp with time zone NOT NULL,
  extracted_vendor text NOT NULL,
  extracted_amount numeric NOT NULL,
  extracted_timestamp timestamp with time zone NOT NULL,
  confidence integer NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  validation_reasons text NOT NULL,
  needs_review boolean DEFAULT true,
  pattern_id text,
  created_at timestamp with time zone DEFAULT now(),
  reviewed_at timestamp with time zone,
  approved boolean,
  CONSTRAINT pending_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT pending_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- ============================================================
-- 13. VALIDATION BASELINES (regex patterns for notification parsing)
-- ============================================================
CREATE TABLE public.validation_baselines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_package text NOT NULL,
  user_id uuid NOT NULL,
  vendor_length_min integer NOT NULL,
  vendor_length_max integer NOT NULL,
  vendor_character_classes text NOT NULL,
  vendor_case_style text NOT NULL CHECK (vendor_case_style = ANY (ARRAY['title'::text, 'lower'::text, 'upper'::text, 'mixed'::text])),
  vendor_forbidden_patterns text NOT NULL,
  amount_range_min numeric NOT NULL,
  amount_range_max numeric NOT NULL,
  amount_decimal_places integer NOT NULL,
  confidence_threshold integer DEFAULT 70,
  sample_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT validation_baselines_pkey PRIMARY KEY (id),
  CONSTRAINT validation_baselines_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

-- ============================================================
-- 14. TRANSACTION BUDGET SPLITS (for split transactions)
-- ============================================================
CREATE TABLE public.transaction_budget_splits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  budget_category text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  percentage numeric CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT transaction_budget_splits_pkey PRIMARY KEY (id),
  CONSTRAINT transaction_budget_splits_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE
);
