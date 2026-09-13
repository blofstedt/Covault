import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureNotificationId } from '../appNotifications';

/**
 * One purchase, one notification, and it goes away when the purchase is dealt
 * with.
 *
 * Two things were wrong. A capture that arrived through the native listener
 * produced TWO notices — the listener posts the instant the alert lands, which
 * is what lets it dismiss the bank's own alert with the app closed, and then
 * the pipeline posted its own once the row existed. Tapping either dismissed
 * only itself, so the other sat in the shade looking ignored. And neither came
 * down when the user actually reviewed the purchase, which is the one moment
 * a notice reading "tap to review" has nothing left to say.
 *
 * Nothing in CI posts or cancels an Android notification, so this reads the
 * source for the wiring and tests the id arithmetic directly.
 */

const read = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf8');
const LISTENER = read('lib/hooks/useNotificationListener.ts');
const PARSING = read('components/TransactionParsing.tsx');

describe('the id a capture notice is posted under', () => {
  it('is the same every time for the same transaction', () => {
    // This is what makes the notice findable later from nothing but the row.
    const id = captureNotificationId('9f1c0f1e-0000-4000-8000-000000000001');
    expect(captureNotificationId('9f1c0f1e-0000-4000-8000-000000000001')).toBe(id);
  });

  it('differs between transactions', () => {
    expect(captureNotificationId('a')).not.toBe(captureNotificationId('b'));
  });

  it('is a positive 32-bit int, which is all Android will take', () => {
    for (const uuid of [
      '9f1c0f1e-0000-4000-8000-000000000001',
      'ffffffff-ffff-4fff-bfff-ffffffffffff',
      '00000000-0000-4000-8000-000000000000',
    ]) {
      const id = captureNotificationId(uuid);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThanOrEqual(2147483647);
    }
  });
});

describe('the listener notice', () => {
  it('comes down once the richer one replaces it', () => {
    expect(LISTENER).toMatch(/cancelCaptureNotification\(event\.capture_notification_id\)/);
  });

  it('is only taken down when a replacement actually went up', () => {
    // Capture notifications can be switched off, in which case the pipeline
    // posts nothing. Cancelling the listener's notice then would leave no
    // notice at all for a purchase whose bank alert Covault already
    // suppressed — the one case where the user is told nothing.
    const block = LISTENER.slice(LISTENER.indexOf('sendExpenseCapturedNotification('));
    const guarded = block.slice(0, block.indexOf('});'));
    expect(guarded).toMatch(/if \(posted && event\.capture_notification_id\)/);
  });
});

describe('reviewing a purchase', () => {
  it('takes its notification down', () => {
    // Filing one row, clearing the list, and deleting — the three ways a
    // captured purchase stops needing review.
    const calls = [...PARSING.matchAll(/dismissCaptureNotification\(/g)];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('does not put it back when the user undoes', () => {
    // The row returns to Review, where the list and the badge say so. A
    // notification that reappears after being dealt with is worse than one
    // that does not come back at all.
    const undo = PARSING.slice(PARSING.indexOf('const restoreCaughtTransactions'));
    const body = undo.slice(0, undo.indexOf('\n  );'));
    expect(body).not.toContain('sendExpenseCapturedNotification');
  });
});
