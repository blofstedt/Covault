import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The suite runs in node, so the setup flags need a localStorage to live in.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
vi.stubGlobal('localStorage', new MemoryStorage());

import {
  buildSetupSteps,
  isSetupComplete,
  isCaptureWorking,
  isSetupPending,
  markSetupPending,
  clearSetupPending,
  hasVisitedRestrictedSettings,
  markRestrictedSettingsVisited,
  shouldEnableAfterGrant,
  type AccessState,
  type SetupStepId,
} from '../notificationAccessSetup';

/**
 * Turning on capture means granting three separate things across three Android
 * screens, in an order the platform never states. What is testable off-device
 * is the ordering itself and — more importantly — the rule that decides whether
 * coming back from Android's settings should switch capture on.
 *
 * That rule is the fix for the failure users actually hit: permission granted
 * at the OS level, Covault's own switch still off, nothing captured and nothing
 * saying why. It has to fire on a return from setup, and it must never fire for
 * someone who deliberately turned capture off.
 */

function state(over: Partial<AccessState> = {}): AccessState {
  return {
    listenerGranted: false,
    canPostNotifications: false,
    restrictedApplies: true,
    restrictedVisited: false,
    ...over,
  };
}

const ids = (s: AccessState): SetupStepId[] => buildSetupSteps(s).map((step) => step.id);
const statusOf = (s: AccessState, id: SetupStepId) =>
  buildSetupSteps(s).find((step) => step.id === id)?.status;

describe('buildSetupSteps', () => {
  it('asks for restricted settings first — the switch below it is dead until then', () => {
    expect(ids(state())).toEqual(['restricted', 'listener', 'post']);
    expect(statusOf(state(), 'restricted')).toBe('active');
    expect(statusOf(state(), 'listener')).toBe('waiting');
    expect(statusOf(state(), 'post')).toBe('waiting');
  });

  it('leaves the restricted step out where the block does not apply', () => {
    // Android 12 and below, or installed from a store. Sending the user after
    // a menu item that isn't there would be worse than saying nothing.
    expect(ids(state({ restrictedApplies: false }))).toEqual(['listener', 'post']);
    expect(statusOf(state({ restrictedApplies: false }), 'listener')).toBe('active');
  });

  it('moves on once the user has been sent to the App info page', () => {
    const s = state({ restrictedVisited: true });
    expect(statusOf(s, 'restricted')).toBe('assumed');
    expect(statusOf(s, 'listener')).toBe('active');
  });

  it('never claims the restricted step is confirmed on its own', () => {
    // Android exposes no read for it. "assumed" is what keeps the way back
    // on screen for a user whose next toggle still won't move.
    expect(statusOf(state({ restrictedVisited: true }), 'restricted')).not.toBe('done');
  });

  it('treats notification access being granted as proof the block is gone', () => {
    // Nothing else could have let that switch move.
    const s = state({ listenerGranted: true, restrictedVisited: false });
    expect(statusOf(s, 'restricted')).toBe('done');
    expect(statusOf(s, 'listener')).toBe('done');
    expect(statusOf(s, 'post')).toBe('active');
  });

  it('is finished when notifications are allowed too', () => {
    const s = state({ listenerGranted: true, canPostNotifications: true });
    expect(buildSetupSteps(s).every((step) => step.status === 'done')).toBe(true);
    expect(isSetupComplete(s)).toBe(true);
  });

  it('does not offer the last step before access exists', () => {
    // Covault can only post about a capture it is allowed to see.
    expect(statusOf(state({ canPostNotifications: false }), 'post')).toBe('waiting');
  });

  it('separates capture working from setup being finished', () => {
    // Purchases are captured without permission to post; what is lost is
    // being told about them and having the bank alert replaced.
    const s = state({ listenerGranted: true, canPostNotifications: false });
    expect(isCaptureWorking(s)).toBe(true);
    expect(isSetupComplete(s)).toBe(false);
  });
});

describe('shouldEnableAfterGrant', () => {
  it('switches capture on when the user returns from a setup they started', () => {
    expect(
      shouldEnableAfterGrant({ listenerGranted: true, settingEnabled: false, setupPending: true }),
    ).toBe(true);
  });

  it('leaves a deliberate off alone', () => {
    // The permission stays granted forever, so without the pending flag this
    // would turn capture back on at every launch for someone who had turned
    // it off on purpose.
    expect(
      shouldEnableAfterGrant({ listenerGranted: true, settingEnabled: false, setupPending: false }),
    ).toBe(false);
  });

  it('does nothing until access is actually granted', () => {
    expect(
      shouldEnableAfterGrant({ listenerGranted: false, settingEnabled: false, setupPending: true }),
    ).toBe(false);
  });

  it('does nothing when capture is already on', () => {
    expect(
      shouldEnableAfterGrant({ listenerGranted: true, settingEnabled: true, setupPending: true }),
    ).toBe(false);
  });
});

describe('the native half of the flow', () => {
  const java = readFileSync(
    resolve(__dirname, '../../android-custom/CovaultNotificationPlugin.java'),
    'utf8',
  );

  it('exposes every method the guide calls', () => {
    // A Capacitor plugin proxy accepts any method name and only fails when
    // called, so a step whose native method was never written looks like a
    // button that does nothing at all.
    for (const method of ['openAppInfo', 'getRestrictedSettingsInfo', 'requestAccess']) {
      expect(java).toContain(`public void ${method}(PluginCall call)`);
    }
  });

  it('opens the app\'s own notification-access page, not the device-wide list', () => {
    // The list means finding Covault among every installed app. The per-app
    // deep link lands on the one switch that matters.
    expect(java).toContain('ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS');
    expect(java).toContain('EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME');
  });

  it('keeps the device-wide list as a fallback', () => {
    // The deep link is optional for OEMs; a skin without it must not leave
    // the user with no route at all.
    expect(java).toContain('ACTION_NOTIFICATION_LISTENER_SETTINGS');
  });

  it('sends the restricted-settings step to App info, where the ⋮ menu lives', () => {
    expect(java).toContain('ACTION_APPLICATION_DETAILS_SETTINGS');
  });
});

describe('setup flags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts clear, records a start, and clears again', () => {
    expect(isSetupPending()).toBe(false);
    markSetupPending();
    expect(isSetupPending()).toBe(true);
    clearSetupPending();
    expect(isSetupPending()).toBe(false);
  });

  it('remembers the trip to App info across a relaunch', () => {
    // Written before the user leaves, because Android often destroys the
    // WebView while they are away — anything recorded on return may never run.
    expect(hasVisitedRestrictedSettings()).toBe(false);
    markRestrictedSettingsVisited();
    expect(hasVisitedRestrictedSettings()).toBe(true);
  });
});
