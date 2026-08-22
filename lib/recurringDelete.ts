// lib/recurringDelete.ts
//
// Works out what "delete this recurring transaction" actually means.
//
// A recurring charge is not one row. It is one or more real rows in the DB
// (the original the user entered, plus any occurrence captured from the bank,
// plus rows the removed executor spawned before it was taken out) and a tail
// of display-only projections generated from the earliest of those. Deleting the row the user tapped is therefore never the
// whole job, and when they tapped a *projection* there is no row to delete at
// all — its id is `projected-<source id>-<date>`, which the database rejects
// outright as an id. That rejection is the error this module removes.
//
// The rule: deleting an occurrence removes that occurrence and every later
// one, and leaves everything that already elapsed alone. Occurrences before
// the cut keep their money but stop recurring — they are flipped to One-time,
// which is what stops the projections from bringing the series back on the
// next app open.

import type { Transaction } from '../types';
import { Recurrence } from '../types';
import { normalizeRecurrence } from './recurrence';
import { parseProjectedId } from './projectedTransactions';

/** Days since the epoch, from a YYYY-MM-DD string. */
function epochDay(isoDay: string): number {
  const [y, m, d] = isoDay.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function isoDay(value: string | Date | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Identifies the recurring series a row belongs to. Null for one-time rows.
 *
 * Monthly keys on the day of the month, matching how generateProjectedTransactions
 * groups its sources: the user has two separate Fizz charges a month, on the
 * 13th and the 16th, and ending one must not end the other.
 *
 * Biweekly cannot use the day of the month — a fortnightly charge lands on a
 * different date every other month — so it keys on the 14-day phase instead,
 * which every occurrence of the same series shares and a genuinely different
 * fortnightly charge almost never does.
 */
export function recurringSeriesKey(tx: Transaction): string | null {
  const recurrence = normalizeRecurrence(tx);
  if (recurrence === 'one-time') return null;

  const day = isoDay(tx.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const phase = recurrence === 'biweekly'
    ? `p${((epochDay(day) % 14) + 14) % 14}`
    : `d${day.slice(8, 10)}`;

  return [
    (tx.vendor || '').trim().toLowerCase(),
    Number(tx.amount).toFixed(2),
    recurrence,
    phase,
  ].join('|');
}

export interface RecurringDeletePlan {
  /** Rows to delete from the DB: the chosen occurrence and every later one. */
  remove: Transaction[];
  /**
   * Rows that already elapsed and stay on the books, but stop recurring.
   * `recurrence` is what they were before, so an undo can put it back.
   */
  endSeries: Array<{ id: string; recurrence: Transaction['recurrence'] }>;
  /** True when this covers a recurring series rather than a single entry. */
  isSeries: boolean;
}

/**
 * Decide what deleting `targetId` should remove.
 *
 * Returns null when the id is a projection whose source row is not in the
 * list — there is nothing the caller can safely delete, and silently deleting
 * the wrong row would be worse than reporting it.
 */
export function planRecurringDelete(
  targetId: string,
  transactions: Transaction[],
): RecurringDeletePlan | null {
  const projected = parseProjectedId(targetId);
  const sourceId = projected ? projected.sourceId : targetId;
  const sourceTx = transactions.find(t => t.id === sourceId);

  if (!sourceTx) return null;

  const seriesKey = recurringSeriesKey(sourceTx);

  // Not recurring: the entry the user tapped is the whole of it.
  if (!seriesKey) {
    return { remove: [sourceTx], endSeries: [], isSeries: false };
  }

  // Cut at the occurrence the user actually tapped — the projection's own
  // date when they tapped a projection, otherwise the row's date.
  const cutoff = projected ? projected.date : isoDay(sourceTx.date);

  const remove: Transaction[] = [];
  const endSeries: RecurringDeletePlan['endSeries'] = [];

  for (const tx of transactions) {
    // Defensive: a caller that handed us a list with projections mixed in
    // must not have those counted as series members — they have no DB row.
    if (parseProjectedId(String(tx.id || ''))) continue;
    if (recurringSeriesKey(tx) !== seriesKey) continue;
    const day = isoDay(tx.date);
    if (day >= cutoff) {
      remove.push(tx);
    } else {
      endSeries.push({ id: tx.id, recurrence: tx.recurrence });
    }
  }

  return { remove, endSeries, isSeries: true };
}

/** Apply a plan to an in-memory transaction list (optimistic UI, and undo's inverse). */
export function applyRecurringDeletePlan(
  transactions: Transaction[],
  plan: RecurringDeletePlan,
): Transaction[] {
  const removed = new Set(plan.remove.map(t => t.id));
  const ended = new Set(plan.endSeries.map(t => t.id));
  return transactions
    .filter(t => !removed.has(t.id))
    .map(t => (ended.has(t.id) ? { ...t, recurrence: Recurrence.ONE_TIME } : t));
}
