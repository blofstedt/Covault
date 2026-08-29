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
  hasAttemptedListener,
  markListenerAttempted,
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
    listenerAttempted: false,
    restrictedVisited: false,
    ...over,
  };
}

const ids = (s: AccessState): SetupStepId[] => buildSetupSteps(s).map((step) => step.id);
const statusOf = (s: AccessState, id: SetupStepId) =>
  buildSetupSteps(s).find((step) => step.id === id)?.status;

describe('buildSetupSteps', () => {
  it('leads with the attempt, and does not mention the unlock yet', () => {
    // "Allow restricted settings" is absent from the App info menu until
    // Android has refused the app once. Offering the unlock first sends the
    // user to look for something that is not there.
    expect(ids(state())).toEqual(['listener', 'post']);
    expect(statusOf(state(), 'listener')).toBe('active');
    expect(statusOf(state(), 'post')).toBe('waiting');
  });

  it('reveals the unlock, and the second visit behind it, once the switch has been tried', () => {
    const s = state({ listenerAttempted: true });
    expect(ids(s)).toEqual(['listener', 'restricted', 'confirm', 'post']);
    expect(statusOf(s, 'restricted')).toBe('active');
    // The first visit is behind the user: its job was to be refused, and it
    // stops asking to be pressed again — the same dead switch is not the way
    // forward, the unlock below it is.
    expect(statusOf(s, 'listener')).toBe('assumed');
    // And the way on from the unlock is a step of its own, waiting its turn
    // rather than offering a second thing to press right now.
    expect(statusOf(s, 'confirm')).toBe('waiting');
  });

  it('numbers the same three screens in the order they are visited', () => {
    // The list must not renumber under the user mid-flow: the step they are
    // reading has to keep the number it had when they left for Settings.
    const tried = state({ listenerAttempted: true });
    const unlocked = state({ listenerAttempted: true, restrictedVisited: true });
    expect(ids(tried)).toEqual(ids(unlocked));
  });

  it('never shows the unlock where the block does not apply', () => {
    // Android 12 and below, or installed from a store: the attempt failed for
    // some other reason and this menu item does not exist at all.
    const s = state({ restrictedApplies: false, listenerAttempted: true });
    expect(ids(s)).toEqual(['listener', 'post']);
    expect(statusOf(s, 'listener')).toBe('active');
  });

  it('hands the user back to the switch after the unlock', () => {
    const s = state({ listenerAttempted: true, restrictedVisited: true });
    expect(statusOf(s, 'restricted')).toBe('assumed');
    // As its own step, with its own button — not as the first step quietly
    // going amber again, which reads as the flow having lost its place.
    expect(statusOf(s, 'confirm')).toBe('active');
    expect(statusOf(s, 'listener')).toBe('assumed');
  });

  it('only ever offers one thing to press', () => {
    for (const s of [
      state(),
      state({ listenerAttempted: true }),
      state({ listenerAttempted: true, restrictedVisited: true }),
      state({ listenerGranted: true, listenerAttempted: true, restrictedVisited: true }),
      state({ listenerGranted: true, canPostNotifications: true }),
    ]) {
      expect(buildSetupSteps(s).filter((step) => step.status === 'active').length)
        .toBeLessThanOrEqual(1);
    }
  });

  it('never claims the unlock is confirmed on its own', () => {
    // Android exposes no read for it. "assumed" is what keeps the way back
    // on screen for a user whose switch still won't move.
    const s = state({ listenerAttempted: true, restrictedVisited: true });
    expect(statusOf(s, 'restricted')).not.toBe('done');
  });

  it('drops the unlock and the second visit once access is granted', () => {
    // Nothing else could have let that switch move, so there is nothing left
    // to say about either of them.
    const s = state({ listenerGranted: true, listenerAttempted: true, restrictedVisited: true });
    expect(ids(s)).toEqual(['listener', 'post']);
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

  it('asks Settings to flash the right row when it has to use the list', () => {
    // The fallback drops the user into every installed app. These are the
    // extras Settings reads to scroll to one row and highlight it; honoured
    // only by some builds, which is why the route still works without them.
    expect(java).toContain(':settings:fragment_args_key');
    expect(java).toContain(':settings:show_fragment_args');
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

  it('remembers that the switch was tried', () => {
    // The flag the unlock step is revealed by. It has to survive the trip for
    // the same reason, or the user comes back to a card that has forgotten
    // they were ever refused.
    expect(hasAttemptedListener()).toBe(false);
    markListenerAttempted();
    expect(hasAttemptedListener()).toBe(true);
  });
});
