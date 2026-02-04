# Supabase Database Schema Deployment Guide

## Overview

This document explains the complete database schema for the Covault application. The schema includes both the tables specified in your requirements AND additional tables needed by the application to function properly.

## Schema Components

### Part 1: Required Tables (from problem statement)
These are the 8 core tables you specified:

1. **categories** - Budget categories with display order
2. **settings** - User settings including theme, income, partner info, and app notifications
3. **linked_partners** - Partnership requests with status (pending/accepted/rejected)
4. **notification_rules** - Bank notification parsing rules per user
5. **transactions** - Financial transactions with categories and recurrence
6. **user_budgets** - Per-user category budget limits
7. **vendor_overrides** - User-specific vendor-to-category mappings
8. **flag_reports** - Reports for incorrect notification parsing

### Part 2: Additional Tables (required by the app)
These 6 additional tables are used by the application code and must be created:

9. **budgets** - Per-user category spending limits (active table used by app)
10. **household_links** - Links two users as household partners
11. **link_codes** - Temporary codes for household linking
12. **pending_transactions** - Auto-parsed transactions awaiting user approval
13. **validation_baselines** - Regex validation patterns for notification parsing
14. **transaction_budget_splits** - Splits for transactions across multiple categories

## Deployment Instructions

### Option 1: Deploy Complete Schema (Recommended)

1. Open your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the entire contents of `supabase/schema.sql`
4. Click "Run" to execute

**⚠️ WARNING**: This will DROP all existing tables and recreate them. Make sure to backup any existing data first.

### Option 2: Deploy Only Missing Tables

If you already have some tables and only want to add the missing ones, use the SQL below.

---

## SQL to Create Additional Tables in Supabase

Run this SQL in your Supabase SQL Editor to create ONLY the additional tables that were not in your original problem statement but are required by the app:

```sql
-- ============================================================
-- ADDITIONAL TABLES REQUIRED BY THE COVAULT APP
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. BUDGETS (per-user category spending limits)
CREATE TABLE IF NOT EXISTS public.budgets (
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
  CONSTRAINT budgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- 2. HOUSEHOLD LINKS (links two users as household partners)
CREATE TABLE IF NOT EXISTS public.household_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user1_id uuid NOT NULL,
  user2_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  user1_name text,
  user2_name text,
  CONSTRAINT household_links_pkey PRIMARY KEY (id),
  CONSTRAINT household_links_user1_id_fkey FOREIGN KEY (user1_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT household_links_user2_id_fkey FOREIGN KEY (user2_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT household_links_no_self CHECK (user1_id <> user2_id),
  CONSTRAINT household_links_unique UNIQUE (user1_id, user2_id)
);

-- 3. LINK CODES (for joining households via code)
CREATE TABLE IF NOT EXISTS public.link_codes (
  code text NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT link_codes_pkey PRIMARY KEY (code),
  CONSTRAINT link_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- 4. PENDING TRANSACTIONS (awaiting user approval)
CREATE TABLE IF NOT EXISTS public.pending_transactions (
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
  CONSTRAINT pending_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- 5. VALIDATION BASELINES (regex patterns for notification parsing)
CREATE TABLE IF NOT EXISTS public.validation_baselines (
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
  CONSTRAINT validation_baselines_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- 6. TRANSACTION BUDGET SPLITS (for split transactions)
CREATE TABLE IF NOT EXISTS public.transaction_budget_splits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL,
  budget_category text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  percentage numeric CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT transaction_budget_splits_pkey PRIMARY KEY (id),
  CONSTRAINT transaction_budget_splits_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE
);

-- Create useful indexes
CREATE INDEX IF NOT EXISTS idx_budgets_user_id ON public.budgets (user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_category ON public.budgets (category);
CREATE INDEX IF NOT EXISTS idx_household_links_user1_id ON public.household_links (user1_id);
CREATE INDEX IF NOT EXISTS idx_household_links_user2_id ON public.household_links (user2_id);
CREATE INDEX IF NOT EXISTS idx_link_codes_user_id ON public.link_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_link_codes_expires_at ON public.link_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_user_id ON public.pending_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_pending_transactions_needs_review ON public.pending_transactions (needs_review);
CREATE INDEX IF NOT EXISTS idx_validation_baselines_user_id ON public.validation_baselines (user_id);
CREATE INDEX IF NOT EXISTS idx_validation_baselines_app_package ON public.validation_baselines (app_package);
CREATE INDEX IF NOT EXISTS idx_transaction_budget_splits_transaction_id ON public.transaction_budget_splits (transaction_id);
```

## Table Relationships

```
auth.users (Supabase Auth)
    ↓
    ├── settings (1:1)
    ├── linked_partners (1:many) ← status-based partnership requests
    ├── household_links (many:many) ← active household connections
    ├── link_codes (1:many) ← temporary invitation codes
    ├── notification_rules (1:many) ← bank parsing rules
    ├── transactions (1:many)
    │       ↓
    │       └── transaction_budget_splits (1:many)
    ├── user_budgets (1:many) ← category budget limits (from requirements)
    ├── budgets (1:many) ← category budget limits (used by app)
    ├── vendor_overrides (1:many)
    ├── flag_reports (1:many)
    ├── pending_transactions (1:many)
    └── validation_baselines (1:many)

categories (global)
    ↓
    ├── transactions (many:1)
    ├── user_budgets (many:1)
    ├── vendor_overrides (many:1)
    └── notification_rules.default_category_id (many:1)
```

## Key Features

### Data Types
- All IDs use `uuid` with `gen_random_uuid()` default
- Amounts use `numeric` (unlimited precision) not `numeric(12,2)`
- Timestamps use `timestamp with time zone`

### Constraints
- Foreign keys with proper CASCADE/SET NULL rules
- CHECK constraints for enums and value ranges
- UNIQUE constraints where needed

### Special Notes
1. **budgets vs user_budgets**: The app primarily uses the `budgets` table. The `user_budgets` table was in your requirements but may represent a different budgeting approach.

2. **linked_partners vs household_links**: 
   - `linked_partners` = partnership requests (with status)
   - `household_links` = active household connections

3. **Notification System**: The app has a sophisticated notification parsing system with:
   - `notification_rules` - parsing rules per bank
   - `pending_transactions` - parsed but unconfirmed transactions
   - `validation_baselines` - learned validation patterns
   - `flag_reports` - corrections when parsing fails

## Next Steps

After running the schema:
1. Set up Row Level Security (RLS) policies if needed
2. Configure Supabase Storage if the app uses file uploads
3. Test the application to ensure all tables are working correctly

## Questions?

If you encounter any issues with the schema, check:
- Are you using Supabase (PostgreSQL 12+)?
- Have you run all migrations in order?
- Are RLS policies configured correctly?
