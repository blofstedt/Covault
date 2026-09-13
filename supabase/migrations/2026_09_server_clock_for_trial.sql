-- Migration: let the app ask the database what time it is.
--
-- The trial is "you have until this date", and the app was deciding that with
-- the phone's own clock — which the person being charged controls. Winding the
-- phone back a month extended the trial indefinitely and nothing downstream
-- would ever have noticed.
--
-- One function, returning now(). The app takes the difference between that and
-- its own clock at load time and carries it as an offset, so every entitlement
-- question is asked against the database's clock rather than the device's.
-- See lib/serverClock.ts.
--
-- Deliberately trivial and read-only. It takes no arguments, touches no table
-- and leaks nothing: the only thing it can tell you is the time, which the
-- HTTP response header would have told you anyway if CORS exposed it. STABLE
-- rather than IMMUTABLE, because it plainly is not.
--
-- Safe to run more than once. The app works without it: an unreachable or
-- missing function leaves the offset at zero and the app behaves exactly as it
-- did before, which is the right way round — a household locked out of its own
-- budget because a round trip failed is far worse than a trial running long.

CREATE OR REPLACE FUNCTION public.server_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT now();
$$;

REVOKE ALL ON FUNCTION public.server_now() FROM public;
GRANT EXECUTE ON FUNCTION public.server_now() TO authenticated;
