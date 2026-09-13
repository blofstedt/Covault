// lib/serverClock.ts
//
// What time it is according to the database, rather than according to the
// phone.
//
// The trial is "you have until this date", and the app was deciding that with
// `Date.now()` — the device clock, which the person being charged controls.
// Winding the phone back a month extends the trial indefinitely, and nothing
// downstream would ever notice.
//
// The fix is not to ask the server for a verdict on every render; it is to
// stop trusting the phone's idea of NOW. One round trip at load time gives the
// database's clock, and the difference between that and the phone's is carried
// as an offset. Every entitlement question then asks `serverNow()` instead.
//
// What this does and does not buy:
//   - It does fix the clock. A phone set back a month reads the same instant
//     the database does, so the trial ends when it ends.
//   - It does NOT make the server authoritative about whether someone has
//     PAID. That needs Play Billing and a verified purchase record; until
//     then `subscription_status` is still a column the client reads.
//
// Deliberately fails open. If the sync never lands — no network, an old
// database without the function — the offset stays zero and the app behaves
// exactly as it did before. A paying household locked out of its own budget
// because a round trip failed is a far worse outcome than a trial running
// long, and the honest reading of "I could not ask" is not "you must be
// cheating".

import { callRpc } from './apiHelpers';
import { log } from './log';

let offsetMs = 0;
let synced = false;

/** The current time as the database sees it, in ms since the epoch. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Whether the offset came from the server or is still the zero default. */
export function serverClockSynced(): boolean {
  return synced;
}

/**
 * Ask the database what time it is and remember the difference.
 *
 * Safe to call repeatedly — the entitlement question is asked on every render
 * and this is not. It is called once per data load, alongside the settings
 * read that supplies the trial date itself.
 */
export async function syncServerClock(): Promise<void> {
  // Measured around the call so the round trip is not counted as clock drift.
  // The answer describes an instant somewhere inside the request, so the
  // midpoint is the closest honest guess at which local instant it matched.
  const sentAt = Date.now();
  const result = await callRpc<string>('server_now', {});
  if (!result.ok || !result.data) {
    log.debug('[serverClock] no server time; keeping the local clock');
    return;
  }
  const serverMs = new Date(result.data).getTime();
  if (!Number.isFinite(serverMs)) return;

  const receivedAt = Date.now();
  const midpoint = sentAt + (receivedAt - sentAt) / 2;
  offsetMs = serverMs - midpoint;
  synced = true;
  log.debug('[serverClock] offset', Math.round(offsetMs / 1000), 's');
}

/** Test seam. Resets to "never synced", which is the fail-open default. */
export function resetServerClock(): void {
  offsetMs = 0;
  synced = false;
}
