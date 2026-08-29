import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNotificationText } from '../deviceTransactionParser';
import { buildWidgetSnapshot, mergeWidgetDeltas } from '../widgetSnapshot';
import { parseCaptureOutcomes, isCaptureProblem, describeCaptureOutcome } from '../captureOutcome';

/**
 * A payday deposit showed up on the home-screen widget as spending.
 *
 * The app itself was never wrong about it: Covault records expenses only, and
 * lib/deviceTransactionParser.ts has always rejected a deposit, an e-Transfer
 * received or a payroll credit on sight, so no row was ever created. But the
 * parser runs in the WebView, and with the app closed the only part of Covault
 * running is the native listener — which posted "$2,480.00 captured" and told
 * the widget that much more of the month had been spent, on the strength of a
 * dollar amount and nothing else.
 *
 * The widget is the half that lasts. A delta is only ever discarded by the next
 * snapshot, so the deposit sat on the donut as spending, with the remaining
 * balance that much lower, until the app was next opened — which is exactly the
 * window the widget exists to cover.
 *
 * The fix mirrors the parser's own income phrases down to the listener and
 * folds them into the same quiet verdict the price alerts use: captured,
 * queued, broadcast and classified as always, but announced to nobody and
 * never handed to the widget. This file pins that they cannot drift apart.
 *
 * What cannot be tested here is the phone. Nothing in CI posts a notification
 * or draws the widget.
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

/** Every quoted string inside a marked block, which is the list itself. */
function phrasesIn(source: string, name: string): string[] {
  const body = block(source, name);
  return [...body.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
}

const nativePhrases = () => phrasesIn(LISTENER_JAVA, 'INCOME_PHRASES');
const parserPhrases = () => phrasesIn(PARSER_TS, 'INCOME_PHRASES');

/** What the listener would decide about a piece of notification text. */
function nativeWouldStayQuiet(text: string): boolean {
  const lower = text.toLowerCase();
  return nativePhrases().some((phrase) => lower.includes(phrase));
}

/** The alert that started this, in the shape a payroll deposit arrives in. */
const PAYDAY = 'Direct deposit of $2,480.00 from ACME CORP PAYROLL to your chequing account';

const NOT_EXPENSES = [
  PAYDAY,
  'You received $1,200.00 by Interac e-Transfer from Jane',
  'Money received: $340.00 has been deposited',
  'Your salary of $3,100.00 has been paid',
  'Robert sent you $75.00',
  'Transfer received — $500.00',
];

/**
 * Real spending, in wordings this repo has already had to fix once each. Every
 * one still has to announce itself and still has to reach the widget — that is
 * the half the user cannot afford to lose.
 */
const REAL_PURCHASES = [
  'Wealthsimple $12.34 at Tim Hortons',
  'A transaction of $18.75 was approved at MCDONALDS',
  'Interac e-Transfer sent: $75.00 to Robert',
  'AMZN MKTP CA You spent $42.10',
  'Your card was charged $104.55 at SHELL 4021',
  'BMO You made a purchase of $9.99 at NETFLIX.COM',
];

describe('the two income lists', () => {
  it('parses a non-empty list out of each side', () => {
    // Guards the test itself: a regex that matched nothing would make every
    // assertion below vacuously pass.
    expect(nativePhrases().length).toBeGreaterThan(0);
    expect(parserPhrases().length).toBeGreaterThan(0);
  });

  it('holds the same phrases on both sides', () => {
    expect(nativePhrases().sort()).toEqual(parserPhrases().sort());
  });

  it('matches them the way the parser does — lower-cased, anywhere in the text', () => {
    expect(LISTENER_JAVA).toMatch(/static boolean looksLikeIncome\(String text\)/);
    const fn = LISTENER_JAVA.slice(LISTENER_JAVA.indexOf('static boolean looksLikeIncome('));
    const body = fn.slice(0, fn.indexOf('\n    }'));
    expect(body).toContain('toLowerCase');
    expect(body).toContain('contains(phrase)');
  });
});

describe('what the listener stays quiet about', () => {
  it('recognises the alert that started this — a payday deposit', () => {
    expect(nativeWouldStayQuiet(PAYDAY)).toBe(true);
  });

  it.each(NOT_EXPENSES)('stays quiet about %s', (text) => {
    expect(nativeWouldStayQuiet(text)).toBe(true);
  });

  /**
   * The safety property, and the reason this can only ever cost an
   * announcement: everything withheld here is something the parser was going to
   * reject anyway, so no row was ever going to appear for it.
   */
  it.each(NOT_EXPENSES)('only stays quiet where the app also refuses the row: %s', (text) => {
    expect(parseNotificationText(text).isOutgoing).toBe(false);
  });
});

describe('what still announces itself', () => {
  it.each(REAL_PURCHASES)('still announces %s', (text) => {
    expect(nativeWouldStayQuiet(text)).toBe(false);
  });

  it('does not silence an e-Transfer the user SENT, which is money going out', () => {
    // The one wording where a word away from "received" flips the direction.
    expect(nativeWouldStayQuiet('Interac e-Transfer sent: $75.00 to Robert')).toBe(false);
    expect(parseNotificationText('Interac e-Transfer sent: $75.00 to Robert').isOutgoing).toBe(true);
  });
});

describe('a quiet capture is still a capture', () => {
  const handler = () =>
    LISTENER_JAVA.slice(LISTENER_JAVA.indexOf('private void handleNotificationPosted('));

  it('routes a deposit into the same quiet path as a price alert', () => {
    const match = /boolean captureQuietly\s*=\s*([^;]+);/.exec(handler());
    expect(match, 'captureQuietly is not defined in handleNotificationPosted').not.toBeNull();
    expect(match![1]).toContain('moneyComingIn');
  });

  it('decides it before the capture path runs, and never inside it', () => {
    const body = handler();
    const decided = body.indexOf('boolean moneyComingIn');
    const broadcast = body.indexOf('CaptureResult result = broadcastTransaction(');
    expect(decided).toBeGreaterThan(-1);
    expect(broadcast, 'the verdict must be reached before the capture').toBeGreaterThan(decided);
  });

  it('keeps the deposit out of the widget', () => {
    // The whole point. The delta is a bet that the ledger is about to gain this
    // amount as spending, and a deposit is the opposite of that.
    const body = handler();
    const guard = body.indexOf('!captureQuietly)');
    const record = body.indexOf('WidgetDeltaStore.recordDelta(');
    expect(guard).toBeGreaterThan(-1);
    expect(record, 'recordDelta should sit inside the quiet gate').toBeGreaterThan(guard);
  });

  it('leaves the bank its own alert, having posted nothing in its place', () => {
    // Tray suppression may only remove an alert Covault has replaced. Nothing
    // was posted here, so the bank's deposit alert is the only notice the user
    // has that they were paid.
    const body = LISTENER_JAVA.slice(
      LISTENER_JAVA.indexOf('private void maybeHideBankNotification('),
    );
    const decision = body.indexOf('if (moneyComingIn)');
    const dismissal = body.indexOf('cancelNotification(key);');
    expect(decision).toBeGreaterThan(-1);
    expect(dismissal).toBeGreaterThan(decision);
    expect(body.slice(decision, dismissal)).toContain('OUTCOME_INCOME');
  });
});

describe('the damage a believed deposit does', () => {
  it('would have been a month of spending that never happened', () => {
    // Not a regression test for the fix — a record of what the fix prevents,
    // so the cost of loosening the gate is written down in numbers.
    const snapshot = buildWidgetSnapshot({
      budgets: [{ id: 'b1', name: 'Groceries' }] as never,
      currentMonthTransactions: [
        { id: 't1', amount: 42.1, budget_id: 'b1', vendor: 'Loblaws', date: '2026-08-04' },
      ] as never,
      remaining: 1957.9,
      income: 2000,
      theme: null,
      pendingReview: 0,
      monthKey: '2026-08',
      nowMs: Date.parse('2026-08-04T12:00:00Z'),
    });

    const merged = mergeWidgetDeltas(
      snapshot,
      [{ amount: 2480, category: 'Other', atMs: Date.parse('2026-08-05T09:02:00Z'), pending: true }],
      () => '2026-08',
    );

    expect(merged.totalSpent).toBeCloseTo(2522.1, 2);
    // The figure the user reads first, and the one they said was wrong.
    expect(merged.remaining).toBeLessThan(0);
    expect(merged.pendingReview).toBe(1);
  });
});

describe('what the settings screen shows for it', () => {
  it('reads the outcome the listener writes down', () => {
    const rows = parseCaptureOutcomes(
      JSON.stringify([{ at: 1, app: 'com.bmo.mobile', amount: 2480, outcome: 'income' }]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('income');
  });

  it('uses the name the native side writes', () => {
    const constant = /OUTCOME_INCOME = "([a-z_]+)"/.exec(LISTENER_JAVA);
    expect(constant?.[1]).toBe('income');
  });

  it('does not report it as a fault — the alert was kept on purpose', () => {
    expect(isCaptureProblem('income')).toBe(false);
    expect(describeCaptureOutcome('income')).toMatch(/money coming in/i);
  });
});
