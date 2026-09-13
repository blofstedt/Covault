import { describe, it, expect } from 'vitest';
import {
  phraseWords,
  phraseBetween,
  checkSkipPhrase,
  MIN_PHRASE_WORDS,
} from '../skipPhrase';
import { matchesPattern } from '../notificationRules';
import type { Transaction } from '../../types';

/**
 * Picking a few words out of an alert is what makes `contains` mean anything.
 * A rule is created from the whole text of one alert, and a pattern that long
 * can only ever be contained by that alert — so until now the two match types
 * did very nearly the same thing.
 *
 * The danger runs the other way, though: a short phrase silences alerts the
 * user never sees, with the app closed, and a purchase silenced that way
 * leaves no row and no review item to notice. So a phrase has to get past a
 * floor on its wording AND a check against the alerts the household's own
 * purchases actually arrived on.
 */

const ALERT = 'Rewards: Your points are calculated to be 12,340 as of Aug 21';

const purchase = (vendor: string, raw: string): Transaction => ({
  id: vendor,
  vendor,
  amount: 10,
  date: '2026-09-01',
  raw_notification: raw,
} as unknown as Transaction);

describe('picking the words', () => {
  it('hands back the alert own text between two taps', () => {
    const words = phraseWords(ALERT);
    const first = words.findIndex((w) => w.text === 'points');
    const last = words.findIndex((w) => w.text === 'calculated');
    expect(phraseBetween(ALERT, words, first, last)).toBe('points are calculated');
  });

  it('does not care which of the two words was tapped first', () => {
    const words = phraseWords(ALERT);
    const a = words.findIndex((w) => w.text === 'calculated');
    const b = words.findIndex((w) => w.text === 'points');
    expect(phraseBetween(ALERT, words, a, b)).toBe('points are calculated');
  });

  it('keeps the phrase a substring of what the bank actually sent', () => {
    // Punctuation and spacing come through untouched, so the pattern can still
    // be found inside the next copy of the alert.
    const words = phraseWords(ALERT);
    const phrase = phraseBetween(ALERT, words, 0, 2);
    expect(ALERT).toContain(phrase);
  });

  it('still matches the same alert with a different figure and date', () => {
    const words = phraseWords(ALERT);
    const first = words.findIndex((w) => w.text === 'points');
    const last = words.findIndex((w) => w.text === 'be');
    const phrase = phraseBetween(ALERT, words, first, last);
    expect(phrase).toBe('points are calculated to be');
    expect(matchesPattern(
      'Rewards: Your points are calculated to be 9,880 as of Sep 4',
      phrase,
      'contains',
    )).toBe(true);
  });
});

describe('whether a phrase is fit to save', () => {
  it('refuses fewer than three words', () => {
    const check = checkSkipPhrase('are calculated', []);
    expect(check.allowed).toBe(false);
    expect(check.verdict).toBe('too-short');
    expect(check.message).toContain(String(MIN_PHRASE_WORDS));
  });

  it('refuses a phrase made entirely of words every alert carries', () => {
    // "You spent your" would sit inside almost every purchase alert the
    // household will ever receive.
    const check = checkSkipPhrase('you spent your', []);
    expect(check.allowed).toBe(false);
    expect(check.verdict).toBe('no-words');
  });

  it('refuses a phrase that would have hidden a real purchase, and names it', () => {
    const check = checkSkipPhrase('purchase at Loblaws was', [
      purchase('Loblaws', 'A purchase at Loblaws was approved for $84.21'),
    ]);
    expect(check.allowed).toBe(false);
    expect(check.verdict).toBe('hits-purchases');
    expect(check.message).toContain('Loblaws');
    expect(check.matched).toHaveLength(1);
  });

  it('catches a purchase worded the same way with a different amount', () => {
    // The check has to be the same one the rule will use, or it would clear a
    // phrase that goes on to silence the next copy of that alert.
    const check = checkSkipPhrase('purchase at Loblaws was', [
      purchase('Loblaws', 'A purchase at Loblaws was approved for $12.00'),
    ]);
    expect(check.allowed).toBe(false);
  });

  it('allows a thin phrase but says what it risks', () => {
    // One word of its own. Useful — no bank announces a purchase this way —
    // so it is a warning rather than a refusal, and the user decides.
    const check = checkSkipPhrase('calculated to be', [
      purchase('Loblaws', 'A purchase at Loblaws was approved for $84.21'),
    ]);
    expect(check.allowed).toBe(true);
    expect(check.verdict).toBe('thin');
  });

  it('clears a phrase no captured purchase is worded like', () => {
    const check = checkSkipPhrase('points are calculated', [
      purchase('Loblaws', 'A purchase at Loblaws was approved for $84.21'),
      purchase('Shell', 'You spent $60.00 at Shell'),
    ]);
    expect(check.allowed).toBe(true);
    expect(check.verdict).toBe('ok');
  });

  it('ignores purchases with no alert text rather than counting them as clear', () => {
    const noRaw = { id: 'x', vendor: 'Manual', amount: 5, date: '2026-09-01' } as unknown as Transaction;
    expect(checkSkipPhrase('points are calculated', [noRaw]).allowed).toBe(true);
  });
});
