-- Migration: Add missing unique constraint to vendor_overrides
-- Run this in the Supabase SQL Editor (https://app.supabase.com/project/_/sql)
-- Safe to run multiple times — checks IF NOT EXISTS.
-- Does NOT delete any existing data or columns.

-- Add unique constraint on (user_id, vendor_name) if missing.
-- This constraint prevents duplicate vendor entries per user and ensures
-- data integrity for vendor override insert and lookup operations.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'vendor_overrides_unique' AND table_name = 'vendor_overrides'
  ) THEN
    ALTER TABLE public.vendor_overrides ADD CONSTRAINT vendor_overrides_unique UNIQUE (user_id, vendor_name);
  END IF;
END $$;
