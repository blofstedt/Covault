-- ============================================================
-- Verify: RLS is enabled and policies match the documented intent
-- ============================================================
-- Run this in the Supabase SQL editor or via psql, and read the
-- output. Anything that says "MISSING:" or "EXPECTED:" means
-- something drifted and the canonical schema in supabase/schema.sql
-- is wrong about the live DB.
--
-- Read-only: this script does NOT modify the database.
-- ============================================================

-- 1. Confirm RLS is enabled on every public table
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 2. List every policy and what it allows
SELECT
  tablename,
  policyname,
  cmd AS command,
  roles,
  qual AS using_clause,
  with_check AS with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 3. Cross-check: for each table, expected policies per schema.sql
WITH expected(table_name, expected_policies) AS (
  VALUES
    ('settings',      ARRAY['Users can view own settings',
                            'Users can view partner settings',
                            'Users can insert own settings',
                            'Users can update own settings']),
    ('transactions',  ARRAY['Users can view own transactions',
                            'Users can view partner transactions',
                            'Users can insert own transactions',
                            'Users can update own transactions',
                            'Users can delete own transactions']),
    ('budgets',       ARRAY['Users can view own budgets',
                            'Users can view partner budgets',
                            'Users can upsert own budgets',
                            'Users can update own budgets']),
    ('overrides',     ARRAY['Users can view own overrides',
                            'Users can insert own overrides',
                            'Users can update own overrides',
                            'Users can delete own overrides']),
    ('banks',         ARRAY['Anyone can read banks'])
)
SELECT
  e.table_name,
  e.expected_policies AS expected,
  array_agg(p.policyname ORDER BY p.policyname) FILTER (WHERE p.policyname IS NOT NULL) AS actual,
  -- Find policies that exist but aren't in the expected list
  (SELECT array_agg(x) FROM unnest(array_agg(p.policyname)) x
   WHERE x IS NOT NULL AND NOT (x = ANY(e.expected_policies))) AS unexpected,
  -- Find expected policies that don't exist
  (SELECT array_agg(x) FROM unnest(e.expected_policies) x
   WHERE NOT (x = ANY(COALESCE(array_agg(p.policyname), ARRAY[]::text[])))) AS missing
FROM expected e
LEFT JOIN pg_policies p
  ON p.schemaname = 'public' AND p.tablename = e.table_name
GROUP BY e.table_name, e.expected_policies
ORDER BY e.table_name;
