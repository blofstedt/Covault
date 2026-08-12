import { getBankingApps } from './bankingApps';

/**
 * What happened to a bank alert after Covault captured the purchase from it.
 *
 * Tray suppression has several ways to decline, and in the tray they are
 * indistinguishable — the alert simply stays. The native listener writes down
 * which one it was for each alert; this turns that into something the user can
 * read, so "it still isn't hiding them" is answered by looking at the screen
 * rather than by shipping a release per guess.
 */
export type CaptureOutcomeCode =
  | 'hidden'
  | 'blocked'
  | 'not_saved'
  | 'toggle_off'
  | 'no_amount'
  | 'not_clearable'
  | 'cancel_ignored'
  | 'user_ignored';

const OUTCOME_CODES: readonly CaptureOutcomeCode[] = [
  'hidden',
  'blocked',
  'not_saved',
  'toggle_off',
  'no_amount',
  'not_clearable',
  'cancel_ignored',
  'user_ignored',
];

export interface CaptureOutcome {
  /** When the decision was made, epoch millis. */
  at: number;
  /** Android package of the bank app. */
  app: string;
  /** Amount the native regex read, or null if it found none. */
  amount: number | null;
  outcome: CaptureOutcomeCode;
}

/**
 * Parse what the native side handed over, dropping anything malformed.
 *
 * Deliberately forgiving: this is a diagnostic, and a diagnostic that throws
 * takes down the settings screen it was meant to explain. Newest first, which
 * is the order it is read in — the native side appends.
 */
export function parseCaptureOutcomes(raw: unknown): CaptureOutcome[] {
  let rows: unknown;
  if (typeof raw === 'string') {
    try {
      rows = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    rows = raw;
  }
  if (!Array.isArray(rows)) return [];

  const out: CaptureOutcome[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;
    const outcome = entry.outcome;
    if (typeof outcome !== 'string') continue;
    if (!OUTCOME_CODES.includes(outcome as CaptureOutcomeCode)) continue;
    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0;
    const amount =
      typeof entry.amount === 'number' && Number.isFinite(entry.amount) ? entry.amount : null;
    out.push({
      at,
      app: typeof entry.app === 'string' ? entry.app : '',
      amount,
      outcome: outcome as CaptureOutcomeCode,
    });
  }
  return out.reverse();
}

/**
 * Whether this outcome is something the user can do anything about.
 *
 * `hidden` is the feature working. `toggle_off` is the user's own choice, not
 * a fault. `no_amount` means the alert probably wasn't a purchase at all —
 * a balance warning, a login alert — and hiding those was never the intent.
 * The rest are worth surfacing.
 */
export function isCaptureProblem(outcome: CaptureOutcomeCode): boolean {
  return (
    outcome !== 'hidden' &&
    outcome !== 'toggle_off' &&
    outcome !== 'no_amount' &&
    outcome !== 'user_ignored'
  );
}

/** One line saying what happened, in the user's terms. */
export function describeCaptureOutcome(outcome: CaptureOutcomeCode): string {
  switch (outcome) {
    case 'hidden':
      return 'Hidden after capture';
    case 'blocked':
      return "Kept — Android is blocking Covault's own notification";
    case 'not_saved':
      return "Kept — the purchase couldn't be saved to this phone";
    case 'toggle_off':
      return 'Kept — hiding is switched off';
    case 'no_amount':
      return "Kept — no amount in it, so it may not be a purchase";
    case 'not_clearable':
      return "Kept — your bank marked this alert as one that can't be dismissed";
    case 'cancel_ignored':
      return 'Kept — Android refused to dismiss it';
    case 'user_ignored':
      return "Kept — you told Covault to ignore alerts like this one";
  }
}

/**
 * Short label for one row in the recent-alerts list.
 *
 * The list answers "which of these got hidden", so the label is the verdict,
 * not the explanation — the explanation is the headline above it.
 */
export function captureOutcomeLabel(outcome: CaptureOutcomeCode): string {
  return outcome === 'hidden' ? 'Hidden' : 'Kept';
}

/**
 * Headline for the warning: what is happening now, in the present tense.
 *
 * Separate from describeCaptureOutcome, which reports one past decision. A
 * banner saying "Kept — Android refused to dismiss it" reads as a single
 * incident; the user needs to know it is the current state of the feature.
 */
export function captureProblemHeadline(outcome: CaptureOutcomeCode): string {
  switch (outcome) {
    case 'blocked':
      return "Android is blocking Covault's notifications";
    case 'not_saved':
      return "Purchases aren't being saved to this phone";
    case 'not_clearable':
      return 'Your bank is pinning its alerts';
    case 'cancel_ignored':
      return 'Android is refusing to clear bank alerts';
    default:
      return "Alerts aren't being hidden";
  }
}

/**
 * What to do about it, or null when there is nothing the user can do.
 *
 * `cancel_ignored` is the one with no fix from inside the app: Covault asked
 * twice and the system declined, which is a restriction on the phone rather
 * than anything Covault controls. Saying so is better than implying a setting
 * exists that would help.
 */
export function captureOutcomeAdvice(outcome: CaptureOutcomeCode): string | null {
  switch (outcome) {
    case 'blocked':
      return "Allow Covault to post notifications — it only clears a bank alert once it has put its own in its place.";
    case 'not_saved':
      return 'Free up some storage on your phone and try another purchase.';
    case 'not_clearable':
      return 'Nothing to change here — this one is your bank pinning its alert.';
    case 'cancel_ignored':
      return "Your phone is stopping Covault from clearing other apps' notifications. Some Android skins restrict this separately from notification access.";
    default:
      return null;
  }
}

/** Bank name for a package, falling back to the package itself. */
export function captureOutcomeAppName(app: string): string {
  if (!app) return 'A bank app';
  return getBankingApps()[app] || app;
}
