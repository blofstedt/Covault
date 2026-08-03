import type { Transaction } from '../types';
import { getLocalMonthKey } from './dateUtils';

/** The calendar day a transaction happened on, as a sortable YYYY-MM-DD. */
export function transactionDay(tx: Transaction): string {
  return typeof tx.date === 'string' ? tx.date.slice(0, 10) : '';
}

/** Tie-break within a day: whichever was recorded first reads first. */
function recordedAt(tx: Transaction): number {
  const parsed = tx.created_at ? Date.parse(tx.created_at) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Chronological, earliest first — the order the money actually moves in, not
 * the order the rows arrived in.
 *
 * Supabase hands transactions back newest-first, and projected occurrences are
 * generated separately and appended after all of them, so a vial read
 * "Jul 31, Aug 29, Aug 27, Aug 15": two different orderings stapled together.
 * Sorting on the date the transaction happened (or will happen) makes the list
 * a timeline — what has been spent this month, then what is still coming —
 * which is also what makes a "jump to today" control a meaningful place to go.
 */
export function compareByDateOccurred(a: Transaction, b: Transaction): number {
  const dayA = transactionDay(a);
  const dayB = transactionDay(b);
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;

  const recordedA = recordedAt(a);
  const recordedB = recordedAt(b);
  if (recordedA !== recordedB) return recordedA - recordedB;

  // Stable final tie-break, so the order cannot shuffle between renders.
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Does this transaction belong to `monthKey` (YYYY-MM), in the user's local
 * calendar?
 *
 * The vials show one month and nothing else, and both halves of that list —
 * real transactions and projected occurrences — have to be filtered against
 * the SAME key. They used to be filtered in two different places against two
 * separately-derived month keys; any disagreement between them put last
 * month's rows in this month's list.
 */
export function isInMonth(tx: Transaction, monthKey: string): boolean {
  return typeof tx.date === 'string' && getLocalMonthKey(tx.date) === monthKey;
}

/**
 * Index of the first transaction dated `today` or later, in a list already
 * sorted by `compareByDateOccurred` — the boundary between what has already
 * happened and what is still to come. -1 when everything is in the past.
 */
export function findTodayIndex(transactions: Transaction[], todayIso: string): number {
  return transactions.findIndex((tx) => transactionDay(tx) >= todayIso);
}
