import { fuzzyVendorMatch } from './formatVendorName';

/**
 * "Is this the same charge as that one?" — for the case where the two records
 * came from different places and do not agree on the vendor's name.
 *
 * The capture pipeline has always matched vendors fuzzily, because a bank
 * writes "GOOGLE *GOOGLE ONE" where a person writes "Google". The recurring
 * executor did not: it keyed on the exact lowercased vendor string and the
 * exact day. So a monthly "Google" template and a captured "Google One" for
 * the same $2.93 on the same day were, to it, two different charges — and it
 * posted the second one on top of the first.
 *
 * Three things have to agree, and all three are deliberately loose in
 * different directions:
 *
 *  - **The amount, almost exactly.** This is the anchor. Two charges from the
 *    same merchant to the cent, days apart, are far more likely to be one
 *    charge recorded twice than a coincidence — and where they genuinely are
 *    two charges, one edit fixes it, whereas a duplicate silently doubles a
 *    category for the month.
 *  - **The date, within a few days.** A subscription's billing date drifts,
 *    a notification can arrive late, and a recurring rule's due date is a
 *    guess at when the charge will land.
 *  - **The vendor, fuzzily.** Substring or shared significant token, which is
 *    what makes "Google" and "Google One" the same and "Google" and "Netflix"
 *    not.
 */

/** Cents, so a float comparison can't call two equal amounts different. */
const AMOUNT_TOLERANCE = 0.005;

/**
 * How far apart two records of the same charge can be dated. Matches
 * RECURRING_DATE_TOLERANCE_DAYS in the capture pipeline — the two are
 * answering the same question and should not disagree.
 */
export const SAME_CHARGE_DAY_TOLERANCE = 3;

export interface ChargeLike {
  vendor: string | null | undefined;
  amount: number | null | undefined;
  /** `YYYY-MM-DD`, or anything whose first 10 characters are. */
  date: string | null | undefined;
}

/** Whole days between two `YYYY-MM-DD` strings, or null if either is unusable. */
function daysApart(a: string, b: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    // UTC, so the difference is never bent by a daylight-saving boundary.
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };
  const first = parse(a);
  const second = parse(b);
  if (first === null || second === null) return null;
  return Math.abs(first - second) / 86_400_000;
}

export function isSameCharge(
  a: ChargeLike,
  b: ChargeLike,
  dayTolerance: number = SAME_CHARGE_DAY_TOLERANCE,
): boolean {
  if (a.amount == null || b.amount == null) return false;
  if (Math.abs(Number(a.amount) - Number(b.amount)) > AMOUNT_TOLERANCE) return false;

  // A charge and its refund are not the same charge, whatever else matches.
  if (Number(a.amount) * Number(b.amount) < 0) return false;

  const gap = daysApart(String(a.date || ''), String(b.date || ''));
  if (gap === null || gap > dayTolerance) return false;

  return fuzzyVendorMatch(String(a.vendor || ''), String(b.vendor || ''));
}

/** The first record in `existing` that looks like the same charge as `candidate`. */
export function findSameCharge<T extends ChargeLike>(
  candidate: ChargeLike,
  existing: readonly T[],
  dayTolerance: number = SAME_CHARGE_DAY_TOLERANCE,
): T | null {
  for (const row of existing) {
    if (isSameCharge(candidate, row, dayTolerance)) return row;
  }
  return null;
}
