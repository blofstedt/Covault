// lib/monthWindow.ts
//
// The seven months the dashboard can show, and what any one of them is worth.
//
// The chart used to draw whichever months happened to contain transactions,
// windowed down to six. That made the axis move under the user: a month with
// no spending simply did not exist, so adding the first purchase of a month
// could shift every label sideways, and "three months back" was never a fixed
// place. The window is now built from the calendar instead — three months
// before this one, this one, three after — so the rail is the same seven
// positions whatever the ledger holds, and the middle position is always now.
//
// Everything here is pure and works in YYYY-MM strings, the same key
// `getLocalMonthKey` produces, so nothing in this file has to know about
// timezones.

import type { Transaction } from '../types';

/** Months shown before the current one. */
export const MONTHS_BEFORE = 3;
/** Months shown after the current one. */
export const MONTHS_AFTER = 3;
/** Length of the rail: three back, now, three forward. */
export const MONTH_WINDOW_LENGTH = MONTHS_BEFORE + 1 + MONTHS_AFTER;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Is this a usable YYYY-MM key? */
export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_KEY_PATTERN.test(value);
}

/**
 * Move a month key by `delta` months. Negative goes back.
 *
 * Built through a Date so December + 1 rolls the year rather than producing
 * a thirteenth month. An unusable key is returned unchanged — the caller is
 * showing something, and a silently invented month would be worse than the
 * key it already had.
 */
export function shiftMonthKey(monthKey: string, delta: number): string {
  if (!isMonthKey(monthKey)) return monthKey;
  const [year, month] = monthKey.split('-').map(Number);
  const shifted = new Date(year, month - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The seven month keys the rail shows, oldest first, with `currentMonthKey`
 * in the middle.
 */
export function buildMonthWindow(
  currentMonthKey: string,
  before: number = MONTHS_BEFORE,
  after: number = MONTHS_AFTER,
): string[] {
  const keys: string[] = [];
  for (let offset = -before; offset <= after; offset++) {
    keys.push(shiftMonthKey(currentMonthKey, offset));
  }
  return keys;
}

export type MonthRelation = 'past' | 'current' | 'future';

/** Where a month sits relative to the one we are actually in. */
export function monthRelation(monthKey: string, currentMonthKey: string): MonthRelation {
  if (monthKey === currentMonthKey) return 'current';
  return monthKey < currentMonthKey ? 'past' : 'future';
}

/** `Aug`, for the rail. */
export function shortMonthName(monthKey: string): string {
  if (!isMonthKey(monthKey)) return '';
  return MONTH_SHORT[Number(monthKey.slice(5, 7)) - 1];
}

/** `August 2026`, for the places that have room to say it properly. */
export function longMonthLabel(monthKey: string): string {
  if (!isMonthKey(monthKey)) return '';
  return `${MONTH_LONG[Number(monthKey.slice(5, 7)) - 1]} ${monthKey.slice(0, 4)}`;
}

/**
 * What the balance figure is called for the month being shown.
 *
 * The number above the vials is the same size and the same colour whichever
 * month is on screen, so the label is what has to say which one it is: a
 * closing balance from four months ago read as "you have this much" otherwise.
 */
export function balanceLabelForMonth(
  monthKey: string,
  currentMonthKey: string,
  isSharedAccount: boolean,
): string {
  const relation = monthRelation(monthKey, currentMonthKey);
  if (relation === 'current') {
    return isSharedAccount ? 'Our Remaining Balance' : 'Remaining Balance';
  }
  const month = MONTH_LONG[Number(monthKey.slice(5, 7)) - 1] || '';
  return relation === 'past' ? `${month} · Closing Balance` : `${month} · Projected Balance`;
}

/**
 * What is left of `income` after everything in `monthTransactions`.
 *
 * The list handed in is one month's worth — real rows AND the projected
 * occurrences for that month — because that is exactly what the vials below
 * are drawing. Summing a different set here than the vials show is how the
 * headline figure and the bars come to disagree.
 *
 * `income` is already the effective figure (useDashboardTotals substitutes the
 * starter income when none has been saved yet); this module deliberately holds
 * no fallback of its own, so there is only ever one of them.
 */
export function remainingForMonth(
  monthTransactions: readonly Transaction[],
  income: number,
): number {
  const spent = monthTransactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  return income - spent;
}
