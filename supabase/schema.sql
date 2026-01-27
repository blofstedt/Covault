-- ============================================
-- COVAULT DATABASE SCHEMA
-- Version 3.0 - Simplified
-- ============================================
-- This script will:
-- 1. Drop all existing Covault tables
-- 2. Create new tables with proper structure
-- 3. Set up Row Level Security (RLS)
-- 4. Seed primary categories
-- ============================================

-- ============================================
-- STEP 1: DROP EXISTING TABLES (if any)
-- ============================================
-- Drop in reverse dependency order
DROP TABLE IF EXISTS transaction_splits CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS user_budgets CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;
DROP TABLE IF EXISTS primary_categories CASCADE;

-- ============================================
-- STEP 2: CREATE TABLES
-- ============================================

-- Primary Categories (App-level, immutable by users)
-- These are the 6 system categories that every user gets
CREATE TABLE primary_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_order INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Profiles (extends auth.users)
-- Links to Supabase's built-in auth.users table
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  partner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  partner_email TEXT,
  partner_name TEXT,
  has_joint_accounts BOOLEAN DEFAULT FALSE,
  budgeting_solo BOOLEAN DEFAULT TRUE,
  monthly_income DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Budget Settings (per-user category limits)
-- Each user can customize their budget limits for each category
CREATE TABLE user_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES primary_categories(id) ON DELETE CASCADE,
  total_limit DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category_id)
);

-- Transactions Table
-- Main transaction storage with RLS
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor TEXT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  date DATE NOT NULL,
  category_id UUID NOT NULL REFERENCES primary_categories(id),
  recurrence TEXT DEFAULT 'One-time' CHECK (recurrence IN ('One-time', 'Biweekly', 'Monthly')),
  label TEXT DEFAULT 'Manual' CHECK (label IN ('Auto-Added', 'Manual', 'Auto-Added + Edited')),
  is_projected BOOLEAN DEFAULT FALSE,
  split_group_id UUID DEFAULT NULL,  -- NULL = standalone, shared UUID = linked split transactions
  source_hash TEXT DEFAULT NULL,     -- For deduplication: hash of amount+vendor+date
  user_name TEXT,                    -- Name of user who recorded (for shared accounts)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Settings Table
-- Stores app preferences per user
CREATE TABLE user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  rollover_enabled BOOLEAN DEFAULT TRUE,
  rollover_overspend BOOLEAN DEFAULT FALSE,
  use_leisure_as_buffer BOOLEAN DEFAULT TRUE,
  show_savings_insight BOOLEAN DEFAULT TRUE,
  theme TEXT DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
  has_seen_tutorial BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- STEP 3: CREATE INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_category_id ON transactions(category_id);
CREATE INDEX idx_transactions_split_group ON transactions(split_group_id) WHERE split_group_id IS NOT NULL;
CREATE INDEX idx_transactions_source_hash ON transactions(source_hash) WHERE source_hash IS NOT NULL;
CREATE INDEX idx_user_budgets_user_id ON user_budgets(user_id);
CREATE INDEX idx_user_profiles_partner_id ON user_profiles(partner_id);

-- ============================================
-- STEP 4: ENABLE ROW LEVEL SECURITY
-- ============================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
-- primary_categories is public/read-only, no RLS needed

-- ============================================
-- STEP 5: CREATE RLS POLICIES
-- ============================================

-- User Profiles Policies
-- Users can read/update their own profile
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can view their partner's profile (for shared mode)
CREATE POLICY "Users can view partner profile"
  ON user_profiles FOR SELECT
  USING (
    id IN (
      SELECT partner_id FROM user_profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
  );

-- User Budgets Policies
-- Users can manage their own budget settings
CREATE POLICY "Users can view own budgets"
  ON user_budgets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own budgets"
  ON user_budgets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own budgets"
  ON user_budgets FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own budgets"
  ON user_budgets FOR DELETE
  USING (auth.uid() = user_id);

-- Transactions Policies
-- Users can manage their own transactions
CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE
  USING (auth.uid() = user_id);

-- Users can view their partner's transactions (for shared budgeting)
CREATE POLICY "Users can view partner transactions"
  ON transactions FOR SELECT
  USING (
    user_id IN (
      SELECT partner_id FROM user_profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
  );

-- User Settings Policies
CREATE POLICY "Users can view own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================
-- STEP 6: SEED PRIMARY CATEGORIES
-- ============================================

INSERT INTO primary_categories (id, name, display_order) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Housing', 1),
  ('22222222-2222-2222-2222-222222222222', 'Groceries', 2),
  ('33333333-3333-3333-3333-333333333333', 'Transport', 3),
  ('44444444-4444-4444-4444-444444444444', 'Utilities', 4),
  ('55555555-5555-5555-5555-555555555555', 'Leisure', 5),
  ('66666666-6666-6666-6666-666666666666', 'Other', 6);

-- ============================================
-- STEP 7: CREATE HELPER FUNCTIONS
-- ============================================

-- Function to automatically create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  );

  -- Create default budget settings for new user
  INSERT INTO public.user_budgets (user_id, category_id, total_limit)
  SELECT NEW.id, id,
    CASE name
      WHEN 'Housing' THEN 1500
      WHEN 'Groceries' THEN 600
      WHEN 'Transport' THEN 300
      WHEN 'Utilities' THEN 150
      WHEN 'Leisure' THEN 400
      WHEN 'Other' THEN 100
      ELSE 0
    END
  FROM public.primary_categories;

  -- Create default settings for new user
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to generate source hash for deduplication
CREATE OR REPLACE FUNCTION generate_transaction_hash(
  p_amount DECIMAL,
  p_vendor TEXT,
  p_date DATE
)
RETURNS TEXT AS $$
BEGIN
  RETURN md5(p_amount::TEXT || '|' || LOWER(TRIM(p_vendor)) || '|' || p_date::TEXT);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 8: CREATE VIEWS FOR CONVENIENCE
-- ============================================

-- View for getting user's transactions with category names
CREATE OR REPLACE VIEW user_transactions_with_categories AS
SELECT
  t.*,
  pc.name as category_name,
  pc.display_order as category_order
FROM transactions t
JOIN primary_categories pc ON t.category_id = pc.id;

-- View for getting partner's transactions (for shared accounts)
CREATE OR REPLACE VIEW partner_transactions AS
SELECT
  t.*,
  pc.name as category_name,
  up.name as partner_name
FROM transactions t
JOIN primary_categories pc ON t.category_id = pc.id
JOIN user_profiles up ON t.user_id = up.id
WHERE t.user_id IN (
  SELECT partner_id FROM user_profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
);

-- ============================================
-- DONE!
-- ============================================
-- To run this script:
-- 1. Go to your Supabase dashboard
-- 2. Navigate to SQL Editor
-- 3. Paste this entire script
-- 4. Click "Run"
-- ============================================
