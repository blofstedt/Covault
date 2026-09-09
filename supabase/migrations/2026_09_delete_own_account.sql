-- The right to have your account actually deleted, not just "email us."
--
-- APPLIED to the live project on 2026-09-09, and proved end to end against a
-- disposable test account before this was written: created a user, a partner
-- linked to it, and one row in every table a real account touches, ran this
-- exact deletion, and confirmed every row was gone and the partner's own
-- settings row survived with the dangling reference cleared rather than
-- pointing at a user id that no longer existed.
--
-- Four of `public`'s tables cascade automatically from a deletion of
-- auth.users (settings, transactions, overrides, rule_contributions) —
-- verified with pg_constraint, not assumed. Three do not:
--
--   * budgets.user_uuid and notification_rules.user_id are both NO ACTION,
--     which means deleting the auth user first would fail outright with a
--     foreign key violation rather than leaving anything orphaned. Silent
--     data loss was never the risk here; an account stuck half-deleted was.
--   * settings.partner_id is also NO ACTION, and unlike the two above it
--     names ANOTHER user's row, not the one being deleted — a partner who
--     linked with this account would be left pointing at a user id that no
--     longer exists. Cleared explicitly, the same way unlink_partner()
--     already clears it for a live user choosing to unlink.
--
-- Takes no parameters and always deletes auth.uid(), never an id passed in —
-- the same shape as unlink_partner() and the two link_partner_by_* functions,
-- so there is no argument to get wrong and no way to delete an account other
-- than the caller's own.

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.settings
  SET partner_id = NULL, partner_name = NULL, partner_email = NULL
  WHERE partner_id = v_me;

  DELETE FROM public.budgets WHERE user_uuid = v_me;
  DELETE FROM public.notification_rules WHERE user_id = v_me;

  -- Everything else — settings, transactions, overrides, rule_contributions,
  -- and every auth.* table Supabase manages (identities, sessions,
  -- mfa_factors, refresh tokens, and so on) — cascades from this.
  DELETE FROM auth.users WHERE id = v_me;
END;
$function$;

-- Same convention as every other SECURITY DEFINER function in this schema:
-- revoke the default grant every new function gets, then grant back only to
-- signed-in callers.
REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
