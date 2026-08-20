-- ============================================================
-- Add auto_filed column to transactions
-- ============================================================
-- When "file known vendors automatically" is on, a capture that
-- matches a learned rule closely enough is stored already cleared
-- (caught_cleared = true) and never enters the review list.
--
-- Nothing distinguished such a row from one the user reviewed and
-- filed by hand, so an auto-filed purchase left no trace anywhere:
-- the review list said "All caught up" while purchases were being
-- recorded — and, in at least two cases, re-entered by hand a minute
-- later because the user could not see the capture.
--
-- This column is that trace. The "Filed automatically" card on the
-- capture page lists recent auto-filed captures so they can be seen
-- and moved if a stale rule sent one to the wrong budget.
--
-- Non-destructive:
--   - Defaults to false, so every existing row reads as "filed by
--     hand" — which is the honest answer, since the distinction was
--     not recorded before now.
--   - The app writes it defensively (the AI insert in
--     notificationProcessor.ts retries without it if the column is
--     absent), so applying this migration is safe at any time.
-- ============================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS auto_filed boolean NOT NULL DEFAULT false;
