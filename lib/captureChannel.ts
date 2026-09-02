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

const MARKER_RE = /\n?<!--\s*covault:capture\s+channel=(bank|email)(?:\s+pkg=([A-Za-z0-9._-]+))?(?:\s+ts=(\d+))?\s*-->/;

export interface CaptureMarker {
  channel: CaptureSourceKind;
  /** The app the alert came from, when it was recorded. */
  packageName?: string;
  /**
   * When the notification was POSTED, not when the row was written.
   *
   * The distinction matters: two apps announcing one tap do so within seconds of
   * each other, but if the phone was asleep both alerts sit in the native queue
   * and are written minutes or hours later, milliseconds apart. Insert time
   * would say they were simultaneous; post time says how far apart the two
   * announcements really were, which is what the cross-app rule needs.
   */
  notifiedAt?: number;
}

/** Append the marker to a notification body, replacing any earlier one. */
export function withCaptureMarker(rawText: string, marker: CaptureMarker): string {
  const clean = stripCaptureMarker(rawText);
  const pkg = (marker.packageName || '').trim();
  const parts = [`channel=${marker.channel}`];
  if (pkg) parts.push(`pkg=${pkg}`);
  if (Number.isFinite(marker.notifiedAt) && (marker.notifiedAt as number) > 0) {
    parts.push(`ts=${Math.floor(marker.notifiedAt as number)}`);
  }
  return `${clean}\n<!-- covault:capture ${parts.join(' ')} -->`;
}

/** Read the marker back, or null if the row does not carry one. */
export function readCaptureMarker(rawText: string | null | undefined): CaptureMarker | null {
  if (!rawText) return null;
  const m = MARKER_RE.exec(rawText);
  if (!m) return null;
  const marker: CaptureMarker = { channel: m[1] as CaptureSourceKind };
  if (m[2]) marker.packageName = m[2];
  if (m[3]) {
    const ts = Number(m[3]);
    if (Number.isFinite(ts) && ts > 0) marker.notifiedAt = ts;
  }
  return marker;
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

// ── Two apps, one tap ────────────────────────────────────────────────────────
//
// A wallet and the card's own bank app both announce the same tap-to-pay
// purchase, in different words, within seconds of each other. So do some banks
// that run a separate card app alongside their banking one.
//
// Google Wallet used to be refused outright because of this. The reason that
// was necessary is worth keeping in view: the earlier attempt collapsed the two
// by comparing MERCHANT NAMES, and one of the two routinely parses the merchant
// badly — a wallet often has only "Google Wallet" or a terminal id to work from.
// Matching on the name therefore failed exactly when it was needed.
//
// This matches on what both sides always get right instead: the AMOUNT, and how
// far apart the two announcements were. Nothing about the merchant is consulted.
//
// The window is deliberately small. Two apps describing one tap are seconds
// apart; two different purchases that happen to cost the same, reported by two
// different apps, inside five minutes is a coincidence nobody has. Widening this
// is how you start eating real purchases — the email rule, which has to reach
// across a day or more, is a separate mechanism for that reason.

/** How far apart two apps' reports of the same tap can be. */
export const CROSS_APP_WINDOW_MS = 5 * 60 * 1000;

/**
 * When this row's alert was posted, as best we can tell.
 *
 * Prefers the post time recorded in the marker; falls back to when the row was
 * written, which is close enough for a live capture and is all a row from before
 * markers existed has.
 */
export function captureNotifiedAt(row: {
  raw_notification?: string | null;
  created_at?: string | null;
}): number | null {
  const marked = readCaptureMarker(row.raw_notification)?.notifiedAt;
  if (marked) return marked;
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  return Number.isFinite(created) ? created : null;
}

/**
 * True when an existing row is a DIFFERENT app's report of the same tap.
 *
 * Requires the apps to be known and different. An unmarked row — anything
 * captured before this existed — is never claimed, because there is no way to
 * tell whether it came from this same app, and guessing would let an ordinary
 * re-broadcast silently swallow a real second purchase.
 */
export function isOtherAppSameTap(
  row: { raw_notification?: string | null; created_at?: string | null; amount?: number | null },
  incoming: { packageName: string; amount: number; notifiedAt: number },
  amountsAgree: (a: number, b: number) => boolean,
): boolean {
  const marker = readCaptureMarker(row.raw_notification);
  if (!marker?.packageName) return false;
  if (marker.packageName === incoming.packageName) return false;

  const rowAmount = Number(row.amount);
  if (!Number.isFinite(rowAmount) || !amountsAgree(rowAmount, incoming.amount)) return false;

  const rowAt = captureNotifiedAt(row);
  if (rowAt == null || !Number.isFinite(incoming.notifiedAt)) return false;
  return Math.abs(rowAt - incoming.notifiedAt) <= CROSS_APP_WINDOW_MS;
}
