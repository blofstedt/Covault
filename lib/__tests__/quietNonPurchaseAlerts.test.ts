import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNotificationText } from '../deviceTransactionParser';
import { parseCaptureOutcomes, isCaptureProblem, describeCaptureOutcome } from '../captureOutcome';

/**
 * A crypto price alert from a bank app announced itself as a captured
 * purchase, sat in the shade all afternoon, and was thrown away the moment the
 * app was next opened. Both halves are true at once: the app is right that it
 * is not a transaction, and the phone still buzzed about it.
 *
 * The gap is timing, not judgement. The "$X at Y — captured" notification is
 * posted by the native listener the instant the alert arrives — it has to be,
 * because with the app closed that service is the only part of Covault
 * running — and it posts on the strength of a dollar amount and nothing else.
 * Everything that decides whether an alert is an expense lives in the web
 * pipeline, which may not run for hours.
 *
 * So the one list the parser already rejects on sight is mirrored down to the
 * listener and consulted before it announces anything. Two properties matter,
 * and this file pins both:
 *
 *   1. The lists stay identical. A pattern added to the parser and forgotten
 *      here would mean the shade and the review list disagree again.
 *   2. Silence never costs a capture. A match makes the capture QUIET — still
 *      queued, still broadcast, still classified, still in the processed list.
 *      Only the announcement is withheld, and only for text the parser was
 *      always going to throw away.
 *
 * What cannot be tested here is the phone. Nothing in CI posts, withholds or
 * reads an Android notification.
 */

const LISTENER_JAVA = readFileSync(
  resolve(__dirname, '../../android-custom/NotificationListener.java'),
  'utf-8',
);
const PARSER_TS = readFileSync(
  resolve(__dirname, '../deviceTransactionParser.ts'),
  'utf-8',
);

function block(source: string, name: string): string {
  const begin = source.indexOf(`// ${name}_BEGIN`);
  const end = source.indexOf(`// ${name}_END`);
  expect(begin, `${name}_BEGIN marker missing`).toBeGreaterThan(-1);
  expect(end, `${name}_END marker missing`).toBeGreaterThan(begin);
  return source.slice(begin, end);
}

/**
 * The regex sources the native listener compiles.
 *
 * Java string literals double every backslash, so they are unescaped back to
 * the form a JavaScript RegExp is written in — which is also what makes the
 * comparison against the parser's list meaningful rather than textual.
 */
function nativePatternSources(): string[] {
  const body = block(LISTENER_JAVA, 'NON_PURCHASE_PATTERNS');
  const entry = /Pattern\.compile\("((?:[^"\\]|\\.)*)"/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = entry.exec(body)) !== null) {
    out.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  }
  return out;
}

/** The regex sources the web parser rejects on. */
function parserPatternSources(): string[] {
  const body = block(PARSER_TS, 'NON_FINANCIAL_PATTERNS');
  const entry = /^\s*\/(.+)\/i,\s*$/gm;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = entry.exec(body)) !== null) {
    out.push(match[1]);
  }
  return out;
}

/** The native list, compiled here so its behaviour can be exercised. */
function nativePatterns(): RegExp[] {
  return nativePatternSources().map((source) => new RegExp(source, 'i'));
}

/** What the listener would decide about a piece of notification text. */
function nativeWouldStayQuiet(text: string): boolean {
  return nativePatterns().some((p) => p.test(text));
}

/** The alert from the user's shade, verbatim in shape. */
const CRYPTO_ALERT = 'BTC price alert BTC is trading at $104,455.73';

const NOT_PURCHASES = [
  CRYPTO_ALERT,
  'ETH is down 5.06% — now $2,431.10',
  'Market cap update: $1,240,000,000,000',
  'Price alert: SOL crossed $180.00',
  "Flash sale — don't miss 20% off, spend $50 and save",
  'Use promo code SAVE20 for $20 off your next order',
  'Earn up to $300 in bonus interest this year',
  'Update available: version 4.2 adds $0 transfers',
];

/**
 * Real spending alerts, in the wordings this repo has already had to fix once
 * each. Every one of them must still announce itself — that is the half the
 * user cannot afford to lose.
 */
