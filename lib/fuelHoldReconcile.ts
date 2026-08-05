// lib/fuelHoldReconcile.ts
//
// Pairing a settled fuel charge with the hold it replaces.
//
// When a bank DOES send the second notification — the real amount, days after
// the round authorisation — Covault captures it as a brand new row. The user
// then has two entries for one tank: a $100 placeholder and a $71.43 charge,
// and the month is overstated by the placeholder.
//
// This module recognises that pair. It does not merge them. It cannot: two
// separate fills at the same station in the same week look identical to a hold
// and its settlement, and there is no field in either notification that
// distinguishes them. So the most it does is nominate a candidate, and the UI
// asks. "Is this the real amount for that hold?" is a question the user can
// answer instantly and Covault cannot answer at all.

import type { Transaction } from '../types';
import { detectFuelHoldPlaceholder, isFuelMerchant, isHoldAmount } from './fuelHold';

/**
 * How long after a hold a settlement can still arrive.
 *
 * Card networks settle fuel in one to three business days; a long weekend
 * stretches that. Seven days covers the realistic tail. Going wider mostly buys
 * false pairings with the following week's fill.
 */
const SETTLEMENT_WINDOW_DAYS = 7;

export interface SettlementCandidate {
  /** The placeholder row this charge probably settles. */
  placeholder: Transaction;
  /** The round figure the bank originally held. */
  holdAmount: number;
  /** What the placeholder is currently carrying. */
  placeholderAmount: number;
  /** Days between the hold and this charge. */
  daysApart: number;
}

function dayNumber(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const iso = typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Loose station-name comparison, tolerant of store numbers and punctuation. */
function sameStation(a: string, b: string): boolean {
  const norm = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * Find the hold this charge most likely settles, or null.
 *
 * `charge` must be a real settled amount — a non-round figure at a station.
 * A round one is another hold, not a settlement, and pairing two holds would
 * turn a genuine second fill into a correction of the first.
 *
 * When several placeholders qualify, the nearest in time wins: a settlement
 * belongs to the fill it followed, and the most recent unresolved hold is the
 * one most likely still waiting for its number.
 */
export function findSettlementCandidate(
  charge: Transaction,
  transactions: Transaction[],
): SettlementCandidate | null {
  const amount = Number(charge.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (isHoldAmount(amount)) return null;
  if (!isFuelMerchant(`${charge.vendor || ''} ${charge.raw_notification || ''}`)) return null;

  const chargeDay = dayNumber(charge.date);
  if (chargeDay == null) return null;

  let best: SettlementCandidate | null = null;

  for (const tx of transactions) {
    if (tx.id === charge.id) continue;
    if (!sameStation(String(tx.vendor || ''), String(charge.vendor || ''))) continue;

    const hold = detectFuelHoldPlaceholder(tx);
    if (!hold) continue;

    const holdDay = dayNumber(tx.date);
    if (holdDay == null) continue;

    // The settlement follows the hold. Same day counts — a fill in the morning
    // can settle by the evening.
    const daysApart = chargeDay - holdDay;
    if (daysApart < 0 || daysApart > SETTLEMENT_WINDOW_DAYS) continue;

    // A settlement cannot exceed what was authorised. If it does, this is a
    // separate, larger purchase.
    if (amount > hold.holdAmount + 0.005) continue;

    if (!best || daysApart < best.daysApart) {
      best = {
        placeholder: tx,
        holdAmount: hold.holdAmount,
        placeholderAmount: hold.placeholderAmount,
        daysApart,
      };
    }
  }

  return best;
}
