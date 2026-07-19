-- ============================================================
-- Add refunded column to transactions
-- ============================================================
-- The new transaction pipeline strikes through the original
-- expense when a refund is detected, instead of recording a
-- separate negative-amount row. The flag persists that state.
--
-- This is a non-destructive migration:
--   1. Add the column with default false.
--   2. Backfill: any expense that already has a matching
--      negative-amount refund (same user, same vendor, same
--      |amount|, same budget, within 30 days) is marked
--      refunded=true. The original negative-amount row is
--      left in place for now (it's still hidden from the UI
--      by BudgetSection and contributes correctly to totals
--      since the matched expense amount is unchanged).
-- ============================================================

-- 1. Add the column
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS refunded boolean NOT NULL DEFAULT false;

-- 2. Backfill: existing matched pairs
-- For each negative-amount, non-income, non-projected transaction R,
-- find the closest positive-amount expense E (same user, same vendor,
-- same |amount|, same budget, within 30 days) and mark E refunded=true.
-- We only mark ONE expense per refund (closest by date).
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
    AND COALESCE(r.is_income, false) = false
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
    ) <= 30
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
