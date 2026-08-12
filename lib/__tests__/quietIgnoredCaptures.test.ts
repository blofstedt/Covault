import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * An alert the user has told Covault to ignore should not announce itself as a
 * captured purchase.
 *
 * Two things made it do so anyway, and both are needed to stop it:
 *
 *   1. The notification is posted by the native listener the instant a bank
 *      alert arrives — it has to be, because that service is the only part of
 *      Covault running when the app is closed, and tray suppression may only
 *      dismiss a bank's alert once ours stands in its place. It posts on the
 *      strength of a dollar amount and nothing else. So the user's "not a
 *      transaction" rules are mirrored down to it, and a match means nothing
 *      is posted at all.
 *
 *   2. For everything the rules don't cover — a promo the user has never
 *      marked, a balance alert, a refund with nothing to match — the web
 *      pipeline is the first thing that can tell. When it says "not an
 *      expense", the notification that was posted on spec is withdrawn.
 *
 * The half that cannot be tested here is the phone. Nothing in CI posts,
 * cancels or reads an Android notification.
 */

const { mockSetSkipRules, mockCancelCaptureNotification } = vi.hoisted(() => ({
  mockSetSkipRules: vi.fn(),
  mockCancelCaptureNotification: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({
    setSkipRules: mockSetSkipRules,
    cancelCaptureNotification: mockCancelCaptureNotification,
    addListener: vi.fn(),
  }),
}));

import { pushSkipRules, cancelCaptureNotification } from '../covaultNotification';
import { matchesRule, type NotificationRule } from '../notificationRules';
import { parseCaptureOutcomes, isCaptureProblem, describeCaptureOutcome } from '../captureOutcome';

const LISTENER_JAVA = readFileSync(
  resolve(__dirname, '../../android-custom/NotificationListener.java'),
  'utf-8',
);
const PLUGIN_JAVA = readFileSync(
  resolve(__dirname, '../../android-custom/CovaultNotificationPlugin.java'),
  'utf-8',
);
const LISTENER_HOOK = readFileSync(
  resolve(__dirname, '../hooks/useNotificationListener.ts'),
  'utf-8',
);

beforeEach(() => {
  mockSetSkipRules.mockReset();
  mockSetSkipRules.mockResolvedValue(undefined);
  mockCancelCaptureNotification.mockReset();
  mockCancelCaptureNotification.mockResolvedValue(undefined);
});

describe('mirroring the skip rules to the listener', () => {
  it('sends them in the shape the native matcher reads', async () => {
    await pushSkipRules([
      { pattern: 'Your statement is ready', pattern_type: 'exact' },
      { pattern: 'reward points', pattern_type: 'contains' },
    ]);

    const sent = JSON.parse(mockSetSkipRules.mock.calls[0][0].rules);
    expect(sent).toEqual([
      { pattern: 'Your statement is ready', pattern_type: 'exact' },
      { pattern: 'reward points', pattern_type: 'contains' },
    ]);
  });

  it('drops empty patterns, which would match everything under `contains`', async () => {
    await pushSkipRules([
      { pattern: '   ', pattern_type: 'contains' },
      { pattern: 'reward points', pattern_type: 'contains' },
    ]);

    const sent = JSON.parse(mockSetSkipRules.mock.calls[0][0].rules);
    expect(sent).toHaveLength(1);
    expect(sent[0].pattern).toBe('reward points');
  });

  it('normalises an unknown match type to the strict one', async () => {
    await pushSkipRules([{ pattern: 'anything', pattern_type: 'regex-ish' }]);

    const sent = JSON.parse(mockSetSkipRules.mock.calls[0][0].rules);
    expect(sent[0].pattern_type).toBe('exact');
  });

  it('is silent rather than throwing on an APK that predates the method', async () => {
    mockSetSkipRules.mockRejectedValue(new Error('not implemented'));
    await expect(pushSkipRules([{ pattern: 'x', pattern_type: 'exact' }])).resolves.toBeUndefined();
  });
});

/**
 * The two matchers decide different things about the same alert — the native
 * one whether a notification is posted, the web one whether a row is created.
 * If they disagree the user gets exactly the symptom this work is fixing: a
 * capture notification for something that never appears in Review.
 */
describe('the native and web rule matchers', () => {
  const rule = (over: Partial<NotificationRule>): NotificationRule => ({
    id: 'r1',
    user_id: 'u1',
    pattern: '',
    pattern_type: 'exact',
    use_count: 0,
    last_used_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  });

  it('agree that `exact` compares the trimmed text', () => {
    const r = rule({ pattern: 'Your statement is ready', pattern_type: 'exact' });
    expect(matchesRule('  Your statement is ready  ', r)).toBe(true);
    expect(matchesRule('Your Statement Is Ready', r)).toBe(false);

    expect(LISTENER_JAVA).toMatch(/String trimmed = text\.trim\(\);/);
    expect(LISTENER_JAVA).toMatch(/trimmed\.equals\(pattern\)/);
  });

  it('agree that `contains` ignores case', () => {
    const r = rule({ pattern: 'Reward Points', pattern_type: 'contains' });
    expect(matchesRule('You earned reward points this month', r)).toBe(true);

    expect(LISTENER_JAVA).toMatch(/lower\.contains\(pattern\.toLowerCase\(\)\)/);
  });

  it('agree that an empty pattern matches nothing', () => {
    expect(matchesRule('anything at all', rule({ pattern: '', pattern_type: 'contains' }))).toBe(false);
    expect(LISTENER_JAVA).toMatch(/if \(pattern\.isEmpty\(\)\) continue;/);
  });
});

