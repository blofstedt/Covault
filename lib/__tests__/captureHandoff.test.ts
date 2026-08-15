import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Losing a captured purchase is the worst thing this app can do, and the
 * hand-off from the native queue to the JS pipeline is the one place it can
 * happen silently: the drain empties the queue as it reads it, and tray
 * suppression has already taken the bank's own alert out of the shade.
 *
 * The failure this covers: a purchase captured with the app closed, then the
 * app launched by tapping Covault's own notification. The listener hook mounts
 * and drains long before Supabase has restored the session, so every drained
 * entry was dropped for having no user to file it under — with nothing left
 * anywhere to recover it from.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

const drainPendingNotifications = vi.fn();

vi.mock('../covaultNotification', () => ({
  covaultNotification: {
    get drainPendingNotifications() { return drainPendingNotifications; },
  },
  cancelCaptureNotification: vi.fn(),
}));

import { drainQueuedNotifications, PENDING_CAPTURE_STASH_KEY } from '../pendingCaptureQueue';

const costco = {
  rawNotification: 'Purchase of $184.32 at COSTCO WHOLESALE #543',
  bankAppId: 'com.bmo.mobile',
  amount: 184.32,
  vendor: 'Costco',
  timestamp: 1_755_000_000_000,
};

function parked(): any[] {
  const stored = storage.getItem(PENDING_CAPTURE_STASH_KEY);
  return stored ? JSON.parse(stored) : [];
}

describe('handing the native capture queue to the pipeline', () => {
  beforeEach(() => {
    storage.clear();
    drainPendingNotifications.mockReset();
  });

  it('processes what the native queue hands over', async () => {
    drainPendingNotifications.mockResolvedValue({ notifications: [costco] });
    const seen: any[] = [];

    await drainQueuedNotifications(async (e) => { seen.push(e); });

    expect(seen).toEqual([costco]);
    expect(parked()).toHaveLength(0);
  });

  it('parks the batch before processing it, so a crash mid-batch loses nothing', async () => {
    drainPendingNotifications.mockResolvedValue({ notifications: [costco] });

    // The WebView dies while the pipeline is working on the entry: the handler
    // never returns normally, and the queue it came from is already empty.
    await drainQueuedNotifications(async () => { throw new Error('WebView destroyed'); });

    expect(parked()).toHaveLength(1);
    expect(parked()[0].event).toEqual(costco);
  });

  it('replays a parked capture on the next launch', async () => {
    drainPendingNotifications.mockResolvedValue({ notifications: [costco] });
    await drainQueuedNotifications(async () => { throw new Error('WebView destroyed'); });

    // Next launch. The native queue is empty now — the entry can only come
    // back from where it was parked.
    drainPendingNotifications.mockResolvedValue({ notifications: [] });
    const seen: any[] = [];
    await drainQueuedNotifications(async (e) => { seen.push(e); });

    expect(seen).toEqual([costco]);
    expect(parked()).toHaveLength(0);
  });

  it('gives up on an entry that keeps failing, rather than wedging capture', async () => {
    drainPendingNotifications.mockResolvedValue({ notifications: [costco] });
    const failing = async () => { throw new Error('poison'); };

    await drainQueuedNotifications(failing);
    expect(parked()).toHaveLength(1);

    // Two more launches retry it; the one after that abandons it.
    drainPendingNotifications.mockResolvedValue({ notifications: [] });
    await drainQueuedNotifications(failing);
    await drainQueuedNotifications(failing);
    expect(parked()).toHaveLength(1);

    await drainQueuedNotifications(failing);
    expect(parked()).toHaveLength(0);
  });

  it('processes a batch in the order it arrived', async () => {
    const second = { ...costco, amount: 12.5, timestamp: costco.timestamp + 60_000 };
    drainPendingNotifications.mockResolvedValue({ notifications: [costco, second] });
    const seen: number[] = [];

    await drainQueuedNotifications(async (e) => { seen.push(e.amount as number); });

    expect(seen).toEqual([184.32, 12.5]);
  });

  it('survives a native queue that fails to drain', async () => {
    drainPendingNotifications.mockRejectedValue(new Error('bridge gone'));
    await expect(drainQueuedNotifications(async () => {})).resolves.toBeUndefined();
  });
});

/**
 * The guard itself. Read from source because the hook cannot be mounted here —
 * what matters is that the drain is not reachable without a signed-in user.
 */
describe('the drain never runs before there is a user', () => {
  const hook = readFileSync(
    resolve(__dirname, '../hooks/useNotificationListener.ts'),
    'utf8',
  );

  it('guards the launch drain on a restored session', () => {
    expect(hook).toMatch(/if \(user\?\.id\) void drainQueuedNotifications\(handleEvent\)/);
  });

  it('guards the resume drain too', () => {
    expect(hook).toMatch(
      /if \(!user\?\.id\) return;\s*\n\s*void drainQueuedNotifications\(handleEvent\)/,
    );
  });

  it('has no third, unguarded drain call site', () => {
    expect((hook.match(/drainQueuedNotifications\(/g) || []).length).toBe(2);
  });
});
