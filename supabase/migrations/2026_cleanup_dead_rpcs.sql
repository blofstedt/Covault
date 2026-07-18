-- ============================================================
-- Cleanup: drop dead RPCs from public schema
-- ============================================================
-- These RPCs were found in the live DB during the schema audit
-- (see SUPABASE_AUDIT.md). Neither is used by the app or tests.
--
--   - get_my_partner_id         — broken (references missing
--                                 public.profiles table; calling
--                                 it returns error 42P01)
--   - generate_transaction_hash — unused by app and tests
--
-- Run this in the Supabase SQL editor
-- (https://app.supabase.com/project/xqleyxrftyehodksashu/sql)
-- or via `supabase db execute --file ...` from the CLI.
--
-- Safe to re-run: uses IF EXISTS guards.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_my_partner_id();
DROP FUNCTION IF EXISTS public.generate_transaction_hash(numeric, date, text);
