// lib/captureChannel.ts
//
// Which route a captured purchase arrived by — the bank's own app, or an email
// from the bank — recorded on the row itself.
//
// Why this exists: once email is a capture source, most banks announce the same
// purchase twice, and the app has to drop one of them. Deciding WHICH to drop
// needs to know where each row came from, and nothing in the schema records
// that. `bankAppId` is carried all the way through the pipeline and then thrown
// away at the insert.
//
// Why it is a marker in the notification text and not a column. The obvious move
// is a `capture_channel` column, and it is the wrong one here. The transactions
// table's `source` column is CHECK-constrained to four values and is already
// read for meaning elsewhere (a row with source 'executor' is treated as
// recurring), so widening it changes behaviour beyond display. A NEW column
// means a migration, and a migration that has not been applied does not degrade
// gracefully — PostgREST rejects the whole insert on one unknown column, so
// every purchase would be lost until someone noticed. Against that, a marker in
// `raw_notification` needs no migration, cannot fail, and is exactly the trick
// lib/fuelHold.ts already uses for the same reason.
//
// The two markers coexist: they match on different names, each strips only its
// own, and neither contains a dollar figure, so fuelHold's amount scan is
// unaffected. Both are stripped wherever the raw text is shown to the user.

import type { CaptureSourceKind } from './captureSources';

const MARKER_RE = /\n?<!--\s*covault:capture\s+channel=(bank|email)(?:\s+pkg=([A-Za-z0-9._-]+))?\s*-->/;

export interface CaptureMarker {
  channel: CaptureSourceKind;
  /** The app the alert came from, when it was recorded. */
  packageName?: string;
}

/** Append the marker to a notification body, replacing any earlier one. */
export function withCaptureMarker(rawText: string, marker: CaptureMarker): string {
  const clean = stripCaptureMarker(rawText);
  const pkg = (marker.packageName || '').trim();
  const suffix = pkg ? ` pkg=${pkg}` : '';
  return `${clean}\n<!-- covault:capture channel=${marker.channel}${suffix} -->`;
}

/** Read the marker back, or null if the row does not carry one. */
export function readCaptureMarker(rawText: string | null | undefined): CaptureMarker | null {
  if (!rawText) return null;
  const m = MARKER_RE.exec(rawText);
  if (!m) return null;
  const channel = m[1] as CaptureSourceKind;
  return m[2] ? { channel, packageName: m[2] } : { channel };
}

/** The notification body without Covault's bookkeeping. */
export function stripCaptureMarker(rawText: string | null | undefined): string {
  return (rawText || '').replace(MARKER_RE, '');
}

/**
 * True when this stored row came from a bank's own app rather than an email.
 *
 * The unmarked case is the one that matters. Every row captured before this
 * feature existed has no marker, and every one of them came from a bank app —
 * email was not a source at all — so an unmarked automatic capture is treated as
 * bank-sourced. Getting this backwards would make the app ignore the entire
 * existing history when deciding whether an email is a duplicate, and quietly
 * file a second copy of purchases the user already has.
 *
 * A manually entered row is not a capture and answers false: an email that
 * matches something the user typed in themselves is still a duplicate, but it is
 * handled by the ordinary duplicate rules, not by this one.
 */
export function isBankSourcedRow(row: {
  raw_notification?: string | null;
  source?: string | null;
}): boolean {
  const marker = readCaptureMarker(row.raw_notification);
  if (marker) return marker.channel === 'bank';
  return row.source === 'notification';
}

/** True when this stored row was captured from an email. */
export function isEmailSourcedRow(row: { raw_notification?: string | null }): boolean {
  return readCaptureMarker(row.raw_notification)?.channel === 'email';
}

// ── Pairing a bank row with the email that repeated it ───────────────────────
//
// When an email is dropped because a bank app already reported the same
// purchase, the bank's row is marked as having absorbed one. Without that mark,
// a SECOND genuine purchase at the same merchant for the same amount inside the
// three-day window would defer to the very same row and vanish.
//
// That is not hypothetical: it is the trap lib/projectedTransactions.ts already
// hit with two Fizz charges a month, three days apart, where a single unpaired
// sweep let the first cancel both. The rule there and here is the same — one
// real charge cancels at most ONE lookalike.
//
// Losing this mark is survivable and self-correcting: the worst case is the old
// behaviour, where one bank row could absorb two emails. Which is why the write
// that sets it is allowed to fail without failing the capture.

const PAIRED_RE = /\n?<!--\s*covault:email-paired\s*-->/;

/** Mark a bank-sourced row as having already absorbed a matching email. */
export function withEmailPairedMarker(rawText: string | null | undefined): string {
  const clean = stripEmailPairedMarker(rawText);
  return `${clean}\n<!-- covault:email-paired -->`;
}

/** True when this row has already cancelled an email copy of itself. */
export function hasPairedEmail(rawText: string | null | undefined): boolean {
  return PAIRED_RE.test(rawText || '');
}

/** The notification body without the pairing mark. */
export function stripEmailPairedMarker(rawText: string | null | undefined): string {
  return (rawText || '').replace(PAIRED_RE, '');
}

/** Every piece of Covault bookkeeping removed, for showing the text to a user. */
export function stripCaptureBookkeeping(rawText: string | null | undefined): string {
  return stripEmailPairedMarker(stripCaptureMarker(rawText));
}
