// lib/captureNotificationMarker.ts
//
// Which Android notification announced this row, recorded on the row itself.
//
// The listener posts "$X at Y — captured" before anything has classified the
// alert, and the id it posts under is handed to the web layer as
// `capture_notification_id` — but only for the few seconds between the
// capture arriving and the pipeline finishing. Nothing kept it past that
// moment, so once the transaction had been inserted there was no way to find
// its notification again. A user who accepted, edited, or deleted a captured
// row from inside the app left its "captured — tap to review" notice sitting
// in the tray regardless, pointing at something that no longer needed
// looking at.
//
// A marker in `raw_notification` rather than a new column, for exactly the
// reason lib/captureChannel.ts already gives for the same choice: no
// migration, cannot fail an insert, degrades to "nothing to clear" on any row
// that predates this or that failed to carry one. The two coexist — this
// marker never contains a dollar figure, so it cannot confuse fuelHold's
// amount scan, and it is stripped by stripCaptureBookkeeping alongside the
// others wherever raw text reaches a user.

const MARKER_RE = /\n?<!--\s*covault:notif-id\s+(-?\d+)\s*-->/;

/** Append the marker, replacing any earlier one on this text. */
export function withCaptureNotificationMarker(
  rawText: string | null | undefined,
  notificationId: number,
): string {
  const clean = stripCaptureNotificationMarker(rawText);
  return `${clean}\n<!-- covault:notif-id ${Math.trunc(notificationId)} -->`;
}

/** Read the marker back, or null if this row carries none. */
export function readCaptureNotificationMarker(rawText: string | null | undefined): number | null {
  if (!rawText) return null;
  const m = MARKER_RE.exec(rawText);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}

/** The notification body without this marker. */
export function stripCaptureNotificationMarker(rawText: string | null | undefined): string {
  return (rawText || '').replace(MARKER_RE, '');
}
