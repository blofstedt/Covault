// lib/categoryFrequency.ts
//
// Which of two or more categories this vendor has actually been filed under
// before, so an ambiguous capture can be pre-filled with a real guess instead
// of nothing — without that guess ever being trusted enough to file itself.
//
// This exists for exactly one caller: step 5a of the capture pipeline, when a
// vendor matches more than one of the user's own learned rules (Walmart taught
// as both Groceries and Other, say). The app genuinely cannot know which this
// purchase was, so it has always routed the row to Review rather than guess —
// see the conflict handling in lib/notificationProcessor.ts. What it used to
// leave blank is filled in here with whichever of the conflicting categories
// this same vendor has actually been filed under most often, so the person
// reviewing it sees a sensible starting point instead of "Other" by default.
//
// The count comes from real transaction history, not from the rules
// themselves — a rule is a pattern the user taught once and carries no
// frequency of its own, and "most recently taught" is the exact anti-pattern
// the conflict check exists to avoid trusting (see the comment beside
// `overrideRuleConflict`).

/** The one field this needs from a past transaction. */
export interface FrequencyRow {
  budget?: string | null;
}

/**
 * The candidate with the strictly highest count, or null.
 *
 * Matching is case-insensitive against `rows[].budget` (Postgres enum values
 * are stored with fixed casing, but this stays defensive rather than trusting
 * it), and the returned string is always one of `candidateNames` verbatim, so
 * a caller can hand it straight to the same `availableCategories.find(...)`
 * lookup every other match in step 5a already uses.
 *
 * A tie returns null rather than picking arbitrarily. A coin-flip guess
 * dressed up as a suggestion is worse than no suggestion at all — it looks
 * considered when it is not, and the one thing worse than an empty category
 * field on a row awaiting review is a confidently wrong one.
 */
export function mostFrequentCategory(
  rows: readonly FrequencyRow[],
  candidateNames: readonly string[],
): string | null {
  if (candidateNames.length === 0) return null;
  const byLower = new Map(candidateNames.map((name) => [name.toLowerCase(), name] as const));

  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = (row.budget || '').trim().toLowerCase();
    if (!key || !byLower.has(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  let winnerKey: string | null = null;
  let winnerCount = 0;
  let tied = false;
  for (const [key, count] of counts) {
    if (count > winnerCount) {
      winnerKey = key;
      winnerCount = count;
      tied = false;
    } else if (count === winnerCount) {
      tied = true;
    }
  }

  if (!winnerKey || tied) return null;
  return byLower.get(winnerKey) ?? null;
}
