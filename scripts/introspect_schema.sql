-- ============================================================
-- Covault — live schema introspection
-- ============================================================
-- Paste this whole file into the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query) and run it. Each block
-- returns one result set; copy them back to compare against
-- supabase/schema.sql.
--
-- Read-only: this only queries catalog views. It changes nothing.
-- ============================================================


-- 1. Tables that actually exist in `public`.
--    Expect: banks, budgets, overrides, settings, transactions,
--    plus notification_rules and pending_transactions if those
--    were ever created.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;


-- 2. Every column, with exact case, type, nullability and default.
--    `column_name` is returned verbatim — this is what settles
--    whether budgets has "Visible" or "visible".
SELECT table_name,
       column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;


-- 3. Enum types and their members, in order.
SELECT t.typname AS enum_name,
       e.enumlabel AS value,
       e.enumsortorder AS position
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder;


-- 4. RLS: which tables have it enabled.
--    Every table holding user data must be true.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;


-- 5. RLS policies in full.
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;


-- 6. Constraints: primary keys, unique, foreign keys, checks.
--    The budgets upsert needs a UNIQUE on (user_uuid, budget) —
--    without it `on_conflict` silently degrades to plain inserts
--    and duplicate budget rows accumulate.
SELECT conrelid::regclass AS table_name,
       conname AS constraint_name,
       CASE contype
         WHEN 'p' THEN 'primary key'
         WHEN 'u' THEN 'unique'
         WHEN 'f' THEN 'foreign key'
         WHEN 'c' THEN 'check'
         ELSE contype::text
       END AS kind,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY table_name, kind, conname;


-- 7. Indexes.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;


-- 8. Triggers (expect on_auth_user_created on auth.users).
SELECT c.relnamespace::regnamespace AS schema_name,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND c.relnamespace::regnamespace::text IN ('public', 'auth')
ORDER BY table_name, trigger_name;


-- 9. Functions / RPCs in public.
--    2026_cleanup_dead_rpcs.sql was supposed to drop
--    get_my_partner_id and generate_transaction_hash — this
--    confirms whether it was actually applied.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;


-- 10. Targeted check for the columns the app writes that are
--     missing from supabase/schema.sql. Each should return one
--     row if the column exists.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'transactions' AND column_name IN ('refunded', 'raw_notification', 'confidence', 'caught_cleared', 'source'))
    OR (table_name = 'overrides'  AND column_name IN ('match_type', 'updated_at'))
    OR (table_name = 'settings'   AND column_name IN ('smart_notifications_enabled', 'link_code'))
    OR (table_name = 'budgets'    AND lower(column_name) = 'visible')
  )
ORDER BY table_name, column_name;
