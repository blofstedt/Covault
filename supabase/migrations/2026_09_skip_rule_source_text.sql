-- Migration: keep the alert a skip rule was made from, separately from the
-- words it matches on.
--
-- A rule is created from the whole text of one alert, and `pattern` was both
-- things at once: the text it came from AND the text it matches. That made
-- `contains` very nearly a slower spelling of `exact` — the only alert long
-- enough to contain the whole of an alert is that alert — and it meant
-- shortening the pattern to the few words that matter would destroy the only
-- copy of the alert the rule was made from, so it could never be widened
-- again.
--
-- `source_text` is that copy. `pattern` is free to become a span of it.
--
-- Backfilled from `pattern`, which for every rule written before this IS the
-- original alert. Safe to run more than once. The app works without it: the
-- read falls back to asking for the columns that exist, and a rule with no
-- source text simply offers its pattern as the words to choose from.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_rules'
      AND column_name = 'source_text'
  ) THEN
    ALTER TABLE public.notification_rules ADD COLUMN source_text text;
    UPDATE public.notification_rules SET source_text = pattern WHERE source_text IS NULL;
  END IF;
END $$;
