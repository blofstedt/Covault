-- ============================================================
-- SUPERSEDED by 2026_08_01_sync_schema_to_app.sql
-- ============================================================
-- That file is the single script to run: it contains this change
-- plus the other outstanding ones. Kept here for history only —
-- running it is harmless but unnecessary.
-- ============================================================

-- ============================================================
-- Migration: add settings.auto_accept_known_vendors
-- ============================================================
-- Backs the "Auto-file known vendors" toggle under the Bank Notification
-- Listener section. When on, a capture whose vendor is matched by one of the
-- user's own learned rules with >= 90% confidence is renamed to that rule's
-- proper name, filed to its budget, and never shown in Review.
--
-- Default false. This setting files money without showing it to the user, so
-- it has to be something they turned on deliberately — not a behaviour that
-- appears after an update. It matches DEFAULT_SETTINGS in App.tsx.
--
-- ---------------------------------------------------------------
-- RUN THIS. Until it is applied the toggle only lives on the device.
-- ---------------------------------------------------------------
-- The app writes the setting with
--   PATCH /settings?user_id=eq.<id>  { auto_accept_known_vendors: bool }
-- and saveSettingToDb only logs a failed response, while the UI has already
-- applied the change optimistically and written it to localStorage. So a
-- missing column looks exactly like success: the toggle moves, auto-accept
-- works on that device, and the preference silently fails to reach the
-- database — so it does not sync to another device or to a linked partner,
-- and it is lost on reinstall or when site data is cleared.
--
-- This is the same failure smart_notifications_enabled had; see
-- 2026_add_smart_notifications_column.sql, which is still outstanding.
--
-- The read side is already defensive: useDataLoading requests this column and
-- smart_notifications_enabled in a separate select that falls back to the base
-- column list, because PostgREST 400s the entire select when any named column
-- is unknown. So an unmigrated project loads fine — the setting just never
-- persists.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS auto_accept_known_vendors boolean NOT NULL DEFAULT false;


-- Verify:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'settings'
--     AND column_name = 'auto_accept_known_vendors';
--
-- Expected: boolean | false | NO
--
-- No RLS change needed: the existing "Users can update own settings" and
-- "Users can view own settings" policies are table-scoped, so they already
-- cover the new column.
