// lib/notificationShape.ts
//
// The shape of a notification: what is left when the numbers are taken out.
//
// A skip rule stores the whole text of an alert the user marked as "not a
// transaction" — and that text contains the alert's own number. So the rule
// they created from "BTC is trading at $104,455.73" could never match again:
// the next one says $98,220.10. Every rule made from an alert that reports a
// changing figure — a price, a balance, a rate, a points total — was dead the
// moment it was written, while appearing in the rules list as though it were
// working.
//
// The shape is the fix. Two alerts of the same kind have the same words in the
// same order and differ only in their numbers, so masking every number leaves
// something that compares usefully:
//
//   "BTC is trading at $104,455.73"  ->  "btc is trading at $#"
//   "BTC is trading at $98,220.10"   ->  "btc is trading at $#"
//
// Nothing else is masked. The merchant, the bank and every other word survive
// intact, which is what keeps this from being a blunt instrument: a rule made
// from a Loblaws alert still has "loblaws" in its shape and cannot match a
// Costco one.
//
// Mirrored into `shapeOf` in android-custom/NotificationListener.java, because
// the decision to stay quiet is made there, with the app closed, before any of
// this runs. notificationShapeMirror.test.ts fails the build if the two drift.

/**
 * One placeholder per run of digits, and any separators inside it.
 *
 * Deliberately greedy about what counts as part of a number: "104,455.73",
 * "2026-08-21" and "6:24" are each one number rather than several, so an alert
 * carrying a date or a time still reduces to a stable shape.
 */
const NUMBER_RUN = /[0-9][0-9.,:/-]*/g;

/**
 * Month and weekday names, masked ONLY where they sit against a number.
 *
 * "Your balance is $1,204.55 as of Aug 21" and the same alert in September are
 * the same alert, and without this they are two different shapes — so the rule
 * the user made from one of them would come back to life for exactly one month
 * and then die again.
 *
 * The adjacency requirement is what makes this safe. Several of these words
 * are ordinary English — "may", "march", "sat", "wed" — and masking them
 * wherever they appeared would quietly rub out real words in real alerts.
 * Next to a number they are a date; on their own they are left alone.
 *
 * Written as two passes rather than one with a lookbehind, because lookbehind
 * is not available in every browser this app is served to and a regex that
 * fails to compile takes the whole module down with it.
 */
const DATE_WORDS =
  'january|february|march|april|may|june|july|august|september|october|november|december|' +
  'jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec|' +
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday|' +
  'mon|tues|tue|wed|thurs|thur|thu|fri|sat|sun';
const DATE_WORD_BEFORE_NUMBER = new RegExp(`\\b(?:${DATE_WORDS})\\s+#`, 'g');
const DATE_WORD_AFTER_NUMBER = new RegExp(`#\\s+(?:${DATE_WORDS})\\b`, 'g');

export function notificationShape(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(NUMBER_RUN, '#')
    .replace(DATE_WORD_BEFORE_NUMBER, '# #')
    .replace(DATE_WORD_AFTER_NUMBER, '# #')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether an alert is the same shape as a stored pattern.
 *
 * `contains` compares the same way `contains` always has, one level down: is
 * the pattern's shape somewhere inside the alert's shape.
 */
export function shapeMatches(
  pattern: string,
  text: string,
  patternType: 'exact' | 'contains',
): boolean {
  const patternShape = notificationShape(pattern);
  const textShape = notificationShape(text);
  if (!patternShape || !textShape) return false;
  // A shape of nothing but placeholders would match half the world. This is
  // what stops a rule made from an alert that is only a number ("$42.10") from
  // silencing every purchase of any amount.
  if (!/[a-z]/.test(patternShape)) return false;
  return patternType === 'contains'
    ? textShape.includes(patternShape)
    : textShape === patternShape;
}

// ─── Telling the model when to bother ────────────────────────────

/** Words worth comparing: no numbers, no placeholders, nothing tiny. */
export function shapeTokens(text: string): string[] {
  return notificationShape(text)
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

/**
 * The words every bank alert contains, which therefore say nothing about
 * whether two alerts are the same one.
 *
 * This list is the difference between a gate that works and one that does not.
 * "ACME GYM MEMBERSHIP You spent $45.00 with your credit card" and "LOBLAWS
 * #1042 You spent $84.21 with your credit card" share six words out of nine —
 * two thirds — and every one of the six is boilerplate. Comparing everything
 * would have put an ordinary grocery run in front of the model as a candidate
 * for being silenced.
 */
const BOILERPLATE = new Set([
  'you', 'your', 'yours', 'the', 'and', 'for', 'was', 'were', 'has', 'have',
  'with', 'from', 'this', 'that', 'been', 'our', 'ours', 'not', 'now', 'via',
  'card', 'cards', 'credit', 'debit', 'account', 'accounts', 'ending',
  'spent', 'spend', 'charge', 'charged', 'purchase', 'purchased', 'paid',
  'payment', 'transaction', 'transactions', 'amount', 'total', 'used',
  'using', 'made', 'alert', 'alerts', 'update', 'updates', 'notification',
]);

/** What is left of an alert once the boilerplate is gone. */
export function distinctiveTokens(text: string): string[] {
  return shapeTokens(text).filter((token) => !BOILERPLATE.has(token));
}

/**
 * How much of a stored pattern's wording turns up in an alert, 0..1.
 *
 * This is the cheap gate in front of the model. Asking a language model to
 * compare every capture against every rule the user has ever made would put an
 * inference on the path of every purchase, for a question whose answer is
 * almost always an obvious no — a Loblaws charge has nothing in common with a
 * crypto price alert. Overlap costs two string splits and settles that.
 */
export function wordingOverlap(pattern: string, text: string): number {
  const patternWords = new Set(distinctiveTokens(pattern));
  // Fewer than two words of its own is not something to compare against. A
  // rule that distinctive-reduces to one word would put every alert sharing
  // that word in front of the model, which is how a gate becomes a funnel.
  if (patternWords.size < 2) return 0;
  const textWords = new Set(distinctiveTokens(text));
  let shared = 0;
  for (const word of patternWords) {
    if (textWords.has(word)) shared += 1;
  }
  return shared / patternWords.size;
}

/**
 * How much of a rule's wording an alert has to carry before the model is asked
 * about it.
 *
 * High on purpose. Below this the two texts are not rewordings of each other,
 * they are different notifications, and the model's opinion on them is not
 * worth the inference — nor the risk of it saying yes.
 */
export const MODEL_CANDIDATE_OVERLAP = 0.6;

/** The stored patterns close enough to an alert to be worth asking about. */
export function candidatePatternsFor(
  patterns: string[],
  text: string,
  threshold: number = MODEL_CANDIDATE_OVERLAP,
): string[] {
  return patterns
    .map((pattern) => ({ pattern, score: wordingOverlap(pattern, text) }))
    .filter((row) => row.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.pattern);
}
