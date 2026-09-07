/**
 * The setting that decides whether capture is still working next week.
 *
 * The listener runs with the app closed, and a phone that has decided Covault
 * is a battery drain simply stops waking it. There is no error, no
 * notification and nothing in the app to see — purchases stop arriving, which
 * looks exactly like a quiet week, a revoked permission, or a broken app. It is
 * the most likely reason capture works for two days and then does nothing, and
 * it is worst on the phones most people own.
 *
 * These pin the two halves that cannot be checked by running the app on a
 * laptop: the rules about when to ask, and that the native methods the buttons
 * call actually exist. A Capacitor plugin proxy accepts any method name and
 * only fails when it is called, so a renamed method is a button that silently
 * does nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
vi.stubGlobal('localStorage', new MemoryStorage());

import {
  BATTERY_HINT_DIRECT,
  BATTERY_HINT_LIST,
  batteryHintFor,
  hasAskedBatteryExemption,
  markBatteryExemptionAsked,
  oemBatteryNote,
  shouldOfferBatteryExemption,
} from '../batteryOptimization';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const JAVA = read('android-custom/CovaultNotificationPlugin.java');
const MANIFEST = read('android-custom/AndroidManifest.xml');
const GUIDE = read('components/NotificationAccessGuide.tsx');
const CARD = read(
  'components/dashboard_components/settings_modal_components/BatteryOptimizationCard.tsx',
);

describe('when to ask', () => {
  it('asks when capture is on and Android is still allowed to sleep it', () => {
    expect(shouldOfferBatteryExemption({ captureEnabled: true, exempt: false, alreadyAsked: false }))
      .toBe(true);
  });

  it('says nothing while capture is off — there is nothing to protect', () => {
    expect(shouldOfferBatteryExemption({ captureEnabled: false, exempt: false, alreadyAsked: false }))
      .toBe(false);
  });

  it('says nothing once the phone is already leaving Covault alone', () => {
    expect(shouldOfferBatteryExemption({ captureEnabled: true, exempt: true, alreadyAsked: false }))
      .toBe(false);
  });

  it('asks once, not on every visit to Settings', () => {
    // Unlike the restricted-settings unlock, this one can be read back — so a
    // user who went there and left optimisation on has answered the question.
    // Asking again every time is how an app teaches people to scroll past it.
    expect(shouldOfferBatteryExemption({ captureEnabled: true, exempt: false, alreadyAsked: true }))
      .toBe(false);
  });
});

describe('what the user is told once Settings has the screen', () => {
  it('names the one button on the direct route', () => {
    expect(batteryHintFor({ canRequestDirectly: true })).toBe(BATTERY_HINT_DIRECT);
  });

  it('says how to find Covault when the route is the whole-device list', () => {
    // That list opens on "Not optimised" apps, which by definition does not
    // include Covault — without the dropdown the user is looking at a list
    // their app cannot be in.
    expect(batteryHintFor({ canRequestDirectly: false })).toBe(BATTERY_HINT_LIST);
    expect(BATTERY_HINT_LIST).toMatch(/All apps/i);
  });
});

describe('the OEM note', () => {
  it('names the second screen on the skins that have one', () => {
    expect(oemBatteryNote('samsung')).toMatch(/Background usage limits/i);
    expect(oemBatteryNote('Xiaomi')).toMatch(/Autostart/i);
    expect(oemBatteryNote('POCO')).toMatch(/Autostart/i);
    expect(oemBatteryNote('HUAWEI')).toMatch(/App launch/i);
    expect(oemBatteryNote('OnePlus')).toBeTruthy();
  });

  it('says nothing about a phone it knows nothing about', () => {
    expect(oemBatteryNote('Google')).toBeNull();
    expect(oemBatteryNote('')).toBeNull();
    expect(oemBatteryNote(null)).toBeNull();
  });

  it('is never a button', () => {
    // Those screens are reached by undocumented intents that differ between
    // versions and throw when absent. A button that silently does nothing is
    // worse than a sentence, because it looks like it worked.
    expect(JAVA).not.toContain('miui');
    expect(JAVA).not.toContain('AutoStart');
  });
});

describe('remembering that we asked', () => {
  beforeEach(() => localStorage.clear());

  it('starts clear and records the trip', () => {
    expect(hasAskedBatteryExemption()).toBe(false);
    markBatteryExemptionAsked();
    expect(hasAskedBatteryExemption()).toBe(true);
  });
});

describe('the native side the buttons call', () => {
  it('exists', () => {
    for (const method of ['getBatteryOptimizationInfo', 'requestBatteryExemption']) {
      expect(JAVA).toContain(`public void ${method}(PluginCall call)`);
    }
  });

  it('reads the exemption back rather than assuming it', () => {
    // This is the one step in the whole setup flow Android will report on, so
    // it is the one that can be ticked off honestly.
    expect(JAVA).toContain('isIgnoringBatteryOptimizations');
  });

  it('only shows the one-tap dialog where the permission is actually held', () => {
    // Without it the action is ignored, and an ignored intent looks exactly
    // like a broken button.
    expect(JAVA).toContain('ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(JAVA).toContain('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
    expect(MANIFEST).toContain('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS');
  });

  it('falls back to the list, and flashes Covault\'s row in it', () => {
    expect(JAVA).toContain('ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    const body = JAVA.slice(JAVA.indexOf('public void requestBatteryExemption(PluginCall call)'));
    expect(body.slice(0, 4000)).toContain('SETTINGS_SHOW_FRAGMENT_ARGS');
  });

  it('keeps its words in the app, not in the Java', () => {
    // Every other pair of mirrored strings in this project needs a test to
    // stop it drifting. This one does not have to be a pair.
    expect(JAVA).not.toContain('Don’t optimise');
    expect(JAVA).not.toContain('Tap Allow');
  });
});

describe('both surfaces say the same thing', () => {
  it('take their words from one place', () => {
    // The setup flow's step and the Settings card ask for the same switch. Two
    // copies of that sentence is two things to keep in step.
    expect(GUIDE).toContain('BATTERY_STEP_COPY');
    expect(CARD).toContain('BATTERY_STEP_COPY');
  });
});