const REAL_PURCHASES = [
  'Wealthsimple $12.34 at Tim Hortons',
  'A transaction of $18.75 was approved at MCDONALDS',
  'OPA001-MARKET MALL 🍴 You spent $16.54 with your credit card.',
  'AMZN MKTP CA You spent $42.10',
  'BMO You made a purchase of $9.99 at NETFLIX.COM',
  'Interac e-Transfer sent: $75.00 to Robert',
  'Your card was charged $104.55 at SHELL 4021',
  'Purchase at LOBLAWS for $88.20 completed',
];

describe('the two non-purchase lists', () => {
  it('parses a non-empty list out of each side', () => {
    // Guards the test itself: a regex that silently matched nothing would make
    // every assertion below vacuously pass.
    expect(nativePatternSources().length).toBeGreaterThan(0);
    expect(parserPatternSources().length).toBeGreaterThan(0);
  });

  it('holds the same patterns on both sides', () => {
    expect(nativePatternSources().sort()).toEqual(parserPatternSources().sort());
  });

  it('compiles every native pattern as written', () => {
    for (const source of nativePatternSources()) {
      expect(() => new RegExp(source, 'i'), source).not.toThrow();
    }
  });
});

describe('what the listener stays quiet about', () => {
  it('recognises the alert that started this — a price alert with a dollar amount', () => {
    expect(nativeWouldStayQuiet(CRYPTO_ALERT)).toBe(true);
  });

  it.each(NOT_PURCHASES)('stays quiet about %s', (text) => {
    expect(nativeWouldStayQuiet(text)).toBe(true);
  });

  /**
   * The safety property, and the reason this can only ever cost an
   * announcement: everything the listener withholds is something the parser
   * was going to reject anyway, so no row was ever going to appear for it.
   */
  it.each(NOT_PURCHASES)('only stays quiet where the app also refuses the row: %s', (text) => {
    expect(parseNotificationText(text).isOutgoing).toBe(false);
  });
});

describe('what still announces itself', () => {
  it.each(REAL_PURCHASES)('still announces %s', (text) => {
    expect(nativeWouldStayQuiet(text)).toBe(false);
  });
});

describe('a quiet capture is still a capture', () => {
  it('withholds only the notification, never the queue write or the broadcast', () => {
    const body = LISTENER_JAVA.slice(
      LISTENER_JAVA.indexOf('private CaptureResult broadcastTransaction('),
    );
    const queued = body.indexOf('boolean queued = queueTransaction(transaction);');
    const guard = body.indexOf('if (!captureQuietly');
    const broadcast = body.indexOf('sendBroadcast(intent);');

    expect(queued, 'the durable queue write should still happen').toBeGreaterThan(-1);
    expect(guard, 'only the notification should be behind the quiet flag').toBeGreaterThan(queued);
    expect(broadcast, 'the pipeline should still be handed the capture').toBeGreaterThan(guard);
  });

  it('routes a price alert into the same quiet path as a user-ignored one', () => {
    expect(LISTENER_JAVA).toContain('looksNonFinancial(fullText)');
    expect(LISTENER_JAVA).toContain('ignoredByUser || knownRecurring || notAPurchase');
  });

  it('leaves the bank its own alert, having posted nothing in its place', () => {
    // Tray suppression may only remove an alert Covault has replaced. Nothing
    // was posted here, so nothing may be dismissed.
    const body = LISTENER_JAVA.slice(
      LISTENER_JAVA.indexOf('private void maybeHideBankNotification('),
    );
    const decision = body.indexOf('if (notAPurchase)');
    const dismissal = body.indexOf('cancelNotification(key);');
    expect(decision).toBeGreaterThan(-1);
    expect(dismissal).toBeGreaterThan(decision);
    expect(body.slice(decision, dismissal)).toContain('OUTCOME_NOT_A_PURCHASE');
  });
});

describe('what the settings screen shows for it', () => {
  it('reads the outcome the listener writes down', () => {
    const rows = parseCaptureOutcomes(
      JSON.stringify([
        { at: 1, app: 'com.bmo.mobile', amount: 104455.73, outcome: 'not_a_purchase' },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('not_a_purchase');
  });

  it('uses the name the native side writes', () => {
    const constant = /OUTCOME_NOT_A_PURCHASE = "([a-z_]+)"/.exec(LISTENER_JAVA);
    expect(constant?.[1]).toBe('not_a_purchase');
  });

  it('does not report it as a fault — the alert was kept on purpose', () => {
    expect(isCaptureProblem('not_a_purchase')).toBe(false);
    expect(describeCaptureOutcome('not_a_purchase')).toMatch(/not a purchase/i);
  });
});
