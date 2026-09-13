-- Migration: two questions instead of one.
--
-- Linking used to mean "everything, combined". Couples do not work that way.
-- Most keep their own budget lines drawn against one household income, and
-- some want their partner to see what a category came to without seeing where
-- they went.
--
--   share_level  — how much of YOUR spending your partner sees. Yours alone to
--                  set and deliberately not symmetric: it is your data, and a
--                  setting that only worked if both agreed would be a
--                  negotiation rather than a choice.
--   budget_mode  — whose budget lines the vials draw. A property of the
--                  HOUSEHOLD, so set_household_budget_mode writes both rows.
--
-- The important half is that share_level is enforced HERE. The partner read on
-- transactions now consults the OWNER's level, so below 'transactions' the rows
-- are refused whatever the app asks for and whatever a future screen forgets to
-- check. A privacy control that only the UI honours is not a privacy control.
--
-- Safe to run more than once.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='settings' AND column_name='share_level'
  ) THEN
    ALTER TABLE public.settings ADD COLUMN share_level text NOT NULL DEFAULT 'transactions'
      CHECK (share_level IN ('transactions', 'categories', 'totals'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='settings' AND column_name='budget_mode'
  ) THEN
    ALTER TABLE public.settings ADD COLUMN budget_mode text NOT NULL DEFAULT 'separate'
      CHECK (budget_mode IN ('separate', 'combined'));
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can view partner transactions" ON public.transactions;
CREATE POLICY "Users can view partner transactions" ON public.transactions
  FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT s.partner_id FROM public.settings s
      WHERE s.user_id = auth.uid() AND s.partner_id IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM public.settings owner
      WHERE owner.user_id = public.transactions.user_id
        AND owner.share_level = 'transactions'
    )
  );

-- The household's income is the two figures added, which means each side needs
-- the other's. The narrowest possible way to give it: one number, for your
-- partner only, and nothing else from that row.
CREATE OR REPLACE FUNCTION public.partner_monthly_income()
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_partner uuid; v_income numeric;
BEGIN
  SELECT s.partner_id INTO v_partner FROM public.settings s WHERE s.user_id = auth.uid();
  IF v_partner IS NULL THEN RETURN NULL; END IF;
  SELECT s.monthly_income INTO v_income FROM public.settings s WHERE s.user_id = v_partner;
  RETURN v_income;
END;
$$;

-- What your partner spent this month, at whatever detail THEY allow. A policy
-- can only say yes or no to a row; "you may know the total but not the rows" is
-- a different shape of answer and needs a function to compute it.
CREATE OR REPLACE FUNCTION public.partner_month_summary(p_month text)
RETURNS TABLE (share_level text, budget text, total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_partner uuid; v_level text;
BEGIN
  IF p_month IS NULL OR p_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'Month must look like 2026-09';
  END IF;
  SELECT s.partner_id INTO v_partner FROM public.settings s WHERE s.user_id = auth.uid();
  IF v_partner IS NULL THEN RETURN; END IF;
  SELECT s.share_level INTO v_level FROM public.settings s WHERE s.user_id = v_partner;
  IF v_level IS NULL OR v_level = 'transactions' THEN RETURN; END IF;

  IF v_level = 'categories' THEN
    RETURN QUERY
      SELECT v_level, t.budget::text, SUM(t.amount)::numeric
        FROM public.transactions t
       WHERE t.user_id = v_partner AND to_char(t.date, 'YYYY-MM') = p_month
         AND t.is_projected = false
       GROUP BY t.budget;
  ELSE
    RETURN QUERY
      SELECT v_level, NULL::text, COALESCE(SUM(t.amount), 0)::numeric
        FROM public.transactions t
       WHERE t.user_id = v_partner AND to_char(t.date, 'YYYY-MM') = p_month
         AND t.is_projected = false;
  END IF;
END;
$$;

-- Whose budgets the vials show belongs to the household, so it writes both
-- rows — and only where they still point back at you, the same guard
-- unlink_partner uses.
CREATE OR REPLACE FUNCTION public.set_household_budget_mode(p_mode text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_me uuid := auth.uid(); v_partner uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_mode NOT IN ('separate', 'combined') THEN RAISE EXCEPTION 'Unknown budget mode'; END IF;
  SELECT s.partner_id INTO v_partner FROM public.settings s WHERE s.user_id = v_me;
  UPDATE public.settings s SET budget_mode = p_mode WHERE s.user_id = v_me;
  IF v_partner IS NOT NULL THEN
    UPDATE public.settings s SET budget_mode = p_mode
     WHERE s.user_id = v_partner AND s.partner_id = v_me;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.partner_monthly_income()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_month_summary(text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_household_budget_mode(text)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.partner_monthly_income()        FROM anon;
REVOKE EXECUTE ON FUNCTION public.partner_month_summary(text)     FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_household_budget_mode(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.partner_monthly_income()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_month_summary(text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_household_budget_mode(text)     TO authenticated;
