-- ============================================================
-- Refund strike-through + Learning system schema
-- ============================================================
-- Two related changes:
--
-- A) Add `refunded` boolean to `transactions` so the parser can mark
--    an original expense as refunded (no separate negative-amount row).
--    Backfills any existing matched refund pairs.
--
-- B) Expose and extend the existing learning system:
--    - `overrides` gains `match_type` (exact|prefix|contains) and
--      `updated_at` for "most recent wins" sorting.
--    - `transactions` gains `raw_notification` so each row carries
--      its source text for the <> page reviewer.
--    - New `notification_rules` table for "not a transaction" skip
--      patterns (separate from overrides — different semantics).
--    - Backfill: existing overrides get `match_type='exact'` and
--      `updated_at=now()` so behavior is unchanged.
-- ============================================================

-- ============================================================
-- A) Refunded column on transactions
-- ============================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS refunded boolean NOT NULL DEFAULT false;

-- Backfill: any expense that already has a matching negative-amount
-- refund (same user, same vendor, same |amount|, same budget, within
-- 60 days) is marked refunded=true. The original negative-amount row
-- is left in place — BudgetSection still hides it from the list.
WITH refund_candidates AS (
  SELECT
    r.id AS refund_id,
    r.user_id,
    r.vendor AS refund_vendor,
    ABS(r.amount) AS refund_abs_amount,
    r.budget AS refund_budget,
    r.date AS refund_date
  FROM public.transactions r
  WHERE r.amount < 0
    AND r.is_projected = false
),
best_match AS (
  SELECT DISTINCT ON (rc.refund_id)
    rc.refund_id,
    e.id AS expense_id
  FROM refund_candidates rc
  JOIN public.transactions e
    ON e.user_id = rc.user_id
    AND LOWER(TRIM(e.vendor)) = LOWER(TRIM(rc.refund_vendor))
    AND ABS(ABS(e.amount) - rc.refund_abs_amount) < 0.01
    AND e.budget = rc.refund_budget
    AND e.amount > 0
    AND e.is_projected = false
    AND COALESCE(e.refunded, false) = false
    AND ABS(
      (EXTRACT(EPOCH FROM (e.date::timestamp - rc.refund_date::timestamp)) / 86400)
    ) <= 60
  ORDER BY rc.refund_id, ABS(
    (EXTRACT(EPOCH FROM (e.date::timestamp - rc.refund_date::timestamp)) / 86400)
  ) ASC
)
UPDATE public.transactions
SET refunded = true
WHERE id IN (SELECT expense_id FROM best_match);

-- Index for the parser/processor's frequent "find a matching expense" query
CREATE INDEX IF NOT EXISTS idx_transactions_user_vendor_amount
  ON public.transactions (user_id, vendor, amount)
  WHERE is_projected = false;

-- Index for the refund match-window scan
CREATE INDEX IF NOT EXISTS idx_transactions_user_date_unrefunded
  ON public.transactions (user_id, date)
  WHERE refunded = false AND amount > 0 AND is_projected = false;


-- ============================================================
-- B) Learning system schema
-- ============================================================

-- B1) Extend `overrides` with match_type and updated_at
-- ============================================================
ALTER TABLE public.overrides
  ADD COLUMN IF NOT EXISTS match_type text NOT NULL DEFAULT 'exact'
    CHECK (match_type IN ('exact', 'prefix', 'contains'));

ALTER TABLE public.overrides
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Backfill: existing rows get match_type='exact' and updated_at=now()
-- so behavior is unchanged (the existing code did hard-coded exact match).
UPDATE public.overrides
SET match_type = 'exact',
    updated_at = COALESCE(updated_at, now())
WHERE match_type IS NULL OR updated_at IS NULL;

-- Drop the old single-column index if it exists and replace with one
-- that's match_type-aware (the parser will query by match_type now).
CREATE INDEX IF NOT EXISTS idx_overrides_user_match_key
  ON public.overrides (user_id, match_key);

CREATE INDEX IF NOT EXISTS idx_overrides_user_updated_at
  ON public.overrides (user_id, updated_at DESC);


-- B2) Add `raw_notification` to `transactions`
-- ============================================================
-- Stores the original notification text so the <> page reviewer can
-- show "why was this captured?" and so the user can correct the
-- vendor from the source. Populated by the notification processor
-- at insert time. Nullable for legacy rows (pre-migration).
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS raw_notification text;

COMMENT ON COLUMN public.transactions.raw_notification IS
  'Original raw notification text that produced this transaction. '
  'Populated by the notification pipeline. Used by the <> page to '
  'show the user what the parser saw, and to enable vendor correction.';


-- B3) New `notification_rules` table
-- ============================================================
-- Skip rules: "this notification text is not a transaction" patterns.
-- The pipeline checks this table BEFORE parsing. If the raw text
-- matches a rule (exact or contains), the notification is dropped
-- silently — no row, no review, no log.
--
-- Different semantics from `overrides` (which corrects/redirects),
-- so kept in its own table.
CREATE TABLE IF NOT EXISTS public.notification_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pattern text NOT NULL,
  pattern_type text NOT NULL DEFAULT 'exact'
    CHECK (pattern_type IN ('exact', 'contains')),
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notification_rules_pkey PRIMARY KEY (id),
  CONSTRAINT notification_rules_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users(id)
);

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'notification_rules' AND policyname = 'Users can view own notification rules') THEN
    CREATE POLICY "Users can view own notification rules" ON public.notification_rules
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'notification_rules' AND policyname = 'Users can insert own notification rules') THEN
    CREATE POLICY "Users can insert own notification rules" ON public.notification_rules
      FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'notification_rules' AND policyname = 'Users can update own notification rules') THEN
    CREATE POLICY "Users can update own notification rules" ON public.notification_rules
      FOR UPDATE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE tablename = 'notification_rules' AND policyname = 'Users can delete own notification rules') THEN
    CREATE POLICY "Users can delete own notification rules" ON public.notification_rules
      FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_rules_user
  ON public.notification_rules (user_id);


-- ============================================================
-- Drift check: regenerate supabase/schema.sql after this migration
-- ============================================================
-- The schema.sql file is regenerated by `supabase db pull` in CI.
-- After applying this migration, the drift check will diff the
-- live introspection against the committed schema and flag the
-- new columns/table as drift. Update schema.sql to match.
