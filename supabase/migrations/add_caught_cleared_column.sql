-- Migration: Add caught_cleared column to transactions table
-- Run this in the Supabase SQL Editor (https://app.supabase.com/project/_/sql)
-- Safe to run multiple times — checks IF NOT EXISTS.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'caught_cleared'
  ) THEN
    ALTER TABLE public.transactions ADD COLUMN caught_cleared boolean NOT NULL DEFAULT false;
  END IF;
END $$;
