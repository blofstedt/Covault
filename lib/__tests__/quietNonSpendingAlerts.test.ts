import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNotificationText } from '../deviceTransactionParser';
import { parseCaptureOutcomes, isCaptureProblem, describeCaptureOutcome } from '../captureOutcome';

/**
 * A declined charge and a balance alert both arrived as captured spending.
 *
 * The user's shade held "$37.67 at NEWSHOSTING.COM was declined — Captured,
 * tap to review", one day after the same $37.67 had gone through for real.
 * Nothing was spent on the declined attempt, so what they were being shown was
 * the same purchase twice with one of the two imaginary — and the widget had
 * already added the phantom to the month.
 *
 * Two rules were missing, and they fail in opposite halves of the app:
 *
 *  1. Nothing anywhere knew that "declined" means no money moved. The parser
 *     read the word "purchase" in the same sentence and recorded a row, so the
 *     app was wrong about this one too, not just the phone.
 *  2. The listener had no opinion on an alert that mentions money without any
 *     money having moved — a balance, a statement, a payment due. The parser
 *     has always rejected those (a stop phrase with no spending word), but the
 *     parser runs in the WebView, and with the app closed the listener had
 *     already announced a capture and told the widget that much more of the
 *     month had been spent.
 *
 * The second fix can only ever cost an announcement, and that is the property
 * this file exists to hold: the listener's rule is copied from the parser's,
 * so anything it silences is something the pipeline was going to reject
 * anyway. The first genuinely changes what the app records — a declined charge
 * now becomes no row at all — which is why the purchase wordings below are
 * checked from both sides.
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
  return [...body.matchAll(/'((?:[^'\\]|\\.)+)'|"((?:[^"\\]|\\.)+)"/g)].map((m) => m[1] ?? m[2]);
}

const MIRRORED = [
  'FAILED_CHARGE_PHRASES',
  'BILL_NOTICE_PHRASES',
  'STOP_PHRASES',
  'GO_PHRASES',
  'WEAK_GO_PHRASES',
  'REFUND_PHRASES',
] as const;

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
const hasAny = (text: string, list: string[]) => list.some((p) => normalize(text).includes(p));

/** What the listener would decide about a piece of notification text. */
const nativeSaysFailedCharge = (text: string) =>
  hasAny(text, phrasesIn(LISTENER_JAVA, 'FAILED_CHARGE_PHRASES'));

const nativeSaysInformationalOnly = (text: string) => {
  if (hasAny(text, phrasesIn(LISTENER_JAVA, 'BILL_NOTICE_PHRASES'))) return true;
  if (hasAny(text, phrasesIn(LISTENER_JAVA, 'REFUND_PHRASES'))) return false;
  if (!hasAny(text, phrasesIn(LISTENER_JAVA, 'STOP_PHRASES'))) return false;
  return (
    !hasAny(text, phrasesIn(LISTENER_JAVA, 'GO_PHRASES'))
    && !hasAny(text, phrasesIn(LISTENER_JAVA, 'WEAK_GO_PHRASES'))
  );
};

const nativeWouldStayQuiet = (text: string) =>
  nativeSaysFailedCharge(text) || nativeSaysInformationalOnly(text);

/** The alert that started this. */
const DECLINED = 'Your purchase of $37.67 at NEWSHOSTING.COM was declined.';

const NOT_SPENDING = [
  DECLINED,
  'BMO: A transaction of $210.00 at CANADIAN TIRE was declined due to insufficient funds',
  'Your payment of $89.99 to ROGERS failed',
  'Scotiabank: your $54.00 transfer to Jane was unsuccessful',
  'CIBC: your recurring payment of $19.99 to SPOTIFY has been cancelled',
  'Your available balance is $2,481.55',
  'Your account balance is $1,204.19 as of today',
  'Your February statement is ready. Minimum payment due $35.00 by Mar 3',
  'Available credit: $4,120.00',
  // The card-payment confirmation. It reached the shade as "$1095.00 at ve
  // received your payment of — Captured, tap to review": the word "payment"
  // carried it past every rule, and the vendor was a fragment of the sentence
  // it was read out of. Paying a card is not spending — the purchases that
  // built the balance were each captured already, so recording the payment on
  // top of them counts the month twice.
  "We've received your payment of $1095.00",
  'We have received your payment of $1,095.00. Thank you.',
  'Payment received: $1,095.00',
  'Thank you for your payment of $75.00',
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
  // The one that matters most here: a purchase alert that also quotes the
  // balance. It holds a stop phrase AND a spending word, so it stays loud.
  'You spent $22.40 at LOBLAWS. Available balance: $1,204.19',
  // The other side of the payment rule. These are the RECIPIENT being paid by
  // the user, which is real spending and must survive: only the bank telling
  // the user IT has been paid is refused.
  'Your bill payment of $142.30 to TELUS was completed',
  'Your recurring payment of $19.99 to SPOTIFY was processed',
];

