import { describe, it, expect, vi } from 'vitest';
import {
  getHideBankNotifications,
  setHideBankNotifications,
  canPostCaptureNotifications,
  openNotificationSettings,
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

/**
 * The toggle's invisible precondition.
 *
 * Suppression only ever dismisses a bank alert after Covault has posted its
 * own notification in its place, so when Android is blocking that post nothing
 * is hidden — while the toggle still reads "on" and captures still arrive in
 * Review. There is no symptom to notice, which is why the settings screen asks
 * outright and warns.
 *
 * The defaults are the point here, and they run in opposite directions to the
 * suppression toggle's. That toggle answers "false" to anything it cannot
 * confirm, because acting on an unconfirmed "on" would delete a user's bank
 * alerts. This one answers "true", because acting on an unconfirmed "blocked"
 * would send the user off to fix a permission that was never broken.
 */
describe('canPostCaptureNotifications', () => {
  it('reads the native answer', async () => {
    const plugin = stubPlugin({
      getCaptureNotificationStatus: vi.fn(async () => ({ canPost: false })),
    });
    expect(await canPostCaptureNotifications(plugin)).toBe(false);
  });

  it('reports allowed when the native side says so', async () => {
    const plugin = stubPlugin({
      getCaptureNotificationStatus: vi.fn(async () => ({ canPost: true })),
    });
    expect(await canPostCaptureNotifications(plugin)).toBe(true);
  });

  it('assumes allowed on an older APK rather than raising a false alarm', async () => {
    const plugin = stubPlugin({
      getCaptureNotificationStatus: vi.fn(async () => {
        throw new Error('not implemented');
      }),
    });
    expect(await canPostCaptureNotifications(plugin)).toBe(true);
  });

  it('assumes allowed with no plugin (web build)', async () => {
    expect(await canPostCaptureNotifications(null)).toBe(true);
  });

  it('treats a non-boolean native reply as allowed', async () => {
    const plugin = stubPlugin({
      getCaptureNotificationStatus: vi.fn(async () => ({
        canPost: 'no' as unknown as boolean,
      })),
    });
    expect(await canPostCaptureNotifications(plugin)).toBe(true);
  });
});

describe('openNotificationSettings', () => {
  it('asks the native side to open the page', async () => {
    const open = vi.fn(async () => {});
    await openNotificationSettings(stubPlugin({ openNotificationSettings: open }));
    expect(open).toHaveBeenCalled();
  });

  it('does not throw on an older APK', async () => {
    const plugin = stubPlugin({
      openNotificationSettings: vi.fn(async () => {
        throw new Error('not implemented');
      }),
    });
    await expect(openNotificationSettings(plugin)).resolves.toBeUndefined();
  });

  it('does nothing with no plugin (web build)', async () => {
    await expect(openNotificationSettings(null)).resolves.toBeUndefined();
  });
});
