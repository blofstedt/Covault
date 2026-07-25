import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// localNotificationMemory guards on `typeof localStorage`, so give it one.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
const storage = new MemoryStorage();
// canUseStorage() requires BOTH, so a bare localStorage stub silently no-ops.
vi.stubGlobal('localStorage', storage);
vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });

import {
  markNotificationProcessed,
  isNotificationProcessed,
  markNotificationRejected,
  isNotificationRejected,
  clearRejectedNotifications,
} from '../localNotificationMemory';

const KEY = 'com.wealthsimple|habc123';

describe('captured vs rejected notifications', () => {
  beforeEach(() => {
    storage.clear();
    vi.useRealTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('keeps the two stores independent', () => {
    markNotificationRejected(KEY);
    expect(isNotificationRejected(KEY)).toBe(true);
    // A rejection must never look like a capture — that conflation is what
    // permanently lost transactions that were only transiently rejected.
    expect(isNotificationProcessed(KEY)).toBe(false);

    storage.clear();

    markNotificationProcessed(KEY);
    expect(isNotificationProcessed(KEY)).toBe(true);
    expect(isNotificationRejected(KEY)).toBe(false);
  });

  it('expires a rejection so it is eventually re-examined', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
    markNotificationRejected(KEY);
    expect(isNotificationRejected(KEY)).toBe(true);

    // Still remembered a day later...
    vi.setSystemTime(new Date('2026-07-02T12:00:00Z'));
    expect(isNotificationRejected(KEY)).toBe(true);

    // ...but forgotten after the TTL, so the notification gets another chance.
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'));
    expect(isNotificationRejected(KEY)).toBe(false);
  });

  it('never expires a capture', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    markNotificationProcessed(KEY);

    vi.setSystemTime(new Date('2027-01-01T12:00:00Z'));
    expect(isNotificationProcessed(KEY)).toBe(true);
  });

  it('re-recording a rejection refreshes it rather than duplicating', () => {
    markNotificationRejected(KEY);
    markNotificationRejected(KEY);
    const raw = JSON.parse(storage.getItem('covault_rejected_notifs') || '[]');
    expect(raw).toHaveLength(1);
  });

  it('clears rejections on demand without touching captures', () => {
    markNotificationProcessed('captured-key');
    markNotificationRejected(KEY);

    clearRejectedNotifications();

    expect(isNotificationRejected(KEY)).toBe(false);
    expect(isNotificationProcessed('captured-key')).toBe(true);
  });

  it('survives a corrupt rejected blob', () => {
    storage.setItem('covault_rejected_notifs', '{"not":"an array"}');
    expect(isNotificationRejected(KEY)).toBe(false);
    markNotificationRejected(KEY);
    expect(isNotificationRejected(KEY)).toBe(true);
  });
});

// ── Captured-key shape ────────────────────────────────────────────────────────
// The invariant these protect: a rescan must NEVER re-import a transaction that
// is already captured, while two genuinely separate purchases that produce
// identical notification text must both be able to land.
import { buildCapturedKey, buildInMemoryDedupKey } from '../notificationProcessor';

const APP = 'com.wealthsimple';
const TEXT = 'POSTAL OUTLET 33 LD You spent $60.57 with your credit card.';
const day = (iso: string) => new Date(iso).getTime();

describe('buildCapturedKey', () => {
  it('is stable for the same notification across rescans', () => {
    // sbn.getPostTime() does not change between scans, so neither may the key.
    const post = day('2026-07-25T14:00:00');
    expect(buildCapturedKey(APP, TEXT, post)).toBe(buildCapturedKey(APP, TEXT, post));
  });

  it('separates identical purchases made on different days', () => {
    const a = buildCapturedKey(APP, TEXT, day('2026-07-25T14:00:00'));
    const b = buildCapturedKey(APP, TEXT, day('2026-07-28T09:30:00'));
    expect(a).not.toBe(b);
  });

  it('still collapses identical purchases on the same day', () => {
    // Step 4's same-day/same-amount hard skip is the intended guard here.
    const a = buildCapturedKey(APP, TEXT, day('2026-07-25T09:00:00'));
    const b = buildCapturedKey(APP, TEXT, day('2026-07-25T21:45:00'));
    expect(a).toBe(b);
  });

  it('falls back to the content-only key when no post time is available', () => {
    // Date.now() would drift across midnight and could re-import a capture, so
    // the conservative key is used instead.
    const contentOnly = buildInMemoryDedupKey(APP, TEXT);
    expect(buildCapturedKey(APP, TEXT, undefined)).toBe(contentOnly);
    expect(buildCapturedKey(APP, TEXT, 0)).toBe(contentOnly);
    expect(buildCapturedKey(APP, TEXT, Number.NaN)).toBe(contentOnly);
  });

  it('keeps the content-only key as a prefix so legacy lookups still match', () => {
    expect(buildCapturedKey(APP, TEXT, day('2026-07-25T14:00:00')))
      .toContain(buildInMemoryDedupKey(APP, TEXT));
  });

  it('does not conflate different banks reporting the same purchase', () => {
    const post = day('2026-07-25T14:00:00');
    expect(buildCapturedKey('com.wealthsimple', TEXT, post))
      .not.toBe(buildCapturedKey('com.google.android.apps.walletnfcrel', TEXT, post));
  });
});
