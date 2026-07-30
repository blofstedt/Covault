import { describe, it, expect, vi } from 'vitest';
import {
  getHideBankNotifications,
  setHideBankNotifications,
  type CovaultNotificationPlugin,
} from '../covaultNotification';

/**
 * Tray suppression lets the native listener dismiss a bank's own notification
 * once it has captured the purchase. The native gating (persist → notify →
 * dismiss) lives in NotificationListener.java and can only be exercised on a
 * device. What is testable here is the JS side of the contract, and the thing
 * that matters about it: the toggle must never report "on" unless the native
 * side actually stored "on". A UI that shows suppression enabled while the
 * listener still has it disabled — or worse, the reverse — is how a user ends
 * up believing alerts are being captured when they are only being deleted.
 */

/** Minimal stand-in; only the two methods under test are ever called. */
function stubPlugin(over: Partial<CovaultNotificationPlugin>): CovaultNotificationPlugin {
  return over as CovaultNotificationPlugin;
}

describe('getHideBankNotifications', () => {
  it('returns false with no plugin (web build)', async () => {
    expect(await getHideBankNotifications(null)).toBe(false);
  });

  it('reads the native value', async () => {
    const plugin = stubPlugin({
      getHideBankNotifications: vi.fn(async () => ({ hidden: true })),
    });
    expect(await getHideBankNotifications(plugin)).toBe(true);
  });

  it('returns false when the native method is missing (older APK)', async () => {
    // A Capacitor plugin proxy exposes any method name and only rejects when
    // called, so "not implemented" surfaces as a rejected promise rather than
    // an undefined property.
    const plugin = stubPlugin({
      getHideBankNotifications: vi.fn(async () => {
        throw new Error('not implemented');
      }),
    });
    expect(await getHideBankNotifications(plugin)).toBe(false);
  });

  it('coerces a non-boolean native reply to false', async () => {
    const plugin = stubPlugin({
      getHideBankNotifications: vi.fn(async () => ({ hidden: 'yes' as unknown as boolean })),
    });
    expect(await getHideBankNotifications(plugin)).toBe(false);
  });
});

describe('setHideBankNotifications', () => {
  it('returns the requested value once the native side accepts it', async () => {
    const set = vi.fn(async () => {});
    const plugin = stubPlugin({ setHideBankNotifications: set });
    expect(await setHideBankNotifications(true, plugin)).toBe(true);
    expect(set).toHaveBeenCalledWith({ hidden: true });
  });

  it('reports the unchanged native value when the write fails', async () => {
    // The important case. The user asked to turn suppression ON, the native
    // write failed, so suppression is still OFF — and the caller must be told
    // OFF so the toggle springs back instead of implying alerts are being
    // dismissed when they are not.
    const plugin = stubPlugin({
      setHideBankNotifications: vi.fn(async () => {
        throw new Error('not implemented');
      }),
      getHideBankNotifications: vi.fn(async () => ({ hidden: false })),
    });
    expect(await setHideBankNotifications(true, plugin)).toBe(false);
  });

  it('falls back to false when both the write and the read-back fail', async () => {
    const plugin = stubPlugin({
      setHideBankNotifications: vi.fn(async () => {
        throw new Error('not implemented');
      }),
      getHideBankNotifications: vi.fn(async () => {
        throw new Error('not implemented');
      }),
    });
    expect(await setHideBankNotifications(true, plugin)).toBe(false);
  });

  it('returns false with no plugin (web build)', async () => {
    expect(await setHideBankNotifications(true, null)).toBe(false);
  });
});
