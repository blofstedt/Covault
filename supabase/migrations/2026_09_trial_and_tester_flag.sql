-- ============================================================
-- Migration: is_tester flag, and the trial length change to match
-- the $6.99/month, 1-month-trial plan
-- ============================================================
-- Two independent changes, bundled because they both touch the same
-- signup trigger and the same rollout.
--
-- 1. settings.is_tester — a permanent, manually-set exemption from the
--    trial/subscription check entirely. There is no admin UI for this;
--    it is flipped by hand in the database for accounts that should never
--    be asked to pay (the app owner's own household). See
--    lib/entitlement.ts for where this is read.
--
-- 2. handle_new_user() granted a 14-day trial. The plan is now a 1-month
--    trial, so new signups from here on get `now() + interval '1 month'`
--    instead. This does NOT touch existing rows — anyone already mid-trial
--    keeps the trial_ends_at they were already given; changing it after
--    the fact would be moving the goalposts on someone already using the
--    app under the old number.
-- ============================================================

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS is_tester boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.settings (
    user_id,
    name,
    email,
    monthly_income,
    trial_started_at,
    trial_ends_at,
    trial_consumed,
    subscription_status
  )
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'full_name',
      split_part(NEW.email, '@', 1),
      'User'
    ),
    NEW.email,
    5000,
    now(),
    now() + interval '1 month',
    true,
    'none'
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;
