-- Pin search_path on the SECURITY DEFINER function that lacked it, and stop
-- publishing a trigger function as a REST endpoint.
--
-- APPLIED to the live project on 2026-09-07. Kept here as the record of what
-- was run, and pinned by definerFunctionGrants.test.ts.
--
-- What this is NOT: an incident. Every finding below was read against the live
-- definition before anything was changed, and none of it was exploitable.
-- Supabase's linter reports the shape, not the reachability, and the two are
-- worth telling apart before anybody panics:
--
--   * The three partner RPCs are published to `anon`. Each one opens with
--     `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'`, so an
--     anonymous caller reached the guard and got an error, never a link. The
--     revokes below mean such a request cannot reach the guard at all.
--
--   * `handle_new_user` is published to everyone at
--     /rest/v1/rpc/handle_new_user. Postgres refuses to invoke a trigger
--     function directly however it is granted, so the endpoint could not do
--     anything. It should still not exist.
--
-- The one finding that is a real weakness rather than exposed surface is the
-- missing search_path on `handle_new_user`, because it is the only function
-- here that is both SECURITY DEFINER and unpinned: it runs with its owner's
-- privileges while resolving unqualified names against the CALLER's
-- search_path. That is the standard privilege-escalation shape, and the reason
-- the three partner functions already set it.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. search_path
-- ─────────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;

-- The remaining three run as the invoker, so this is hygiene rather than a
-- fix. Included so that "every function in this schema pins its search_path"
-- is a rule with no exceptions to remember.
ALTER FUNCTION public.generate_transaction_hash(numeric, text, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;
ALTER FUNCTION public.match_vendor(uuid, text) SET search_path = public, pg_temp;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Who may call what
-- ─────────────────────────────────────────────────────────────────────────────
--
-- FROM PUBLIC as well as from the named roles, for the reason the community
-- rules migration already records: this schema carries default privileges
-- granting EXECUTE on every new function to `anon` and `authenticated`, so
-- revoking from those two alone leaves the PUBLIC grant standing and looks
-- like it worked.

-- A trigger on auth.users, not an API. The trigger fires as its definer and is
-- unaffected by this, so signup keeps working.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- The partner RPCs need a signed-in caller and nobody else. The app calls all
-- three as `authenticated`, which is re-granted explicitly below rather than
-- left to a default that may not survive the next schema change.
REVOKE ALL ON FUNCTION public.link_partner_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_partner_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlink_partner() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.link_partner_by_code(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.link_partner_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unlink_partner() FROM anon;
GRANT EXECUTE ON FUNCTION public.link_partner_by_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.link_partner_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_partner() TO authenticated;

-- Verified after applying, on the live project:
--
--   proname                   anon   authenticated
--   handle_new_user           false  false
--   link_partner_by_code      false  true
--   link_partner_by_email     false  true
--   unlink_partner            false  true
--
-- and every function in `public` now reports
-- proconfig = {"search_path=public, pg_temp"}.
