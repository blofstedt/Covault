// lib/missedAlertReport.ts
//
// Turning "nothing happened" into something that can be fixed.
//
// A miscategorised purchase leaves a row to look at; a purchase captured
// wrongly leaves a row to look at. A purchase the parser never recognised at
// all leaves nothing — no row, no notification, no trace anywhere in the
// app — because it never became a capture in the first place. On a stranger's
// bank, whose alerts were never seen while this app was written, that silence
// is the single biggest risk to whether Covault actually works for them: the
// only way to learn it happened is for the user to say so.
//
// This builds the report rather than collecting it. Sending it is the same
// mailto route "Report a Problem" already uses — no new backend, no new
// account to check, the developer's inbox is already where these go — but
// the body is seeded with real diagnostic context instead of a blank page,
// because a user describing a missed purchase from memory a day later is
// exactly the report that is hardest to act on.
//
// What is deliberately NOT included: any transaction amount, vendor, or the
// text of any bank alert. Everything gathered here describes the app's own
// configuration and recent behaviour, never the user's spending — the same
// line lib/errorReporting.ts draws, for the same reason.

import type { CaptureOutcome } from './captureOutcome';
import { describeCaptureOutcome } from './captureOutcome';

export const MISSED_ALERT_SUBJECT = 'Covault: Missed Purchase';

export const MISSED_ALERT_EMAIL = 'itsjustmyemail@gmail.com';

/** What the report needs gathered before it can be built. */
export interface MissedAlertContext {
  /** Covault's own capture switch. */
  captureEnabled: boolean;
  /** Human-readable names of the banking/mail apps Covault is watching. */
  monitoredBankNames: string[];
  /** The last few capture outcomes, newest first. */
  recentOutcomes: CaptureOutcome[];
  /** Android versionCode, or null off-device / on web. */
  versionCode: number | null;
}

/** How many recent outcomes are worth including. More is noise, not signal. */
const MAX_OUTCOMES_SHOWN = 5;

function formatWhen(atMillis: number): string {
  if (!atMillis) return 'unknown time';
  try {
    return new Date(atMillis).toLocaleString();
  } catch {
    return 'unknown time';
  }
}

/**
 * The pre-filled body. Written as a template FOR the user to finish, not a
 * finished report: the one fact only they have — what the alert actually
 * said — has to be typed or pasted by them, in their own mail app, before
 * they hit send.
 */
export function buildMissedAlertBody(context: MissedAlertContext): string {
  const lines: string[] = [
    "Paste or describe the bank alert that didn't get captured below this line:",
    '——————————————————————',
    '',
    '',
    '——————————————————————',
    '',
    "Everything below is filled in automatically and describes Covault's own settings — none of it is your spending.",
    '',
    `Capture switched on: ${context.captureEnabled ? 'yes' : 'no'}`,
    `App build: ${context.versionCode ?? 'unknown (web)'}`,
    '',
    context.monitoredBankNames.length > 0
      ? `Watching: ${context.monitoredBankNames.join(', ')}`
      : 'Watching: nothing selected',
  ];

  const shown = context.recentOutcomes.slice(0, MAX_OUTCOMES_SHOWN);
  if (shown.length > 0) {
    lines.push('', 'Most recent capture activity:');
    for (const entry of shown) {
      const amount = entry.amount === null ? 'no amount read' : `$${entry.amount.toFixed(2)}`;
      lines.push(`  ${formatWhen(entry.at)} — ${amount} — ${describeCaptureOutcome(entry.outcome)}`);
    }
  } else {
    lines.push('', 'Most recent capture activity: nothing recorded yet on this phone.');
  }

  return lines.join('\n');
}

/** The mailto: URL, ready to hand to `window.location.href` or an `<a>`. */
export function buildMissedAlertReportUrl(context: MissedAlertContext): string {
  const subject = encodeURIComponent(MISSED_ALERT_SUBJECT);
  const body = encodeURIComponent(buildMissedAlertBody(context));
  return `mailto:${MISSED_ALERT_EMAIL}?subject=${subject}&body=${body}`;
}
