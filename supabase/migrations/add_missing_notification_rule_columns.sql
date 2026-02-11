-- Migration: Add missing columns to notification_rules
-- Run this in the Supabase SQL Editor (https://app.supabase.com/project/_/sql)
-- Safe to run multiple times — each statement checks IF NOT EXISTS.
-- Does NOT delete any existing data or columns.

-- 1. Add filter_keywords column (derived from only_parse, used for keyword matching)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_rules' AND column_name = 'filter_keywords'
  ) THEN
    ALTER TABLE public.notification_rules ADD COLUMN filter_keywords text[] DEFAULT '{}';
  END IF;
END $$;

-- 2. Add filter_mode column ('all', 'some', or 'one' — keyword matching condition)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_rules' AND column_name = 'filter_mode'
  ) THEN
    ALTER TABLE public.notification_rules ADD COLUMN filter_mode text DEFAULT 'one'
      CHECK (filter_mode = ANY (ARRAY['all'::text, 'some'::text, 'one'::text]));
  END IF;
END $$;

-- 3. Add notification_type column (label for which transaction type this rule handles)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_rules' AND column_name = 'notification_type'
  ) THEN
    ALTER TABLE public.notification_rules ADD COLUMN notification_type text DEFAULT 'default';
  END IF;
END $$;

-- 4. Add unique constraint on (user_id, bank_app_id, notification_type) if missing
--    First drop the old constraint (user_id, bank_app_id) if it exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notification_rules_unique' AND table_name = 'notification_rules'
  ) THEN
    ALTER TABLE public.notification_rules DROP CONSTRAINT notification_rules_unique;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'notification_rules_unique_v2' AND table_name = 'notification_rules'
  ) THEN
    ALTER TABLE public.notification_rules ADD CONSTRAINT notification_rules_unique_v2
      UNIQUE (user_id, bank_app_id, notification_type);
  END IF;
END $$;
