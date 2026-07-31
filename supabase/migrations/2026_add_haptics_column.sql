-- ============================================================
-- SUPERSEDED by 2026_08_01_sync_schema_to_app.sql
-- ============================================================
-- That file is the single script to run: it contains this change
-- plus the other outstanding ones. Kept here for history only —
-- running it is harmless but unnecessary.
-- ============================================================

-- ============================================================
-- Migration: add settings.haptics_enabled
-- ============================================================
-- Backs the "Vibration" toggle. When on, Covault fires a light haptic when a
-- capture is filed and a firmer one when something is deleted. Nothing on
-- scroll or navigation.
--
-- Default true, matching DEFAULT_SETTINGS in App.tsx. Unlike auto-file, this
-- one is cosmetic and reversible, so on-by-default is the right call — it is
-- the kind of feedback people miss when absent and rarely go looking for.
--
-- The runtime already respects the OS: lib/haptics.ts no-ops on web, when
-- prefers-reduced-motion is set, and when this setting is false.
--
-- ---------------------------------------------------------------
-- RUN THIS, along with the two migrations still outstanding:
--   2026_add_smart_notifications_column.sql
--   2026_add_auto_accept_column.sql
-- ---------------------------------------------------------------
-- Without it the toggle works on-device but the preference never reaches the
-- database, so it does not sync to a linked partner and is lost on reinstall.
-- saveSettingToDb only logs a failed PATCH while the UI has already applied the
-- change optimistically, so a missing column is indistinguishable from success.
--
-- The read side is already defensive: useDataLoading requests this column with
-- the other late additions in a separate select that falls back to the base
-- column list, because PostgREST 400s the entire select when any named column
-- is unknown. An unmigrated project loads fine — the setting just doesn't stick.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS haptics_enabled boolean NOT NULL DEFAULT true;


-- Verify:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'settings'
--     AND column_name = 'haptics_enabled';
--
-- Expected: boolean | true | NO
