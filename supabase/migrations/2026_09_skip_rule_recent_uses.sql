-- Migration: remember WHAT a skip rule skipped, not just how many times.
--
-- A skip rule works by making things disappear, and until now the only
-- evidence it left was a counter. "Skipped 6 alerts" tells the user nothing
-- about whether those six were the noise they meant to silence or a purchase
-- they will never see — which is the one question worth asking about a rule
-- that widens as easily as this one does.
--
-- One jsonb column holding at most the five most recent, newest first:
--   [{ "at": "2026-09-13T04:11:00.000Z", "text": "BTC is trading at $112,013.15" }]
--
-- Trimmed to five by the app on every write, so the column cannot grow without
-- bound, and each entry's text is truncated before it is stored. The alert
-- text itself is no more sensitive than `transactions.raw_notification`, which
-- this database has always carried.
--
-- Safe to run more than once. The app works without it: the read falls back to
-- asking for use_count alone, and the list simply has nothing to show.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_rules'
      AND column_name = 'recent_uses'
  ) THEN
    ALTER TABLE public.notification_rules
      ADD COLUMN recent_uses jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;
