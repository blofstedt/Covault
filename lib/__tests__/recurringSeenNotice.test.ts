/**
 * "Seen — nothing needed" instead of silence, for a charge already on the
 * books as recurring.
 *
 * Before this, a recognised subscription posted no Covault notification at
 * all — correct for tray suppression (the bank's own alert has to stay, in
 * case the native match is wrong) but indistinguishable, from the user's
 * side, from Covault never having read the alert in the first place. Two
 * paths reach the same acknowledgement: the native listener posting it
 * itself in advance for the common case, and the web pipeline updating an
 * already-posted capture notification in place for the case native's dumber
 * matcher missed. Neither may touch tray suppression or the real
 * capture-notification dedup bookkeeping.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const LISTENER = read('android-custom/NotificationListener.java');
const PLUGIN = read('android-custom/CovaultNotificationPlugin.java');
const COVAULT_NOTIFICATION = read('lib/covaultNotification.ts');
const USE_LISTENER = read('lib/hooks/useNotificationListener.ts');

describe('the native side posts the notice itself, in the common case', () => {
  it('calls it exactly where the alert is recognised as recurring, before anything else happens to it', () => {
    const marker = 'Already a known recurring charge; capturing quietly';
    const idx = LISTENER.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    // The call has to be within a few lines of the log line that names the
    // same decision, or a refactor could silently separate the two.
    expect(LISTENER.slice(idx, idx + 600)).toContain('notifySeenRecurring(amount, vendor)');
  });

  // Sliced between its own signature and the next method's — a fixed
  // character count either bled past the closing brace into unrelated code
  // (a false failure) or stopped short of it (a false pass), so the boundary
  // is the next doc comment instead: precise regardless of how the method
  // body is edited.
  const notifySeenRecurringBody = LISTENER.slice(
    LISTENER.indexOf('private void notifySeenRecurring'),
    LISTENER.indexOf('/**\n     * Take a capture notification back down.'),
  );

  it('the method actually exists between those two markers', () => {
    expect(notifySeenRecurringBody.length).toBeGreaterThan(200);
  });

  it('is silent and low priority, since it confirms something already expected', () => {
    expect(notifySeenRecurringBody).toContain('setSilent(true)');
    expect(notifySeenRecurringBody).toContain('PRIORITY_LOW');
  });

  it('never offers "tap to review" — there is nothing to review', () => {
    // Checked as the actual functional usage, not a bare substring: the
    // method's own comment explains the omission by naming ROUTE_REVIEW, so
    // a plain toContain would fail on the explanation itself.
    expect(notifySeenRecurringBody).not.toContain('putExtra(ROUTE_EXTRA, ROUTE_REVIEW)');
  });

  it('stays out of the dedup map the real capture notification uses', () => {
    // That map exists so two different PURCHASES at the same price don't
    // collapse into one notification — losing a real expense would be the
    // cost of a collision. A duplicate "seen" notice loses nothing, so it
    // must not compete for the same bookkeeping.
    expect(notifySeenRecurringBody).not.toContain('recentCaptureNotifications');
  });
});

describe('the web pipeline can acknowledge one already posted, as a fallback', () => {
  it('replaces the capture notification in place rather than posting a second one', () => {
    const body = LISTENER.slice(
      LISTENER.indexOf('static void acknowledgeCaptureNotification'),
      LISTENER.indexOf('static void acknowledgeCaptureNotification') + 2500,
    );
    // Posted under the SAME id the capture notification used — nm.notify
    // with an id already in the shade replaces it.
    expect(body).toContain('nm.notify(id, b.build())');
    expect(body).toContain('CAPTURE_CHANNEL_ID');
  });

  it('clears the dedup entry, the same as an outright cancel does', () => {
    const body = LISTENER.slice(
      LISTENER.indexOf('static void acknowledgeCaptureNotification'),
      LISTENER.indexOf('static void acknowledgeCaptureNotification') + 3500,
    );
    expect(body).toContain('recentCaptureNotifications');
  });

  it('is exposed as a plugin method the web layer can call', () => {
    expect(PLUGIN).toContain('public void acknowledgeCaptureNotification(PluginCall call)');
  });
});

describe('the JS bridge', () => {
  it('declares and exports acknowledgeCaptureNotification', () => {
    expect(COVAULT_NOTIFICATION).toContain('acknowledgeCaptureNotification(options:');
    expect(COVAULT_NOTIFICATION).toContain('export async function acknowledgeCaptureNotification');
  });

  it('uses it for a recurring match instead of cancelling the notification outright', () => {
    const marker = "result.skipReason === 'duplicate_recurring'";
    const idx = USE_LISTENER.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    const body = USE_LISTENER.slice(idx, idx + 400);
    expect(body).toContain('acknowledgeCaptureNotification(');
    expect(body).not.toContain('void cancelCaptureNotification(');
  });

  it('leaves the not_transaction branch cancelling outright, unchanged', () => {
    // A price alert or promo has nothing to acknowledge — the notification
    // it never should have implied has to come all the way down, not be
    // replaced with a different claim.
    const marker = "result.skipReason === 'not_transaction'";
    const idx = USE_LISTENER.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    expect(USE_LISTENER.slice(idx, idx + 300)).toContain('cancelCaptureNotification(');
  });
});
