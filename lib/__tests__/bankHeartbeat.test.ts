import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BANK_SILENCE_DAYS,
  captureOnSince,
  noteBankAlertSeen,
  noteCaptureDisabled,
  noteCaptureEnabled,
  readBankLastSeen,
  silentBanks,
} from '../bankHeartbeat';

/**
 * A bank whose own notifications are switched off in Android sends Covault
 * nothing, forever, in complete silence — and to the user that is
 * indistinguishable from a capture feature that does not work. It is what the
 * app's first user concluded.
 *
 * Android will not tell an app whether ANOTHER app's notifications are enabled,
 * so this is an inference from the one thing observable: we have heard nothing.
 * These tests pin when that inference is allowed to be drawn, because a warning
 * raised too eagerly is worse than none — it would tell a user to go change a
 * setting that was never wrong.
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-02T12:00:00Z');
const BMO = 'com.bmo.mobile';
const TANGERINE = 'com.tangerine.mobile';

class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string) { return key in this.store ? this.store[key] : null; }
  setItem(key: string, value: string) { this.store[key] = value; }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('what we have heard from', () => {
  it('records an alert against its app', () => {
    noteBankAlertSeen(BMO, NOW);
    expect(readBankLastSeen()[BMO]).toBe(NOW);
  });

  it('does not care how the package name was cased', () => {
    noteBankAlertSeen('COM.BMO.Mobile', NOW);
    expect(readBankLastSeen()[BMO]).toBe(NOW);
  });

  it('ignores an empty package rather than storing a blank key', () => {
    noteBankAlertSeen('', NOW);
    noteBankAlertSeen(null, NOW);
    expect(Object.keys(readBankLastSeen())).toHaveLength(0);
  });

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    });
    expect(() => noteBankAlertSeen(BMO, NOW)).not.toThrow();
    expect(readBankLastSeen()).toEqual({});
  });
});

describe('when capture started listening', () => {
  it('keeps the first moment rather than re-stamping on every launch', () => {
    // Re-stamping would restart the grace period each time the app opened, so
    // a silent bank could never accumulate enough silence to be mentioned.
    noteCaptureEnabled(NOW - 30 * DAY);
    noteCaptureEnabled(NOW);
    expect(captureOnSince()).toBe(NOW - 30 * DAY);
  });

  it('starts again after capture is switched off and back on', () => {
    noteCaptureEnabled(NOW - 30 * DAY);
    noteCaptureDisabled();
    expect(captureOnSince()).toBeNull();
    noteCaptureEnabled(NOW);
    expect(captureOnSince()).toBe(NOW);
  });
});

describe('which banks are worth mentioning', () => {
  const packages = [BMO, TANGERINE];

  it('names one that has said nothing since capture was turned on', () => {
    expect(
      silentBanks({
        packages,
        lastSeen: { [TANGERINE]: NOW - DAY },
        onSince: NOW - 30 * DAY,
        now: NOW,
      }),
    ).toEqual([BMO]);
  });

  it('says nothing at all in the first days, when silence proves nothing', () => {
    expect(
      silentBanks({
        packages,
        lastSeen: {},
        onSince: NOW - (BANK_SILENCE_DAYS - 1) * DAY,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it('says nothing while capture is off — there is nothing listening to be silent', () => {
    expect(silentBanks({ packages, lastSeen: {}, onSince: null, now: NOW })).toEqual([]);
  });

  it('raises a bank that has gone quiet since, not only one never heard from', () => {
    expect(
      silentBanks({
        packages: [BMO],
        lastSeen: { [BMO]: NOW - 40 * DAY },
        onSince: NOW - 60 * DAY,
        now: NOW,
      }),
    ).toEqual([BMO]);
  });
});

describe('where the heartbeat is taken', () => {
  const root = resolve(__dirname, '../..');

  it('records every alert from a bank, not only the ones that become purchases', () => {
    // A price alert still proves Android is delivering that bank's
    // notifications, which is the only thing this answers. Taken in the
    // listener hook, after the banking-app check and before the dedup window,
    // so a re-broadcast cannot make a live bank look silent.
    const hook = readFileSync(
      resolve(root, 'lib/hooks/useNotificationListener.ts'),
      'utf8',
    );
    expect(hook).toContain('noteBankAlertSeen(bankAppId)');
    expect(hook.indexOf('noteBankAlertSeen(bankAppId)')).toBeLessThan(
      hook.indexOf('const dedupKey = buildInMemoryDedupKey'),
    );
  });

  it("offers a way to open that bank's own notification settings", () => {
    // The one repair the app can offer for a guess it cannot verify.
    const plugin = readFileSync(
      resolve(root, 'android-custom/CovaultNotificationPlugin.java'),
      'utf8',
    );
    expect(plugin).toContain('public void openAppNotificationSettings');
    expect(plugin).toContain('Settings.EXTRA_APP_PACKAGE, packageName');
  });
});
