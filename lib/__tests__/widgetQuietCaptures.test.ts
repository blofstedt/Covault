import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseNotificationText } from '../deviceTransactionParser';
import { buildWidgetSnapshot, mergeWidgetDeltas } from '../widgetSnapshot';

/**
 * A crypto price alert broke the home-screen widget.
 *
 * The listener already knew what to make of it: "BTC is trading at
 * $112,013.15" matches the mirrored non-purchase list, so no notification was
 * posted and the web pipeline threw the alert away exactly as it should. What
 * still happened was the last thing in handleNotificationPosted — the
 * optimistic widget delta, which was gated on nothing but "a monitored app
 * sent a dollar amount". Six figures of spending landed on the donut, plus an
 * item claiming to be waiting in Review, and both stayed until the app was
 * next opened, because a delta is only ever discarded by the next snapshot.
 *
 * The fix is to hold the widget to the same verdict as the notification: the
 * three quiet cases each mean "no row is coming", and a delta is precisely a
 * bet that one is. This file pins that they cannot drift apart again.
 *
 * What cannot be tested here is the phone. Nothing in CI draws the widget.
 */

const LISTENER_JAVA = readFileSync(
  resolve(__dirname, '../../android-custom/NotificationListener.java'),
  'utf-8',
);

/** The body of handleNotificationPosted, where the decision is made. */
function handler(): string {
  const start = LISTENER_JAVA.indexOf('private void handleNotificationPosted(');
  expect(start, 'handleNotificationPosted not found').toBeGreaterThan(-1);
  return LISTENER_JAVA.slice(start);
}

describe('the quiet verdict', () => {
  it('is one flag, covering all three reasons for silence', () => {
    const match = /boolean captureQuietly\s*=\s*([^;]+);/.exec(handler());
    expect(match, 'captureQuietly is not defined in handleNotificationPosted').not.toBeNull();
    const definition = match![1];
    expect(definition).toContain('ignoredByUser');
    expect(definition).toContain('knownRecurring');
    expect(definition).toContain('notAPurchase');
  });

  it('is what decides whether a capture announces itself', () => {
    const body = handler();
    const call = body.slice(body.indexOf('CaptureResult result = broadcastTransaction('));
    const args = call.slice(0, call.indexOf(');'));
    expect(args, 'broadcastTransaction should be handed the same flag').toContain('captureQuietly');
  });
});

describe('what reaches the widget', () => {
  it('records no delta for a capture nothing was said about', () => {
    const body = handler();
    const flag = body.indexOf('boolean captureQuietly');
    const guard = body.indexOf('!captureQuietly)');
    const record = body.indexOf('WidgetDeltaStore.recordDelta(');

    expect(flag, 'captureQuietly should be decided first').toBeGreaterThan(-1);
    expect(guard, 'the widget block should be gated on it').toBeGreaterThan(flag);
    expect(record, 'recordDelta should sit inside that gate').toBeGreaterThan(guard);
  });

  it('still leaves capture itself untouched by the gate', () => {
    // The gate may only ever reach the widget. The durable queue write and the
    // broadcast happen above it, unconditionally — a widget that misses a
    // redraw is cosmetic; a capture pipeline that misses a purchase is not.
    const body = handler();
    const broadcast = body.indexOf('CaptureResult result = broadcastTransaction(');
    const guard = body.indexOf('!captureQuietly)');
    expect(broadcast).toBeGreaterThan(-1);
    expect(guard, 'the widget gate must come after the capture path').toBeGreaterThan(broadcast);
  });
});

describe('the damage a believed price alert does', () => {
  const ALERT = 'BTC is up 5.63% BTC is trading at $112,013.15 CAD. Up $5,968.31 in the past 24 hours.';

  it('is a row the app was never going to create', () => {
    expect(parseNotificationText(ALERT).isOutgoing).toBe(false);
  });

  it('would have been six figures of spending and a phantom review item', () => {
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
      [{
        amount: 112013.15,
        category: 'Other',
        atMs: Date.parse('2026-08-05T06:34:00Z'),
        pending: true,
      }],
      () => '2026-08',
    );

    expect(merged.totalSpent).toBeCloseTo(112055.25, 2);
    expect(merged.remaining).toBeLessThan(0);
    expect(merged.pendingReview).toBe(1);
  });
});
