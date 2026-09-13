// lib/captureHealth.ts
//
// "Is capture actually working?", answered from the phone rather than guessed.
//
// When a purchase does not appear, the app currently tells the user nothing.
// They cannot tell a bank that has gone quiet from notification access being
// revoked from a rule they wrote a month ago, and the honest answer — "one of
// about five things" — is not something anybody should have to hold in their
// head. Every one of those five things is already observable on the device;
// nothing here is new information, it is information that was scattered.
//
// Pure on purpose. The card reads the phone and hands the answers in; the
// verdict, the wording and the ordering are decided here, where they can be
// tested without one.

import type { CaptureOutcome, CaptureOutcomeCode } from './captureOutcome';

/** Everything the card needs to know, gathered by its caller. */
export interface CaptureHealthInput {
  /** The user's own capture switch. */
  captureEnabled: boolean;
  /** Android's "notification access" for Covault. Without it nothing arrives. */
  listenerGranted: boolean;
  /** Covault's own permission to POST. Without it captures are silent. */
  canPostNotifications: boolean;
  /** How many apps the user has chosen to watch. */
  monitoredCount: number;
  /** Bank package → when it last reached us, epoch millis. */
  lastSeen: Record<string, number>;
  /** Banks that have said nothing for long enough to be worth raising. */
  silent: readonly string[];
  /** What happened to the last few alerts, newest first. */
  outcomes: readonly CaptureOutcome[];
  now?: number;
}

export type HealthLevel = 'ok' | 'attention' | 'off';

export interface HealthCheck {
  key: 'access' | 'notifications' | 'sources' | 'heard';
  label: string;
  ok: boolean;
  /** One line, in consequences. Shown whether the check passed or not. */
  detail: string;
  /** Which screen fixes it, when something can. */
  fix?: 'access' | 'notifications' | 'sources';
}

export interface CaptureHealth {
  level: HealthLevel;
  headline: string;
  checks: HealthCheck[];
  /** Alerts that produced no purchase, newest first, each with its reason. */
  uncaptured: Array<{ entry: CaptureOutcome; reason: string; fault: boolean }>;
}

/**
 * Why an alert produced no purchase — or null when it did.
 *
 * Deliberately NOT `isCaptureProblem` from captureOutcome.ts, which answers a
 * different question: whether TRAY SUPPRESSION is misbehaving. An alert can be
 * captured perfectly and still not be hidden ("toggle_off"), and an alert can
 * be read and deliberately discarded while suppression works fine
 * ("no_amount", "income"). Asking one predicate both questions is how a user
 * gets sent hunting a problem they do not have — or told nothing about the one
 * they do.
 */
export function uncapturedReason(outcome: CaptureOutcomeCode): string | null {
  switch (outcome) {
    case 'no_amount':
      return 'No amount could be read from it.';
    case 'user_ignored':
      return 'A skip pattern you wrote matched it.';
    case 'known_recurring':
      return 'Already on your books as a recurring charge.';
    case 'not_a_purchase':
      return 'Reads as a price alert or an ad, not a purchase.';
    case 'income':
      return 'Reads as money coming in. Covault tracks spending.';
    case 'failed_charge':
      return "Your bank said the charge didn't go through.";
    case 'not_spending':
      return 'Reads as a balance, statement or payment notice.';
    case 'not_saved':
      return 'Covault could not save it to this phone.';
    // The rest are alerts that WERE captured; only the tidying of the bank's
    // own notification varied, which is a different screen's question.
    default:
      return null;
  }
}

/**
 * Whether the reason is Covault failing rather than Covault deciding.
 *
 * Only one of them is: everything else on that list is the app doing its job —
 * refusing a deposit, honouring a skip rule, declining an ad. Marking those as
 * faults would make a healthy install look broken.
 */