describe('the mirrored lists', () => {
  it.each(MIRRORED)('parses a non-empty %s out of each side', (name) => {
    // Guards the test itself: a regex that matched nothing would make every
    // assertion below vacuously pass.
    expect(phrasesIn(PARSER_TS, name).length).toBeGreaterThan(0);
    expect(phrasesIn(LISTENER_JAVA, name).length).toBeGreaterThan(0);
  });

  it.each(MIRRORED)('holds the same %s on both sides', (name) => {
    expect(phrasesIn(LISTENER_JAVA, name).sort()).toEqual(phrasesIn(PARSER_TS, name).sort());
  });

  it('matches them the way the parser does — lower-cased, whitespace collapsed', () => {
    expect(LISTENER_JAVA).toMatch(/static String normalizeForPhrases\(String lower\)/);
    for (const fn of ['looksLikeFailedCharge', 'looksInformationalOnly', 'looksLikeIncome']) {
      const from = LISTENER_JAVA.indexOf(`static boolean ${fn}(`);
      expect(from, `${fn} is missing`).toBeGreaterThan(-1);
      const body = LISTENER_JAVA.slice(from, LISTENER_JAVA.indexOf('\n    }', from));
      expect(body, `${fn} must normalise like the parser`).toContain('normalizeForPhrases');
      expect(body).toContain('toLowerCase');
    }
  });
});

describe('what the listener stays quiet about', () => {
  it('recognises the alert that started this — a declined purchase', () => {
    expect(nativeSaysFailedCharge(DECLINED)).toBe(true);
  });

  it.each(NOT_SPENDING)('stays quiet about %s', (text) => {
    expect(nativeWouldStayQuiet(text)).toBe(true);
  });

  /**
   * The safety property. Everything withheld is something the parser refuses a
   * row for, so the phone and the app now agree the moment the alert lands
   * instead of hours later.
   */
  it.each(NOT_SPENDING)('only stays quiet where the app also refuses the row: %s', (text) => {
    expect(parseNotificationText(text).isOutgoing).toBe(false);
  });

  it('says which of the two it was, so the row is not just "not a purchase"', () => {
    expect(parseNotificationText(DECLINED).isFailedCharge).toBe(true);
    expect(parseNotificationText('Your available balance is $2,481.55').isFailedCharge)
      .toBeUndefined();
  });
});

describe('what still announces itself', () => {
  it.each(REAL_PURCHASES)('still announces %s', (text) => {
    expect(nativeWouldStayQuiet(text)).toBe(false);
  });

  it.each(REAL_PURCHASES)('and is still recorded: %s', (text) => {
    expect(parseNotificationText(text).isOutgoing).toBe(true);
  });

  it('leaves a refund alone, which is money the app does record', () => {
    // A refund names an amount and reads like the opposite of spending, but it
    // is a real row (a negative one) and the parser accepts it. The refund
    // guard on the informational rule is what keeps it out of this net.
    const refund = 'A refund of $30.00 from BEST BUY was credited to your account balance';
    expect(nativeSaysInformationalOnly(refund)).toBe(false);
    expect(parseNotificationText(refund).isOutgoing).toBe(true);
  });

  it('still captures a bill the user PAID, only refusing the one they were paid for', () => {
    // The whole risk of the payment rule in one test. "We received your
    // payment" is a bank confirming it was paid — a transfer between the
    // user's own accounts, on top of purchases already captured one by one.
    // "You paid X" is the user paying someone, which is an expense and has to
    // keep working.
    const cardPayment = "We've received your payment of $1095.00";
    const billPaid = 'Your bill payment of $142.30 to TELUS was completed';

    expect(parseNotificationText(cardPayment).isOutgoing).toBe(false);
    expect(nativeWouldStayQuiet(cardPayment)).toBe(true);

    expect(parseNotificationText(billPaid).isOutgoing).toBe(true);
    expect(nativeWouldStayQuiet(billPaid)).toBe(false);
  });

  it('leaves money coming in reported as income, not as a bill notice', () => {
    // The bill-notice list is consulted BEFORE the income one, so a phrase
    // broad enough to catch "...has been received" would relabel every deposit
    // and swallow refunds with it. Both are refused either way, but the app
    // would stop being able to say WHY — which is what the settings screen
    // shows the user. The list is kept narrow for that reason.
    const deposit = 'INTERAC e-Transfer: You received $200.00 from Jane';
    const refund = 'A refund of $30.00 from BEST BUY was credited to your account';

    expect(parseNotificationText(deposit).isIncome).toBe(true);
    expect(parseNotificationText(refund).isOutgoing).toBe(true);
  });

  it('does not read a payment confirmation into a merchant that merely contains one', () => {
    // The list is matched as plain substrings, like every other list here, so
    // a merchant name must not be able to trip it.
    const purchase = 'You spent $18.00 at PAYMENT SOLUTIONS INC';
    expect(parseNotificationText(purchase).isOutgoing).toBe(true);
    expect(nativeWouldStayQuiet(purchase)).toBe(false);
  });

  it('does not read a declined charge into a merchant that merely sounds like one', () => {
    // The failed-charge list is matched as plain substrings, so a merchant name
    // must not be able to trip it.
    expect(nativeSaysFailedCharge('You spent $14.00 at DECLAN BAKERY')).toBe(false);
    expect(parseNotificationText('You spent $14.00 at DECLAN BAKERY').isOutgoing).toBe(true);
  });
});

