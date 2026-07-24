-- ============================================================
-- Add confidence column to transactions
-- ============================================================
-- The notification capture pipeline computes an AI extraction
-- confidence (0..1) for each auto-captured transaction. It was
-- previously only persisted on pending_transactions; this column
-- carries it onto the confirmed transaction so the capture-review
-- UI can show a per-row AI-match confidence meter.
--
-- Non-destructive:
--   - Nullable, no default. Existing rows and manually-entered rows
--     stay NULL (rendered as "Manual / no AI confidence" in the UI).
--   - The app reads/writes it defensively (transactionMappers.ts
--     includes it only when present; the AI insert in
--     notificationProcessor.ts retries without it if the column is
--     absent), so applying this migration is safe at any time.
-- ============================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS confidence numeric;
