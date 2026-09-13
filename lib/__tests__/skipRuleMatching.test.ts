import { describe, it, expect } from 'vitest';
import { matchesRule } from '../notificationRules';
import type { NotificationRule } from '../notificationRules';

/**
 * What "exact" and "contains" actually mean on a skip pattern.
 *
 * The rules screen now explains both in words, and this is what those words
 * have to stay true to:
 *
 *   Exact    — the whole alert, start to finish, same words in the same order,
 *              nothing before or after it.
 *   Contains — those words, in that order, anywhere inside a longer alert.
 *              Not some of the words, and not in any order.
 *   Both     — amounts and dates are ignored, so the same alert with a
 *              different figure still matches.
 *
 * If any of these change, the sentences on that screen become false, and a
 * user widening a rule on the strength of them is silencing alerts they did
 * not mean to. That is the whole reason this file exists.
 */

const rule = (pattern: string, pattern_type: 'exact' | 'contains'): NotificationRule => ({
  id: 'r1',
  user_id: 'u1',
  pattern,
  pattern_type,
  use_count: 0,
  last_used_at: null,
  created_at: '2026-01-01T00:00:00Z',
});

const PATTERN = 'Your Points balance is 12,340';

describe('exact', () => {
  const exact = rule(PATTERN, 'exact');

  it('matches the same alert word for word', () => {
    expect(matchesRule(PATTERN, exact)).toBe(true);
  });

  it('matches the same alert carrying a different figure', () => {
    // The reason the rule is not dead on arrival: the text it was made from
    // carries that day's number, and the next one will not.
    expect(matchesRule('Your Points balance is 9,880', exact)).toBe(true);
  });

  it('matches the same alert on a different date', () => {
    const dated = rule('Your balance is $1,204.55 as of Aug 21', 'exact');
    expect(matchesRule('Your balance is $998.10 as of Sep 4', dated)).toBe(true);
  });

  it('does NOT match when the alert says anything else as well', () => {
    expect(matchesRule(`Rewards update: ${PATTERN} — see details`, exact)).toBe(false);
  });

  it('does NOT match a different merchant saying the same kind of thing', () => {
    expect(matchesRule('Your Rewards balance is 12,340', exact)).toBe(false);
  });
});

describe('contains', () => {
  const contains = rule(PATTERN, 'contains');

  it('matches when the wording sits inside a longer alert', () => {
    expect(matchesRule(`Rewards update: ${PATTERN} — see details`, contains)).toBe(true);
  });

  it('matches a longer alert carrying a different figure', () => {
    expect(matchesRule('Rewards update: Your Points balance is 9,880 — see details', contains))
      .toBe(true);
  });

  it('does NOT match the same words in a different order', () => {
    expect(matchesRule('Is your Points balance 12,340?', contains)).toBe(false);
  });

  it('does NOT match on only some of the words', () => {
    expect(matchesRule('Your Points have expired', contains)).toBe(false);
  });

  it('does NOT match when another word is spliced into the middle', () => {
    // Uninterrupted, not merely present: the run of words has to be intact.
    expect(matchesRule('Your Points cash balance is 12,340', contains)).toBe(false);
  });
});

describe('both', () => {
  it('refuse a pattern that is nothing but a number', () => {
    // A shape of pure placeholders would silence every purchase of any amount.
    const numeric = rule('$42.10', 'contains');
    expect(matchesRule('You spent $42.10 at Loblaws', numeric)).toBe(false);
  });
});
