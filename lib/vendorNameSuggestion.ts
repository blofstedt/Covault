// lib/vendorNameSuggestion.ts
//
// "Did you mean the one you already have?" — for the rename field only.
//
// The review page lets a caught purchase be renamed, and every rename teaches
// a rule keyed to the name the user types. So two spellings of one merchant is
// not a cosmetic problem: it is two rules, each learning separately, each able
// to drift to a different category. The field therefore offers the stored
// spelling before it forks one.
//
// WHY THIS IS NOT `fuzzyVendorMatch`
//
// That function answers "are these the same merchant?" for the duplicate skip,
// the soft-duplicate warning, the phone's local vendor memory and the
// recurring-charge lookup — places where a wrong yes costs a real purchase,
// dropped or filed under a stranger's name. Its bar is deliberately high and
// `CLAUDE.md` says in as many words not to loosen it.
//
// The question here is a different one with a different price. Nothing is
// stored on the strength of this answer; it puts two spellings on screen and
// the person picks. A wrong guess costs one declined prompt. So this file may
// reach further than `fuzzyVendorMatch` — and it starts by asking it, so
// everything that function already catches is still caught.
//
// What it adds is the typing mistake: "Safewya", "Shoppers Drug Mrt",
// "Costc". Those are not near-misses in any structural sense — no shared
// prefix, no token agreement — they are the same word with a slip in it, and
// only a character-distance test finds them.

import { fuzzyVendorMatch } from './formatVendorName';

/** Letters and digits only, lower-cased. The same shape `fuzzyVendorMatch`
 *  compares on, so the two agree about what a name "is". */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * How many single-character slips are forgiven at this length.
 *
 * Short names get nothing. At four characters or fewer almost every other
 * short name is one edit away — "Ikea" and "Idea", "Nero" and "Hero" — and a
 * prompt offering to replace one real merchant with another is worse than no
 * prompt, because the safe answer is the one that takes a second look.
 */
export function editBudgetFor(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

/**
 * Edit distance counting a swap of two neighbours as ONE mistake, abandoned
 * once it passes `budget`.
 *
 * The swap is the whole reason this is not plain Levenshtein. "Safewya" for
 * "Safeway" is the commonest typing mistake there is — two fingers landing out
 * of order — and Levenshtein scores it 2, the same as two unrelated wrong
 * letters. At a seven-character name that is over budget, so the one mistake
 * people actually make was the one mistake this could not see. Counting a
 * transposition as one edit (the Damerau restriction, also called optimal
 * string alignment) fixes it without widening the budget, which would have let
 * in genuinely different names instead.
 *
 * The early exit is not only for speed: the rename field runs this against
 * every rule the household has taught, and a household can have hundreds.
 */
export function boundedEditDistance(a: string, b: string, budget: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > budget) return budget + 1;

  // Three rows are needed rather than two: a transposition reaches back two
  // positions in both strings at once.
  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      let cell = Math.min(substitution, deletion, insertion);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cell = Math.min(cell, twoBack[j - 2] + 1);
      }
      current.push(cell);
      if (cell < best) best = cell;
    }
    // Every remaining row can only add to the best cell in this one, so once
    // the whole row is past the budget the answer is too.
    if (best > budget) return budget + 1;
    twoBack = previous;
    previous = current;
  }
  return previous[b.length];
}

/** One spelling already on a rule. */
export interface KnownVendorName {
  properName: string;
}

/**
 * The stored spelling worth offering instead of what was typed, or null.
 *
 * `currentValue` is the name being renamed AWAY from, and it is never offered.
 * It matches nearly anything typed over it — a bank's "Tst-pizza Culture"
 * contains "Pizza Culture" — so offering it would ask whether to keep the very
 * name the user is trying to get rid of, and accepting would save nothing at
 * all, which looks exactly like the rename failing.
 *
 * When several names qualify the closest one wins, so a household with both
 * "Safeway" and "Safeway Gas" taught gets asked about the one it actually
 * looks like rather than whichever the list happened to hold first.
 */
export function pickVendorNameSuggestion(
  known: readonly KnownVendorName[],
  typed: string,
  currentValue: string,
): string | null {
  const typedNorm = normalize(typed);
  if (!typedNorm) return null;
  const current = currentValue.trim().toLowerCase();

  let best: { name: string; distance: number } | null = null;

  for (const rule of known) {
    const name = rule.properName;
    if (!name || name.trim().toLowerCase() === current) continue;

    const nameNorm = normalize(name);
    // Identical once punctuation and case are gone is not a question worth
    // asking: the rename field reuses the stored spelling outright in that
    // case (see `runSave`'s `toVendorKey` check), silently and correctly, so
    // a prompt here would be asking about two names that are already one.
    if (!nameNorm || nameNorm === typedNorm) continue;

    // Tier one: the strict, trusted answer. Scored as the closest possible
    // match so a structural agreement always outranks a spelling slip.
    if (fuzzyVendorMatch(name, typed)) {
      if (!best || best.distance > 0) best = { name, distance: 0 };
      continue;
    }

    // Tier two: the typing mistake. The first character has to survive it —
    // without that anchor a two-edit budget reaches names that share nothing
    // a person would recognise, and the prompt starts guessing rather than
    // recognising.
    if (nameNorm[0] !== typedNorm[0]) continue;
    const budget = editBudgetFor(Math.max(nameNorm.length, typedNorm.length));
    if (budget === 0) continue;
    const distance = boundedEditDistance(nameNorm, typedNorm, budget);
    if (distance > budget) continue;
    if (!best || distance < best.distance) best = { name, distance };
  }

  return best ? best.name : null;
}
