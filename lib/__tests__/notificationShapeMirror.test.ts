import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  notificationShape,
  shapeMatches,
  wordingOverlap,
  candidatePatternsFor,
} from '../notificationShape';
import { matchesRule, type NotificationRule } from '../notificationRules';

/**
 * A rule the user made from "BTC is trading at $104,455.73" could never fire
 * again, because the next alert says $98,220.10. The rule stores the whole
 * text of the alert, and the alert's own number is in it. So every rule made
 * from something that reports a changing figure was dead the moment it was
 * written — while sitting in the rules list looking like an instruction the
 * app was following.
 *
 * Comparing the alert's *shape* — the same text with its numbers masked — is
 * what makes "ignore alerts like this one" mean what the user meant by it.
 *
 * Two properties, and this file holds both:
 *
 *   1. The two copies agree. The web layer decides whether a row is created;
 *      the native listener decides whether the phone buzzes, with the app shut.
 *      If they disagree the user gets told about a capture that never appears.
 *   2. It only ever adds matches. Nothing a rule used to catch may stop being
 *      caught, and the masking may not widen far enough to swallow a real
 *      purchase at a merchant the user never mentioned.
 */

const LISTENER_JAVA = readFileSync(
  resolve(__dirname, '../../android-custom/NotificationListener.java'),
  'utf-8',
);

/**
 * The native normaliser, rebuilt here from the patterns the Java actually
 * compiles, so this compares the two implementations rather than two copies of
 * the same wish.
 */
