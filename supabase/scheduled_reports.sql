-- ============================================================
-- SCHEDULED REPORTS TABLE
-- Paste this into Supabase SQL Editor to create the table.
-- This is safe to run on an existing database — it will NOT
-- drop or modify any other tables.
-- ============================================================

-- Create the table (only if it doesn't already exist)
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Comma-separated recipient emails stored as a Postgres text array
  emails text[] NOT NULL,

  -- 'monthly' or 'yearly' (one-time sends are immediate and not stored)
  frequency text NOT NULL CHECK (frequency = ANY (ARRAY['monthly','yearly'])),

  -- Day of month to send (1–28, avoids end-of-month edge cases)
  day_of_month integer NOT NULL CHECK (day_of_month >= 1 AND day_of_month <= 28),

  -- Month index (0 = January … 11 = December), only used for yearly
  month integer CHECK (month IS NULL OR (month >= 0 AND month <= 11)),

  -- Toggle the schedule on/off without deleting it
  enabled boolean NOT NULL DEFAULT true,

  -- Timestamp of the most recent successful send
  last_sent_at timestamptz,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT scheduled_reports_pkey PRIMARY KEY (id)
);

-- Performance index
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_user_id
  ON public.scheduled_reports (user_id);

-- ── Row Level Security ─────────────────────────────────────
ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;

-- Users can only see / modify their own reports
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scheduled_reports' AND policyname = 'Users can view own scheduled reports'
  ) THEN
    CREATE POLICY "Users can view own scheduled reports"
      ON public.scheduled_reports FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scheduled_reports' AND policyname = 'Users can insert own scheduled reports'
  ) THEN
    CREATE POLICY "Users can insert own scheduled reports"
      ON public.scheduled_reports FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scheduled_reports' AND policyname = 'Users can update own scheduled reports'
  ) THEN
    CREATE POLICY "Users can update own scheduled reports"
      ON public.scheduled_reports FOR UPDATE TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'scheduled_reports' AND policyname = 'Users can delete own scheduled reports'
  ) THEN
    CREATE POLICY "Users can delete own scheduled reports"
      ON public.scheduled_reports FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Auto-update the updated_at column on changes
-- (re-uses the update_updated_at_column() function from budgets table)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_scheduled_reports_updated_at ON public.scheduled_reports;
CREATE TRIGGER update_scheduled_reports_updated_at
  BEFORE UPDATE ON public.scheduled_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
