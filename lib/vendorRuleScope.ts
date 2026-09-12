// lib/vendorRuleScope.ts
//
// Which learned rules count as "rules for this merchant".
//
// The capture pipeline and the review screen used to answer that question two
// different ways, and a household's Wendy's is what exposed it.
//
// A rule stores two names: `proper_name`, the polished one the user sees
// ("Wendy's"), and `match_key`, the slug of what the BANK actually sends
// ("wendyscrowfoot"). Matching a capture goes through `match_key`, because
// that is the string that recurs. But a chain announces every branch under its
// own name, so three visits to three Wendy's wrote three separate rules —
// `wendyscrowfoot`, `wendysolympic`, `wendyscochrane` — each able to carry a
// different category, and none of them able to see the others.
//
// Two consequences, both real:
//
//   1. The pipeline's "this vendor has conflicting rules, ask rather than
//      guess" check compared only the rules that matched the incoming slug.
//      One slug matched exactly one rule, so there was never a conflict to
//      find: whatever that single branch's rule said was filed silently, even
//      when every other rule for the same restaurant said something else.
//      A stale `Wendy's → Other` from one branch therefore went on filing
//      Wendy's under Other months after the household had put every other
//      Wendy's in Leisure.
//
//   2. The review screen lists "rules you already have for this vendor" by
//      `proper_name`, so it showed all three — as "Wendy's · Leisure",
//      "Wendy's · Leisure" and "Wendy's · Other". Two of those are the same
//      answer written twice, and nothing on screen distinguished them, so the
//      choice read as a bug rather than a question.
//
// Both are fixed by scoping to the merchant the user sees rather than to the
// slug the bank happens to have sent: `merchantRuleScope` for the pipeline,
// `dedupeByCategory` for the screen.

/** The two fields a rule needs for either function here. */
export interface ScopedRule {
  proper_name?: string | null;
  category_id?: string | null;
}

/** The display name, folded for comparison. Empty means "no name to group on". */
function merchantKey(rule: ScopedRule): string {
  return String(rule?.proper_name || '').trim().toLowerCase();
}

/**
 * Every rule belonging to the same merchant as the ones that matched.
 *
 * `keyMatches` are the rules whose `match_key` actually fires on this capture;
 * the result adds any other rule of the user's carrying the same display name.
 * That is what makes three branches of one restaurant read as one merchant
 * with one — or, here, two — opinions about where it goes.
 *
 * Deliberately only WIDENS the set used to detect disagreement. The rule that
 * gets applied when there is no disagreement is still chosen from `keyMatches`
 * by the caller, so a merchant whose rules all agree behaves exactly as before
 * and keeps matching on the slug the bank sends.
 *
 * Rules with no display name are never grouped: an empty `proper_name` is
 * missing data, not a merchant that every other nameless rule belongs to.
 */
export function merchantRuleScope<T extends ScopedRule>(
  keyMatches: readonly T[],
  allRules: readonly T[],
): T[] {
  if (!keyMatches?.length) return [];

  const names = new Set(keyMatches.map(merchantKey).filter(Boolean));
  if (names.size === 0) return [...keyMatches];

  const scoped = [...keyMatches];
  for (const rule of allRules || []) {
    if (scoped.includes(rule)) continue;
    if (names.has(merchantKey(rule))) scoped.push(rule);
  }
  return scoped;
}

/**
 * The distinct categories a set of rules points at, folded for comparison.
 *
 * More than one is the whole definition of "this household has not settled
 * this merchant", which is what routes a capture to review instead of letting
 * it file itself.
 */
export function distinctCategories(rules: readonly ScopedRule[]): string[] {
  const seen = new Set<string>();
  for (const rule of rules || []) {
    const category = String(rule?.category_id || '').trim().toLowerCase();
    if (category) seen.add(category);
  }
  return [...seen];
}

/**
 * One entry per category, keeping the first of each.
 *
 * For the picker: three rules for one restaurant that between them name two
 * categories is a question with two answers, and offering the same answer
 * twice makes it unanswerable. Order is preserved so the list stays in
 * whatever order the caller loaded its rules in.
 */
export function dedupeByCategory<T>(
  rules: readonly T[],
  categoryOf: (rule: T) => string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const rule of rules || []) {
    const key = String(categoryOf(rule) || '').trim().toLowerCase();
    if (!key) {
      out.push(rule);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
}