function nativeShapeOf(text: string): string {
  const begin = LISTENER_JAVA.indexOf('// NOTIFICATION_SHAPE_BEGIN');
  const end = LISTENER_JAVA.indexOf('// NOTIFICATION_SHAPE_END');
  expect(begin, 'NOTIFICATION_SHAPE_BEGIN marker missing').toBeGreaterThan(-1);
  expect(end, 'NOTIFICATION_SHAPE_END marker missing').toBeGreaterThan(begin);
  const block = LISTENER_JAVA.slice(begin, end);

  const literal = (name: string): RegExp => {
    const found = new RegExp(`${name} = Pattern\\.compile\\("((?:[^"\\\\]|\\\\.)*)"\\)`).exec(block);
    expect(found, `${name} missing from the Java`).toBeTruthy();
    return new RegExp(found![1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'), 'g');
  };

  // The Java builds its two date patterns from a shared DATE_WORDS string, so
  // that is spliced in the same way here rather than re-typed.
  const dateWords = /DATE_WORDS =\s*((?:\s*\+?\s*"(?:[^"\\]|\\.)*")+)/.exec(block);
  expect(dateWords, 'DATE_WORDS missing from the Java').toBeTruthy();
  const words = [...dateWords![1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join('');
  const dateBefore = new RegExp(`\\b(?:${words})\\s+#`, 'g');
  const dateAfter = new RegExp(`#\\s+(?:${words})\\b`, 'g');

  if (!text) return '';
  return text
    .toLowerCase()
    .replace(literal('NUMBER_RUN'), '#')
    .replace(dateBefore, '# #')
    .replace(dateAfter, '# #')
    .replace(literal('WHITESPACE_RUN'), ' ')
    .trim();
}

/** Alerts of every kind this app has had to deal with. */
const CORPUS = [
  'BTC price alert BTC is trading at $104,455.73',
  'BTC price alert BTC is trading at $98,220.10',
  'ETH is down 5.06% — now $2,431.10',
  'Your balance is $1,204.55 as of Aug 21',
  'Your balance is $87.10 as of Sep 02',
  'LOBLAWS #1042 You spent $84.21 with your credit card.',
  'LOBLAWS #1042 You spent $12.05 with your credit card.',
  'COSTCO GAS #551 You spent $84.21 with your credit card.',
  'A transaction of $18.75 was approved at MCDONALDS',
  'Card ending 4021 used at SHELL for $71.43 at 6:24 PM',
  'Rewards update: you now have 12,450 points',
  'Rewards update: you now have 12,900 points',
  '',
  '   ',
  '$42.10',
];

function rule(over: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: 'r1',
    user_id: 'u1',
    pattern: '',
    pattern_type: 'exact',
    use_count: 0,
    last_used_at: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

describe('the two copies of the shape', () => {
  it.each(CORPUS)('agree on %s', (text) => {
    expect(nativeShapeOf(text)).toBe(notificationShape(text));
  });

  it('lowercase the ASCII way on both sides', () => {
    // Locale.US in the Java, because a Turkish device lowercases "I" to a
    // dotless ı and would put the two sides quietly out of step.
    expect(LISTENER_JAVA).toContain('toLowerCase(java.util.Locale.US)');
  });

  it('apply their passes in the same order', () => {
    // Number masking has to come first: the date words are only masked where
    // they sit against an already-masked number.
    const body = LISTENER_JAVA.slice(
      LISTENER_JAVA.indexOf('static String shapeOf('),
      LISTENER_JAVA.indexOf('// NOTIFICATION_SHAPE_END'),
    );
    const order = ['NUMBER_RUN.matcher', 'DATE_WORD_BEFORE_NUMBER.matcher', 'DATE_WORD_AFTER_NUMBER.matcher', 'WHITESPACE_RUN.matcher'];
    let at = -1;
    for (const step of order) {
      const found = body.indexOf(step);
      expect(found, `${step} missing or out of order`).toBeGreaterThan(at);
      at = found;
    }
  });

  it('leave a date alone when it is not a date', () => {
    // "may" next to a number is a month; "may" in a sentence is a word.
    expect(notificationShape('You may spend $10 on May 4')).toBe('you may spend $# on # #');
    expect(nativeShapeOf('You may spend $10 on May 4')).toBe('you may spend $# on # #');
  });

  it('leave something to compare', () => {
    // Guards the rebuilt normaliser above: if the extraction silently produced
    // regexes that match nothing, every agreement test would pass vacuously.
    expect(notificationShape('BTC is trading at $104,455.73')).toBe('btc is trading at $#');
    expect(nativeShapeOf('BTC is trading at $104,455.73')).toBe('btc is trading at $#');
  });
});

describe('what a rule catches now', () => {
  const priceAlert = rule({ pattern: 'BTC price alert BTC is trading at $104,455.73' });

  it('the same alert with tomorrow\'s price — the case that started this', () => {
    expect(matchesRule('BTC price alert BTC is trading at $98,220.10', priceAlert)).toBe(true);
  });

  it('still the identical text, exactly as before', () => {
    expect(matchesRule('BTC price alert BTC is trading at $104,455.73', priceAlert)).toBe(true);
  });

  it('a balance alert next month', () => {
    const balance = rule({ pattern: 'Your balance is $1,204.55 as of Aug 21' });
    expect(matchesRule('Your balance is $87.10 as of Sep 02', balance)).toBe(true);
  });

  it('a points update with a different total', () => {
    const points = rule({ pattern: 'Rewards update: you now have 12,450 points' });
    expect(matchesRule('Rewards update: you now have 12,900 points', points)).toBe(true);
  });
});

describe('what a rule must never catch', () => {
  it('a purchase at a different merchant', () => {
    // Only the numbers are masked, so every word of the merchant's name is
    // still in the comparison.
    const loblaws = rule({ pattern: 'LOBLAWS #1042 You spent $84.21 with your credit card.' });
    expect(matchesRule('COSTCO GAS #551 You spent $84.21 with your credit card.', loblaws)).toBe(false);
  });

  it('anything at all, on a rule that is nothing but a number', () => {
    // "$42.10" masks down to "$#", which would otherwise match every purchase
    // ever made.
    const bare = rule({ pattern: '$42.10' });
    expect(matchesRule('LOBLAWS #1042 You spent $84.21 with your credit card.', bare)).toBe(false);
    expect(shapeMatches('$42.10', 'anything $1.00', 'contains')).toBe(false);
  });

  it('a longer alert, when the rule was written as an exact match', () => {
    const exact = rule({ pattern: 'Your balance is $1,204.55' });
    expect(matchesRule('Update: Your balance is $87.10 and your card is due', exact)).toBe(false);
  });

  it('anything, on an empty rule', () => {
    expect(matchesRule('LOBLAWS You spent $84.21', rule({ pattern: '' }))).toBe(false);
    expect(matchesRule('LOBLAWS You spent $84.21', rule({ pattern: '   ', pattern_type: 'contains' }))).toBe(false);
  });
});

describe('deciding what is worth asking the model about', () => {
  const priceAlert = 'BTC price alert BTC is trading at $104,455.73';

  it('scores a rewording of the same alert highly', () => {
    expect(wordingOverlap(priceAlert, 'BTC price update: BTC now trading at $98,220.10'))
      .toBeGreaterThan(0.6);
  });

  it('scores an unrelated purchase at nearly nothing', () => {
    expect(wordingOverlap(priceAlert, 'LOBLAWS #1042 You spent $84.21 with your credit card.'))
      .toBeLessThan(0.2);
  });

  it('offers only the close ones, closest first', () => {
    const candidates = candidatePatternsFor(
      [priceAlert, 'Your balance is $1,204.55 as of Aug 21'],
      'BTC price update: BTC now trading at $98,220.10',
    );
    expect(candidates).toEqual([priceAlert]);
  });

  it('ignores the words every bank alert contains', () => {
    // Two thirds of these two alerts is the same boilerplate — "you spent with
    // your credit card" — and none of it says they are the same alert. Before
    // the boilerplate was discounted, a grocery run scored 0.67 against a gym
    // membership and went in front of the model as a candidate for silencing.
    expect(
      wordingOverlap(
        'ACME GYM MEMBERSHIP You spent $45.00 with your credit card.',
        'LOBLAWS #1042 You spent $84.21 with your credit card.',
      ),
    ).toBe(0);
    // The same charge in the bank's new wording still scores full marks.
    expect(
      wordingOverlap(
        'ACME GYM MEMBERSHIP You spent $45.00 with your credit card.',
        'ACME GYM MEMBERSHIP charged $45.00 to your credit card.',
      ),
    ).toBe(1);
  });

  it('refuses to compare against a rule with nothing distinctive in it', () => {
    // One word of its own is not something to match on: every alert containing
    // that word would become a candidate.
    expect(wordingOverlap('You spent $45.00 at ACME', 'You spent $12.00 at ACME')).toBe(0);
  });

  it('offers nothing for an ordinary purchase, so the model is never asked', () => {
    // The whole point of the gate: an inference on the path of every capture
    // would be a second or more of waiting for an answer that is obviously no.
    expect(
      candidatePatternsFor([priceAlert], 'A transaction of $18.75 was approved at MCDONALDS'),
    ).toEqual([]);
  });
});