describe('the native listener', () => {
  it('stays silent for an alert the user ignores', () => {
    expect(LISTENER_JAVA).toMatch(/boolean ignoredByUser = matchesSkipRule\(this, fullText\);/);
    expect(LISTENER_JAVA).toMatch(
      /if \(!ignoredByUser && \(!fromScan \|\| !alreadySecured\)\) \{\s*\n\s*notified = notifyCaptured/,
    );
  });

  it('still captures it, so a bad rule can only cost a notification', () => {
    // The queue write and the broadcast are unconditional — only the post is
    // gated. Reversing that would let one over-broad `contains` rule swallow
    // real purchases silently.
    const broadcast = LISTENER_JAVA.slice(
      LISTENER_JAVA.indexOf('private CaptureResult broadcastTransaction'),
    );
    const queueLine = broadcast.indexOf('boolean queued = queueTransaction(transaction);');
    const notifyLine = broadcast.indexOf('notified = notifyCaptured(');
    const sendLine = broadcast.indexOf('sendBroadcast(intent);');
    expect(queueLine).toBeGreaterThan(-1);
    expect(sendLine).toBeGreaterThan(-1);
    // persist → notify → broadcast; the ignore check sits inside the notify
    // step alone.
    expect(queueLine).toBeLessThan(notifyLine);
    expect(notifyLine).toBeLessThan(sendLine);
  });

  it('will not dismiss a bank alert it never replaced', () => {
    // Nothing was posted in its place, so removing the bank's own alert would
    // leave the user with no record of it at all.
    expect(LISTENER_JAVA).toMatch(
      /if \(ignoredByUser\) \{\s*\n\s*recordOutcome\(securedKey, app, amount, OUTCOME_USER_IGNORED\);\s*\n\s*return;/,
    );
  });

  it('hands over the id of the notification it posted', () => {
    // Written from the inputs rather than read back from the post, so the
    // durable queue carries it too — a capture drained hours later still has
    // to be able to clear the shade.
    expect(LISTENER_JAVA).toMatch(
      /transaction\.put\("capture_notification_id",\s*\n?\s*captureNotificationId\(amount, vendor, rawText\)\);/,
    );
    expect(LISTENER_JAVA).toMatch(/nm\.notify\(dedupKey\.hashCode\(\), b\.build\(\)\);/);
    expect(LISTENER_JAVA).toMatch(
      /static int captureNotificationId\([^)]*\) \{\s*\n\s*return captureDedupKey\(amount, vendor, rawText\)\.hashCode\(\);/,
    );
  });

  it('forgets the dedup entry when a notification is cancelled', () => {
    // Otherwise the next real purchase at the same merchant for the same
    // amount inside the dedup window posts nothing, having "already" notified.
    const cancel = LISTENER_JAVA.slice(
      LISTENER_JAVA.indexOf('static void cancelCaptureNotification'),
    );
    expect(cancel).toMatch(/nm\.cancel\(id\)/);
    expect(cancel).toMatch(/recentCaptureNotifications/);
  });

  it('is reachable from the web layer through the plugin', () => {
    expect(PLUGIN_JAVA).toMatch(/public void cancelCaptureNotification\(PluginCall call\)/);
    expect(PLUGIN_JAVA).toMatch(/public void setSkipRules\(PluginCall call\)/);
    // Both delivery paths carry the id: the live broadcast and the queue the
    // plugin drains after the app was closed.
    expect(
      PLUGIN_JAVA.match(/event\.put\("capture_notification_id"/g) || [],
    ).toHaveLength(2);
  });
});

describe('withdrawing a capture notification', () => {
  it('cancels by the id the event carried', async () => {
    await cancelCaptureNotification(12345);
    expect(mockCancelCaptureNotification).toHaveBeenCalledWith({ id: 12345 });
  });

  it('does nothing when the event carried no id (an older APK)', async () => {
    await cancelCaptureNotification(undefined);
    expect(mockCancelCaptureNotification).not.toHaveBeenCalled();
  });

  it('is silent when the native method is missing', async () => {
    mockCancelCaptureNotification.mockRejectedValue(new Error('not implemented'));
    await expect(cancelCaptureNotification(1)).resolves.toBeUndefined();
  });

  it('is only triggered by "not an expense", never by a duplicate', () => {
    // A duplicate is a re-broadcast of a purchase that WAS captured, and the
    // notification still standing is that purchase's. Cancelling on a
    // duplicate would erase the notice for a real capture.
    expect(LISTENER_HOOK).toMatch(
      /if \(result\.skipReason === 'not_transaction'\) \{\s*\n\s*void cancelCaptureNotification\(event\.capture_notification_id\);/,
    );
  });
});

describe('the capture diagnostics', () => {
  it('read back the new outcome instead of discarding it', () => {
    const parsed = parseCaptureOutcomes(
      JSON.stringify([{ at: 1, app: 'com.bmo.mobile', amount: 12.4, outcome: 'user_ignored' }]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].outcome).toBe('user_ignored');
  });

  it('do not report the user\'s own instruction as a fault', () => {
    expect(isCaptureProblem('user_ignored')).toBe(false);
    expect(describeCaptureOutcome('user_ignored')).toContain('ignore');
  });
});
