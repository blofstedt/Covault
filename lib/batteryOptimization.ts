// lib/batteryOptimization.ts
//
// The permission nobody thinks to ask for, and the reason capture stops
// working after two days.
//
// The notification listener runs with the app closed — that is the whole point
// of it. On a phone that has decided Covault is a battery drain, "closed"
// quietly becomes "stopped": the service is not restarted after a reboot, or is
// killed after a few hours idle, or never wakes for the alert at all. There is
// no error, no notification, and nothing in the app to see. Purchases simply
// stop arriving, which is indistinguishable from a bank that went quiet, from a
// permission that was revoked, and from the app being broken.
//
// It is worst on exactly the phones most people have. Samsung's "deep sleeping
// apps", Xiaomi's autostart, Huawei's manual launch and OnePlus/Oppo/Vivo's
// own variants are all more aggressive than stock Android, and none of them is
// reachable by an intent that can be relied on — the actions are undocumented,
// differ between skins and versions, and throw when they are absent. So Covault
// opens the one screen every Android has and NAMES the other place, rather than
// launching something that might not exist.
//
// The words live here rather than in the component because two surfaces show
// them — the setup flow's step, and a card in Settings for somebody whose
// capture is already running — and a second copy is a second thing to keep in
// step. The Java has no copy at all: it posts whatever hint it is handed.

/** What the native side reports about this phone. */
export interface BatteryOptimizationInfo {
  /** Android is already leaving Covault alone. Verified, not assumed. */
  exempt: boolean;
  /**
   * This build can show the one-tap "Allow" dialog, because it holds
   * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS. False means the route is the
   * device-wide list, which needs a different sentence on the way out.
   */
  canRequestDirectly: boolean;
  /** `Build.MANUFACTURER`, for the extra note below. */
  manufacturer: string;
}

export const BATTERY_STEP_COPY = {
  title: 'Stop Android sleeping Covault',
  body:
    "Covault listens for your bank's alerts while it is closed. Left on the default setting, Android is free to shut that down after a while to save battery — and when it does, purchases stop being captured with nothing to say so.",
  action: 'Allow Covault to run',
} as const;

/**
 * The sentence shown as a Toast once Settings has the screen.
 *
 * Two of them, because the two routes ask for completely different things: a
 * dialog with one button to press, or a list of every app on the phone with a
 * dropdown that has to be changed before Covault is even in it.
 */
export const BATTERY_HINT_DIRECT = 'Tap Allow — that is the whole step.';
export const BATTERY_HINT_LIST =
  'Switch the dropdown to All apps, find Covault, then choose Don’t optimise.';

export function batteryHintFor(info: Pick<BatteryOptimizationInfo, 'canRequestDirectly'>): string {
  return info.canRequestDirectly ? BATTERY_HINT_DIRECT : BATTERY_HINT_LIST;
}

/**
 * The second place this particular phone hides the same switch.
 *
 * Written instructions, deliberately, and never a button. These screens are
 * reached by undocumented intents that vary between skins and versions and
 * throw when they are missing, so a button here would be a button that does
 * nothing on some phones — worse than a sentence, because it looks like it
 * worked.
 *
 * Matched on a lowercased manufacturer so a phone reporting "Xiaomi",
 * "xiaomi" or "POCO" all land on the same note.
 */
const OEM_NOTES: Array<{ match: string[]; note: string }> = [
  {
    match: ['samsung'],
    note: 'On Samsung, also check Settings → Battery → Background usage limits, and make sure Covault is not listed under Sleeping or Deep sleeping apps.',
  },
  {
    match: ['xiaomi', 'redmi', 'poco'],
    note: 'On Xiaomi, also turn on Autostart for Covault in Settings → Apps → Manage apps → Covault, and set its battery saver to No restrictions.',
  },
  {
    match: ['huawei', 'honor'],
    note: 'On Huawei, also open Settings → Battery → App launch, and set Covault to Manage manually with all three switches on.',
  },
  {
    match: ['oneplus', 'oppo', 'realme', 'vivo', 'iqoo'],
    note: 'On this phone, also check Settings → Battery → Background power usage (or App auto-launch) and let Covault run in the background.',
  },
];

export function oemBatteryNote(manufacturer: string | null | undefined): string | null {
  const name = (manufacturer || '').toLowerCase().trim();
  if (!name) return null;
  for (const entry of OEM_NOTES) {
    if (entry.match.some((m) => name.includes(m))) return entry.note;
  }
  return null;
}

/**
 * Whether to put this in front of somebody whose capture is already running.
 *
 * Three conditions, and the third is the one that keeps this from becoming
 * nagging. Capture has to be on — there is nothing to protect otherwise, and
 * the setup flow covers the case where it is being switched on now. Android
 * has to still be optimising. And the user must not already have been sent
 * there: this is a phone setting Covault cannot read the outcome of beyond the
 * exemption itself, so somebody who went and deliberately said no would
 * otherwise be asked again every time they opened Settings, for ever.
 */
export function shouldOfferBatteryExemption(opts: {
  captureEnabled: boolean;
  exempt: boolean;
  alreadyAsked: boolean;
}): boolean {
  return opts.captureEnabled && !opts.exempt && !opts.alreadyAsked;
}

// ── Remembering that we asked ────────────────────────────────────────────────
//
// Device-local, like every other flag in the setup flow: the trip out to
// Android's settings routinely outlives the WebView, so this is written on the
// way out and never on the way back.

const ASKED_KEY = 'covault_battery_exemption_asked_v1';

export function hasAskedBatteryExemption(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markBatteryExemptionAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* The card is shown once more. Nothing is lost but a repeat. */
  }
}
