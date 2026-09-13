-- Migration: remove linking by email address.
--
-- `link_partner_by_email` linked two accounts on ONE person's say-so. The
-- caller supplied an email, the function wrote both settings rows, and the
-- other person was never asked and never told — so anyone who knew a Covault
-- user's email address could attach themselves to that account and read its
-- transactions and budgets through the partner SELECT policies. The screen
-- even called the button "Send Request", which is not what it did.
--
-- `link_partner_by_code` is the only route now, and always should have been:
-- the code exists on the other person's screen, so there is no way to obtain
-- one without asking them for it, and the asking IS the permission.
--
-- Safe to run more than once. Nothing in the app calls the dropped function —
-- see lib/hooks/useHouseholdLinking.ts, which no longer has an email path.

DROP FUNCTION IF EXISTS public.link_partner_by_email(text);
