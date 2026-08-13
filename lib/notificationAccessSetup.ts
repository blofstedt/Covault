// lib/notificationAccessSetup.ts
//
// The state machine behind the guided "turn on capture" flow.
//
// Granting notification access to a sideloaded Android app is four actions
// across three screens, and the platform signposts none of them: allow
// restricted settings behind an unlabelled overflow menu and a fingerprint,
// grant notification access, allow Covault to post notifications, and switch
// capture on inside Covault. Miss any one and the symptom is identical —
// nothing is ever captured — so the flow has to name each step, check the ones
// that can be checked, and never depend on the user remembering the order.
//
// Kept free of React and of Capacitor so the ordering rules are testable
// without a device; the component is only responsible for rendering these
// steps and for asking the native side the three questions they read.

/** The three things Android needs from the user, in the order it needs them. */
export type SetupStepId = 'restricted' | 'listener' | 'post';

/**
 * `done` — verified just now against the OS.
 * `assumed` — the user has been sent to do it, but Android exposes no way to
 *   read the result. Only ever the restricted-settings step.
 * `active` — the one to do next.
 * `waiting` — blocked behind an earlier step.
 */
export type SetupStepStatus = 'done' | 'assumed' | 'active' | 'waiting';

export interface SetupStep {
  id: SetupStepId;
  status: SetupStepStatus;
}

export interface AccessState {
  /** Covault is in Android's enabled notification listeners. Verified. */
  listenerGranted: boolean;
  /** Covault can post its own notifications. Verified. */
  canPostNotifications: boolean;
  /**
   * The restricted-settings block applies to this install — Android 13+ and
   * not installed from a store. False leaves the step out of the flow.
   */
  restrictedApplies: boolean;
  /** The user has tapped through to the App info page at least once. */
  restrictedVisited: boolean;
}

/**
 * The steps to show, in order, with each one's state.
 *
 * The restricted-settings step is the awkward one: there is no API that
 * reports whether the user allowed it, so it can never be confirmed directly.
 * What can be said is that notification access being granted is proof the
 * block is no longer in the way — nothing else could have let the toggle move
 * — so the step resolves the moment the next one succeeds, and until then it
 * reads as assumed rather than done.
 */
export function buildSetupSteps(state: AccessState): SetupStep[] {
  const steps: SetupStep[] = [];

  const restrictedSettled = state.listenerGranted || state.restrictedVisited;

  if (state.restrictedApplies) {
    steps.push({
      id: 'restricted',
      status: state.listenerGranted ? 'done' : state.restrictedVisited ? 'assumed' : 'active',
    });
  }

  steps.push({
    id: 'listener',
    status: state.listenerGranted
      ? 'done'
      : state.restrictedApplies && !restrictedSettled
        ? 'waiting'
        : 'active',
  });

  steps.push({
    id: 'post',
    status: state.canPostNotifications ? 'done' : state.listenerGranted ? 'active' : 'waiting',
  });

  return steps;
}

/**
 * Whether every step is behind the user.
 *
 * Posting notifications counts, even though captures are saved without it:
 * with it missing, a purchase caught while the app is closed is saved in
 * silence and the bank's own alert is never replaced, which is
 * indistinguishable from capture being broken.
 */
export function isSetupComplete(state: AccessState): boolean {
  return state.listenerGranted && state.canPostNotifications;
}

/** Capture itself works — the part that survives without the extras. */
export function isCaptureWorking(state: AccessState): boolean {
  return state.listenerGranted;
}

// ---------------------------------------------------------------------------
// "The user is part-way through setup"
// ---------------------------------------------------------------------------
//
// Granting access means leaving Covault for Android's settings, possibly for
// several minutes, and coming back. The app has to be able to tell that return
// apart from an ordinary launch, because on that return it owes the user two
// things it must not do at any other time: switch capture on, and ask for
// permission to post notifications.
//
// Getting this wrong in the other direction is worse than not doing it at all.
// If "notification access is granted" alone were enough to switch capture on,
// a user who had deliberately turned capture off would find it back on at the
// next launch, for good — Android's permission stays granted, so the condition
// would be true forever. Hence a flag with an explicit beginning and end,
// rather than inferring intent from the permission.
//
// It lives in localStorage because the WebView is routinely destroyed while the
// user is away in Settings; anything held in memory would not survive the trip.

const SETUP_PENDING_KEY = 'covault_notification_setup_pending_v1';
const RESTRICTED_VISITED_KEY = 'covault_restricted_settings_visited_v1';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // A device with storage blocked loses only the automatic finish; every
    // step is still reachable by hand.
  }
}

/** The user has started the flow and has not finished or abandoned it. */
export function isSetupPending(): boolean {
  return readFlag(SETUP_PENDING_KEY);
}

/** Called when the user starts the flow. */
export function markSetupPending(): void {
  writeFlag(SETUP_PENDING_KEY, true);
}

/** Called once the grant has been seen, or when the user closes the flow. */
export function clearSetupPending(): void {
  writeFlag(SETUP_PENDING_KEY, false);
}

/** The user has been sent to the App info page at least once. */
export function hasVisitedRestrictedSettings(): boolean {
  return readFlag(RESTRICTED_VISITED_KEY);
}

/** Called as the user is sent to the App info page. */
export function markRestrictedSettingsVisited(): void {
  writeFlag(RESTRICTED_VISITED_KEY, true);
}

/**
 * Whether returning from Android's settings should switch capture on.
 *
 * True exactly once per run through the flow: access has been granted, the
 * in-app setting is still off, and the user is the one who asked for this. The
 * caller clears the pending flag as it acts.
 *
 * This is the fix for capture that "works but doesn't work" — permission
 * granted at the OS level while Covault's own switch stayed off, so nothing was
 * ever recorded and nothing said why.
 */
export function shouldEnableAfterGrant(opts: {
  listenerGranted: boolean;
  settingEnabled: boolean;
  setupPending: boolean;
}): boolean {
  return opts.listenerGranted && !opts.settingEnabled && opts.setupPending;
}
