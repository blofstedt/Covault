// lib/pendingHold.ts
//
// The hold that may or may not have become a purchase.
//
// A hotel, a car rental or a pay-at-pump station reserves a figure it chose,
// and the real charge lands days later — or, for fuel, often never. Covault
// refuses to record the held figure, and it is right to: the held number is
// almost never what was spent, and writing it down puts a wrong amount in
// somebody's budget where they will never think to question it.
//
// But refusing silently loses the other case. If the charge settles and the
// bank sends nothing the second time, that purchase is simply gone, and the
// user finds out weeks later when the month does not add up.
//
// So the hold is remembered rather than recorded. If a real charge from that
// merchant lands within the week, the hold was the same money and is forgotten.
// If nothing lands, the app asks one question — "did this ever go through?" —
// which is the only honest move: the right amount is unknowable and the wrong
// amount is guaranteed.
//
// Device-local on purpose. A hold is a week-long guess about one phone's
// notifications, not a fact about the household's money, and it never becomes
// a row unless the user says so.

import { fuzzyVendorMatch } from './formatVendorName';
import { log } from './log';

const STORAGE_KEY = 'covault_pending_holds';

/** How long a settling charge has to arrive before the hold is worth asking about. */
export const HOLD_SETTLE_DAYS = 7;

/**
 * Below this, a hold is not worth a question.
 *
 * A pump's $1 card check and a hotel's $1 test are holds in exactly the same
 * sense and mean nothing. Asking about them would train the user to dismiss
 * the prompt without reading it, which is how the $340 one gets dismissed too.
 */
export const MIN_HOLD_TO_ASK = 25;

/** How many are kept. A phone that has not been opened in a month has bigger problems. */
const MAX_HOLDS = 20;

export interface PendingHold {
  /** Stable id, so a dismissal can name one. */
  id: string;
  vendor: string;
  /** What the bank said it was holding. NEVER written to a transaction. */
  amount: number;
  /** When the hold was seen, epoch millis. */
  at: number;
}

const MS_PER_DAY = 86_400_000;

function read(): PendingHold[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is PendingHold =>
      !!row && typeof row === 'object'
      && typeof row.id === 'string'
      && typeof row.vendor === 'string'
      && typeof row.amount === 'number' && Number.isFinite(row.amount)
      && typeof row.at === 'number' && Number.isFinite(row.at));
  } catch {
    // Storage can be unavailable or hold something another version wrote.
    // An unreadable list is an empty one: this feature asking nothing is a
    // great deal better than it throwing on a screen it was meant to help.
    return [];
  }
}

function write(holds: PendingHold[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holds.slice(0, MAX_HOLDS)));
  } catch (e) {
    log.debug('[pendingHold] could not store', e);
  }
}

export function readHolds(): PendingHold[] {
  return read();
}

/**
 * Remember a hold the parser has just refused.
 *
 * Ignores the small ones, and ignores a second copy of a hold already
 * remembered — a bank and a wallet both announce the same tap, and two
 * questions about one hold is one question too many.
 */
export function rememberHold(
  vendor: string,
  amount: number,
  now: number = Date.now(),
): PendingHold | null {
  const name = (vendor || '').trim();
  const value = Math.abs(Number(amount) || 0);
  if (!name || value < MIN_HOLD_TO_ASK) return null;

  const holds = read();
  const already = holds.some((held) =>
    Math.abs(held.amount - value) < 0.01
    && fuzzyVendorMatch(held.vendor, name)
    && Math.abs(held.at - now) < MS_PER_DAY);
  if (already) return null;

  const hold: PendingHold = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    vendor: name,
    amount: value,
    at: now,
  };
  write([hold, ...holds]);
  return hold;
}

/**
 * A real charge has landed. Forget any hold it settles.
 *
 * Matched on the merchant and the week, never on the amount: a hold whose
 * amount matched the charge would be a coincidence, since the whole point of a
 * hold is that its figure is the one the station picked rather than the one
 * that was spent.
 *
 * At most one hold is cleared, closest first, for the same reason a real
 * charge cancels at most one projected recurring occurrence: two stays at the
 * same hotel in one week are two purchases, and letting one charge clear both
 * holds loses the question about the second.
 */
export function settleHold(
  vendor: string,
  chargedAt: number = Date.now(),
): PendingHold | null {
  const name = (vendor || '').trim();
  if (!name) return null;
  const holds = read();
  const window = HOLD_SETTLE_DAYS * MS_PER_DAY;

  let best: PendingHold | null = null;
  for (const held of holds) {
    if (!fuzzyVendorMatch(held.vendor, name)) continue;
    const gap = chargedAt - held.at;
    // A charge before its own hold is not a settlement of it.
    if (gap < -MS_PER_DAY || gap > window) continue;
    if (!best || held.at > best.at) best = held;
  }
  if (!best) return null;
  write(holds.filter((held) => held.id !== best!.id));
  return best;
}

/** Stop asking about one, whatever the answer was. */
export function forgetHold(id: string): void {
  write(read().filter((held) => held.id !== id));
}

/**
 * The holds worth asking about: old enough that a settling charge should have
 * arrived, and not so old that the question is archaeology.
 *
 * Oldest first — the one that has been waiting longest is the one most likely
 * to have been forgotten.
 */
export function holdsToAsk(now: number = Date.now()): PendingHold[] {
  const window = HOLD_SETTLE_DAYS * MS_PER_DAY;
  return read()
    .filter((held) => now - held.at >= window && now - held.at < window * 4)
    .sort((a, b) => a.at - b.at);
}

/** Drop anything too old to be worth a question, so the list cannot grow stale. */
export function pruneHolds(now: number = Date.now()): void {
  const limit = HOLD_SETTLE_DAYS * MS_PER_DAY * 4;
  const holds = read();
  const kept = holds.filter((held) => now - held.at < limit);
  if (kept.length !== holds.length) write(kept);
}