function isFault(outcome: CaptureOutcomeCode): boolean {
  return outcome === 'not_saved';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "3 min ago". Deliberately coarse: the difference between 41 and 43 minutes
 * is not a thing anybody is deciding anything on, and a ticking figure invites
 * re-reading a card that should be glanced at.
 */
export function agoLabel(then: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - then);
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min ago`;
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    return hours === 1 ? '1 hr ago' : `${hours} hrs ago`;
  }
  const days = Math.floor(delta / DAY);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The banks that have reached us, most recent first. */
export function heardFrom(
  lastSeen: Record<string, number>,
): Array<{ app: string; at: number }> {
  return Object.entries(lastSeen || {})
    .filter(([app, at]) => !!app && Number.isFinite(at) && at > 0)
    .map(([app, at]) => ({ app, at }))
    .sort((a, b) => b.at - a.at);
}

/**
 * The verdict, and the four things it is made of.
 *
 * Ordered by how completely each one breaks capture, which is also the order
 * to fix them in: nothing arrives at all without notification access; without
 * permission to post, captures happen but silently and bank alerts stop being
 * tidied away; with no sources chosen nothing is read; and a bank that has
 * gone quiet is the case where everything is configured and one bank stopped
 * talking.
 */
export function captureHealth(input: CaptureHealthInput): CaptureHealth {
  const now = input.now ?? Date.now();
  const heard = heardFrom(input.lastSeen);
  const uncaptured = (input.outcomes || [])
    .map((entry) => {
      const reason = uncapturedReason(entry.outcome);
      return reason ? { entry, reason, fault: isFault(entry.outcome) } : null;
    })
    .filter((row): row is { entry: CaptureOutcome; reason: string; fault: boolean } => row !== null);

  const checks: HealthCheck[] = [
    {
      key: 'access',
      label: 'Notification access',
      ok: input.listenerGranted,
      detail: input.listenerGranted
        ? 'Covault can see your bank alerts.'
        : 'Off — no purchase can be captured at all until this is on.',
      fix: input.listenerGranted ? undefined : 'access',
    },
    {
      key: 'notifications',
      label: 'Covault notifications',
      ok: input.canPostNotifications,
      detail: input.canPostNotifications
        ? 'Captures are announced, and bank alerts are tidied away.'
        : 'Off — purchases are still captured, but silently, and bank alerts stay in your tray.',
      fix: input.canPostNotifications ? undefined : 'notifications',
    },
    {
      key: 'sources',
      label: 'Apps being watched',
      ok: input.monitoredCount > 0,
      detail: input.monitoredCount > 0
        ? `${input.monitoredCount} ${input.monitoredCount === 1 ? 'app' : 'apps'} chosen.`
        : 'None chosen — alerts arrive and are thrown away.',
      fix: input.monitoredCount > 0 ? undefined : 'sources',
    },
    {
      key: 'heard',
      label: 'Last alert',
      ok: heard.length > 0 && input.silent.length === 0,
      detail: heard.length === 0
        ? 'Nothing has reached Covault yet.'
        : input.silent.length > 0
          ? `${input.silent.length} ${input.silent.length === 1 ? 'bank has' : 'banks have'} been quiet for over a week.`
          : `Most recent was ${agoLabel(heard[0].at, now)}.`,
      // Nothing to press. A bank goes quiet because of ITS notification
      // settings, which Covault cannot read or change — see bankHeartbeat.ts.
      fix: undefined,
    },
  ];

  if (!input.captureEnabled) {
    return {
      level: 'off',
      headline: 'Capture is switched off',
      checks,
      uncaptured,
    };
  }

  const broken = checks.filter((check) => !check.ok);
  if (broken.length > 0) {
    return {
      // One word for the worst of them, because the card is glanced at before
      // it is read.
      level: 'attention',
      headline: broken[0].fix ? `${broken[0].label} needs a look` : broken[0].detail,
      checks,
      uncaptured,
    };
  }

  return {
    level: 'ok',
    headline: heard.length > 0
      ? `Working — last alert ${agoLabel(heard[0].at, now)}`
      : 'Working — waiting for your first alert',
    checks,
    uncaptured,
  };
}
