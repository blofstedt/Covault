// lib/vendorMatchConfidence.ts
//
// How sure are we that an incoming vendor is the one a learned rule names?
//
// The overrides table matches with three modes — exact, prefix, contains — and
// that is enough to *suggest* a category, because a wrong suggestion costs the
// user one tap in the review list. Auto-accept has no such safety net: the
// transaction is renamed, filed to a budget, and never shown. So it needs a
// score, not a boolean, and a threshold high enough that only near-certain
// matches get through.
//
// The score is deliberately simple and explainable: how much of the incoming
// vendor name the rule actually accounts for. A rule the user wrote as "tim"
// will match "TIM HORTONS #4471 DOWNTOWN" under `contains`, but it explains
// three characters out of eighteen — nowhere near enough to file money on. The
// same rule written as "timhortons" against "TIM HORTONS #4471" explains most
// of it and scores accordingly.
//
// This is intentionally NOT a fuzzy string distance. Levenshtein would happily
// score "UBER" against "UBER EATS" highly, and those are different budgets.

/** Auto-accept threshold. The user-facing promise is "90%+". */
export const AUTO_ACCEPT_MIN_CONFIDENCE = 0.9;

export type VendorMatchType = 'exact' | 'prefix' | 'contains';

/**
 * Normalise a vendor to the key form the overrides table matches on:
 * lowercase, letters and digits only. Mirrors the normalisation in
 * notificationProcessor's Step 5a so a score can never be computed against
 * differently-shaped strings than the match itself used.
 */
export function toMatchKey(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Score how completely `matchKey` explains `vendorKey`, in 0..1.
 *
 * Both arguments must already be normalised (see toMatchKey). Returns 0 for
 * anything that doesn't actually match under the given mode, so a caller can
 * use the score alone without re-checking the match.
 */
export function scoreVendorMatch(
  vendorKey: string,
  matchKey: string,
  matchType: VendorMatchType | string | null | undefined,
): number {
  if (!vendorKey || !matchKey) return 0;

  const mode = matchType || 'exact';

  if (vendorKey === matchKey) return 1;
  // An exact rule that isn't equal simply doesn't match.
  if (mode === 'exact') return 0;

  if (mode === 'prefix') {
    if (!vendorKey.startsWith(matchKey)) return 0;
  } else if (mode === 'contains') {
    if (!vendorKey.includes(matchKey)) return 0;
  } else {
    return 0;
  }

  // Coverage: the share of the incoming name the rule accounts for. Short
  // rules against long vendor strings score low, which is the whole point —
  // they are the ones most likely to be matching the wrong merchant.
  return matchKey.length / vendorKey.length;
}

/**
 * Should this match be filed without review?
 *
 * Requires the feature to be on, a category to have been resolved, and the
 * score to clear the threshold. Every argument is a reason to *not*
 * auto-accept, so the default on missing information is always review.
 */
export function shouldAutoAccept(opts: {
  enabled: boolean;
  confidence: number;
  hasCategory: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (!opts.hasCategory) return false;
  if (!Number.isFinite(opts.confidence)) return false;
  return opts.confidence >= AUTO_ACCEPT_MIN_CONFIDENCE;
}