describe('a quiet capture is still a capture', () => {
  const handler = () =>
    LISTENER_JAVA.slice(LISTENER_JAVA.indexOf('private void handleNotificationPosted('));

  it('routes both verdicts into the same quiet path as a price alert', () => {
    const match = /boolean captureQuietly\s*=\s*([^;]+);/.exec(handler());
    expect(match, 'captureQuietly is not defined in handleNotificationPosted').not.toBeNull();
    expect(match![1]).toContain('chargeDidNotHappen');
    expect(match![1]).toContain('nothingSpent');
  });

  it('decides them before the capture path runs, and never inside it', () => {
    const body = handler();
    const broadcast = body.indexOf('CaptureResult result = broadcastTransaction(');
    for (const verdict of ['boolean chargeDidNotHappen', 'boolean nothingSpent']) {
      const decided = body.indexOf(verdict);
      expect(decided, `${verdict} is missing`).toBeGreaterThan(-1);
      expect(broadcast, 'the verdict must be reached before the capture').toBeGreaterThan(decided);
    }
  });

  it('keeps both out of the widget', () => {
    // The whole point. A delta is a bet that the ledger is about to gain this
    // amount as spending, and neither of these ever will.
    const body = handler();
    const guard = body.indexOf('!captureQuietly)');
    const record = body.indexOf('WidgetDeltaStore.recordDelta(');
    expect(guard).toBeGreaterThan(-1);
    expect(record, 'recordDelta should sit inside the quiet gate').toBeGreaterThan(guard);
  });

  it('leaves the bank its own alert, having posted nothing in its place', () => {
    // Tray suppression may only remove an alert Covault has replaced. Nothing
    // was posted here, and a failed payment is something the user may have to
    // act on — so the bank's own alert is the only notice they get.
    const body = LISTENER_JAVA.slice(
      LISTENER_JAVA.indexOf('private void maybeHideBankNotification('),
    );
    const dismissal = body.indexOf('cancelNotification(key);');
    for (const [guard, outcome] of [
      ['if (chargeDidNotHappen)', 'OUTCOME_FAILED_CHARGE'],
      ['if (nothingSpent)', 'OUTCOME_NOT_SPENDING'],
    ]) {
      const decision = body.indexOf(guard);
      expect(decision, `${guard} is missing`).toBeGreaterThan(-1);
      expect(dismissal).toBeGreaterThan(decision);
      expect(body.slice(decision, dismissal)).toContain(outcome);
    }
  });
});

describe('what the settings screen shows for them', () => {
  it('reads the outcomes the listener writes down', () => {
    const rows = parseCaptureOutcomes(
      JSON.stringify([
        { at: 1, app: 'com.bmo.mobile', amount: 37.67, outcome: 'failed_charge' },
        { at: 2, app: 'com.bmo.mobile', amount: 2481.55, outcome: 'not_spending' },
      ]),
    );
    expect(rows.map((r) => r.outcome)).toEqual(['not_spending', 'failed_charge']);
  });

  it('uses the names the native side writes', () => {
    expect(/OUTCOME_FAILED_CHARGE = "([a-z_]+)"/.exec(LISTENER_JAVA)?.[1]).toBe('failed_charge');
    expect(/OUTCOME_NOT_SPENDING = "([a-z_]+)"/.exec(LISTENER_JAVA)?.[1]).toBe('not_spending');
  });

  it('does not report them as faults — the alerts were kept on purpose', () => {
    expect(isCaptureProblem('failed_charge')).toBe(false);
    expect(isCaptureProblem('not_spending')).toBe(false);
    expect(describeCaptureOutcome('failed_charge')).toMatch(/didn't go through/i);
    expect(describeCaptureOutcome('not_spending')).toMatch(/balance, statement or payment notice/i);
  });
});
