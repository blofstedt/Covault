// lib/ruleSearch.ts
//
// Finding one rule among hundreds.
//
// A household that has been capturing for a few months has well over a hundred
// learned rules, listed alphabetically. Answering "where does Superstore go?"
// or "why does this keep landing in Other?" meant scrolling, and scrolling past
// the thing you are looking for is the normal outcome.
//
// WHAT THIS IS NOT
//
// Not `fuzzyVendorMatch`, and not `pickVendorNameSuggestion` either. Those two
// answer "are these the same merchant?", where a wrong yes files money in the
// wrong place, so both are deliberately strict. This one answers "does this row
// look like what I typed?" — the person is reading the results and picking, and
// the cost of an extra row in the list is that they read one extra row. So it
// is a plain, generous substring filter, and it should stay one. The moment a
// search box starts being clever about what it thinks you meant, the thing you
// are certain is in there stops appearing and you cannot tell why.
//
// WHAT IT LOOKS AT
//
// Everything visible on the row AND the bank's own spelling underneath it. That
// second half is the point: the reason to go looking for a rule is usually a
// bank alert that went somewhere surprising, and the string in your hand is
// "TST-PIZZA CULTURE" or "amznmktpca", not the tidy name the app shows.

/**
 * Lower-cased, with every run of punctuation turned into a single space.
 *
 * Punctuation has to go rather than be kept: the same merchant is "Wendy's" on
 * one row and "WENDYS" in the key underneath it, and a search for either must
 * find both.
 */
export function normalizeForSearch(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The text a row is searched against: the readable form AND the same thing with
 * the spaces squeezed out.
 *
 * Both, because the two ways people search are incompatible otherwise. Typed
 * naturally it is "wendys crowfoot", which only matches the spaced form; pasted
 * or half-remembered from a bank alert it is "wendyscrowfoot", which only
 * matches the squeezed one. Holding both costs a few bytes per rule and means
 * neither way of typing comes up empty.
 */
export function searchableText(parts: readonly (string | null | undefined)[]): string {
  const spaced = parts
    .map((part) => normalizeForSearch(part || ''))
    .filter(Boolean)
    .join(' ');
  const squeezed = spaced.replace(/ /g, '');
  return spaced ? `${spaced} ${squeezed}` : '';
}

/**
 * The query, split into the terms that all have to match.
 *
 * Every term, not any: "coffee leisure" means the row has to be about coffee
 * AND filed under Leisure. Any-of would make a second word widen the results,
 * which is the opposite of what typing more is for.
 */
export function searchTerms(query: string): string[] {
  const normalized = normalizeForSearch(query);
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/** Does this row satisfy every term? An empty query matches everything. */
export function matchesSearch(haystack: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  if (!haystack) return false;
  return terms.every((term) => haystack.includes(term));
}

/** A learned rule, as much of it as searching cares about. */
export interface SearchableLearnedRule {
  properName: string;
  categoryName: string;
  patterns?: readonly { match_key?: string | null; proper_name?: string | null }[];
}

/**
 * Everything about a learned rule worth searching: the name shown, the category
 * it files into, and every bank spelling that feeds it.
 */
export function learnedRuleHaystack(rule: SearchableLearnedRule): string {
  const patternText = (rule.patterns || []).flatMap((pattern) => [
    pattern.match_key || '',
    pattern.proper_name || '',
  ]);
  return searchableText([rule.properName, rule.categoryName, ...patternText]);
}

/** A skip pattern, as much of it as searching cares about. */
export interface SearchableSkipRule {
  pattern: string;
  pattern_type?: string;
}

/** Skip patterns are searched by their text and by how they match. */
export function skipRuleHaystack(rule: SearchableSkipRule): string {
  return searchableText([rule.pattern, rule.pattern_type]);
}

/**
 * Keep only the rules matching the query, preserving the order given.
 *
 * Order is deliberately left alone rather than sorted by how well each row
 * matched. The list is alphabetical, and alphabetical is what someone scanning
 * a filtered list of merchants expects; "best match first" reshuffles the
 * results on every keystroke, so the row you were reaching for moves out from
 * under your thumb as you finish typing.
 */
export function filterBySearch<T>(
  items: readonly T[],
  terms: readonly string[],
  haystackFor: (item: T) => string,
): T[] {
  if (terms.length === 0) return items.slice();
  return items.filter((item) => matchesSearch(haystackFor(item), terms));
}
