-- ============================================================
-- Migration: add settings.smart_notifications_enabled
-- ============================================================
-- The app has been writing this column since smart notifications
-- shipped:
--
--   Dashboard.tsx  SETTING_DB_KEYS.smart_notifications_enabled
--     -> useUserSettings.saveSettingToDb('smart_notifications_enabled', v)
--     -> PATCH /settings?user_id=eq.<id>  { smart_notifications_enabled: v }
--
-- but the column was never created. Confirmed absent by introspecting
-- the live project (scripts/introspect_schema.sql, query 10 returned
-- settings.link_code and no smart_notifications_enabled).
--
-- Effect of the bug: every toggle returned PGRST204 ("column not
-- found"). saveSettingToDb only logs a failed response, and the UI had
-- already applied the change optimistically and written it to
-- localStorage, so the toggle looked like it worked. The preference
-- therefore never left the device — it did not sync to another device
-- or to a linked partner, and it was lost whenever site data was
-- cleared or the app was reinstalled.
--
-- Default is true to match the app's in-memory default
-- (App.tsx DEFAULT_SETTINGS.smart_notifications_enabled = true) and the
-- read-side fallback in DashboardSettingsModal
-- (`settings.smart_notifications_enabled ?? true`), so existing users
-- keep the behaviour they already have.
--
-- Safe to re-run.
-- ============================================================

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS smart_notifications_enabled boolean NOT NULL DEFAULT true;


-- Verify:
--   SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name = 'settings'
--     AND column_name = 'smart_notifications_enabled';
--
-- Expected: boolean | true | NO
--
-- No RLS change needed: the existing "Users can update own settings"
-- and "Users can view own settings" policies are table-scoped, so they
-- already cover the new column.
