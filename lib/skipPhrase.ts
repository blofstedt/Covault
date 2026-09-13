// lib/skipPhrase.ts
//
// Choosing WHICH words of an alert a skip rule matches on.
//
// A skip rule is created from the whole text of one alert, which made
// `contains` very nearly a slower spelling of `exact`: the only alert long
// enough to contain the entire text of an alert is that alert. The rule the
// user actually wants is usually a few words out of the middle — "Points are
// calculated", "calculated to be" — the part that says which KIND of alert
// this is, without the part that changes every time.
//
// Nothing here changes how matching works. A shortened pattern is matched by
// exactly the same `contains` test as a long one (see matchesPattern in
// notificationRules.ts); this module only decides which span of words the
// pattern is, and whether that span is safe enough to save.
//
// "Safe" is the whole problem. A short phrase silences alerts the user never
// sees, with the app closed, and a purchase silenced that way is gone — there
// is no row, no review item and nothing to notice. So two things stand in
// front of it: a floor on how much wording a rule must carry, and a check
// against the alerts the user's own captured purchases arrived on, which is
// the only real evidence available about what a phrase would do.

import type { Transaction } from '../types';
import { distinctiveTokens } from './notificationShape';
import { matchesPattern } from './notificationRules';

/** A word of the source alert, and where it sits in it. */
export interface PhraseWord {
  text: string;
  start: number;
  end: number;
}

/**
 * Fewest words a phrase may carry.
 *
 * Two words of ordinary English turn up in half the alerts a bank sends. This
 * is a floor, not a safety guarantee — the check against real purchases below
 * is what actually catches a dangerous phrase.
 */
export const MIN_PHRASE_WORDS = 3;

/**
 * Below this many words of its own — words that are not the boilerplate every
 * bank alert carries — a phrase is allowed but called thin.
 *
 * Not a refusal, because the useful phrases are sometimes thin: "calculated to
 * be" carries one word of its own and is a perfectly good rule, since no bank
 * announces a purchase that way. The user is told, and decides.
 */
const COMFORTABLE_DISTINCTIVE_WORDS = 2;

/** The words of an alert, with their positions, so a span can be rebuilt. */
export function phraseWords(text: string): PhraseWord[] {
  const out: PhraseWord[] = [];
  if (!text) return out;
  // A "word" is any run that is not whitespace. Punctuation stays attached, so
  // the span that comes back is the alert's own text rather than a rewriting
  // of it — the pattern has to be a substring of what the bank actually sends.
  const re = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return out;
}

/** The alert's own text between two chosen words, inclusive, in order. */
export function phraseBetween(text: string, words: PhraseWord[], a: number, b: number): string {
  if (!words.length) return '';
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(words.length - 1, Math.max(a, b));
  if (lo > hi) return '';
  return text.slice(words[lo].start, words[hi].end).trim();
}

export type PhraseVerdict = 'ok' | 'thin' | 'too-short' | 'no-words' | 'hits-purchases';

export interface PhraseCheck {
  /** Whether this phrase may be saved at all. */
  allowed: boolean;
  verdict: PhraseVerdict;
  /** One sentence for the user, in consequences. */
  message: string;
  /** Purchases whose own alert this phrase would have silenced. */
  matched: Transaction[];
}

/**
 * Whether a phrase is fit to be a skip rule, and what to tell the user.
 *
 * The purchase check is the important half and the reason this takes the
 * transaction list at all. Every captured purchase stores the alert it arrived
 * on, so "would this phrase have silenced something real?" is a question with
 * a real answer rather than a guess about wording. A hit is a refusal, not a
 * warning: there is no reading of "this would have eaten three of your
 * purchases" that ends in saving it.
 *
 * It proves a phrase is dangerous; it can never prove one is safe. Only
 * captured purchases are in evidence, so a bank the household has not used
 * yet, or a purchase Covault never saw, is not represented. That is why the
 * word floor stays even though the check exists.
 */
export function checkSkipPhrase(phrase: string, transactions: Transaction[]): PhraseCheck {
  const trimmed = (phrase || '').trim();
  const words = phraseWords(trimmed);

  if (words.length < MIN_PHRASE_WORDS) {
    return {
      allowed: false,
      verdict: 'too-short',
      message: `Pick at least ${MIN_PHRASE_WORDS} words — fewer than that turns up in ordinary purchase alerts.`,
      matched: [],
    };
  }

  // Words of its own: what is left after the boilerplate every alert carries
  // ("you", "your", "card", "spent", "purchase", "alert"…) and anything under
  // three letters. See notificationShape.ts, which keeps that list.
  const own = distinctiveTokens(trimmed);
  if (own.length === 0) {
    return {
      allowed: false,
      verdict: 'no-words',
      message: 'Every word here appears in ordinary purchase alerts. Include at least one word specific to this kind of alert.',
      matched: [],
    };
  }

  const matched = transactions.filter((tx) =>
    !!tx.raw_notification && matchesPattern(tx.raw_notification, trimmed, 'contains'));

  if (matched.length > 0) {
    const names = Array.from(new Set(matched.map((tx) => tx.vendor).filter(Boolean))).slice(0, 3);
    const where = names.length ? ` (${names.join(', ')})` : '';
    return {
      allowed: false,
      verdict: 'hits-purchases',
      message: matched.length === 1
        ? `This would also have hidden a real purchase${where}. Pick more of the wording.`
        : `This would also have hidden ${matched.length} real purchases${where}. Pick more of the wording.`,
      matched,
    };
  }

  if (own.length < COMFORTABLE_DISTINCTIVE_WORDS) {
    return {
      allowed: true,
      verdict: 'thin',
      message: 'Only one word here is specific to this alert. If your bank ever words a purchase this way, it will be hidden too.',
      matched: [],
    };
  }

  return {
    allowed: true,
    verdict: 'ok',
    message: 'No purchase you have captured is worded like this.',
    matched: [],
  };
}
