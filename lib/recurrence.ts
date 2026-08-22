// lib/recurrence.ts
//
// Shared recurrence primitives. The display-only projection
// (projectedTransactions.ts) is the only consumer that generates occurrences;
// recurringSchedule.ts uses them to recognise a captured charge as one.
// Nothing writes recurring rows to the database — see the note in App.tsx.

import type { Transaction } from '../types';

export type Recurrence = 'monthly' | 'biweekly' | 'one-time';

/** Map a transaction's `recur`/`recurrence` field to a canonical value. */
export function normalizeRecurrence(tx: Transaction): Recurrence {
  const raw = ((tx as any).recur ?? tx.recurrence ?? '').toString().trim().toLowerCase();
  if (raw === 'monthly') return 'monthly';
  if (raw === 'biweekly') return 'biweekly';
  return 'one-time';
}

/** Add `months` calendar months to a Date. Returns a NEW Date. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Step forward one recurrence interval: biweekly = +14 days, anything else
 * (monthly) = +1 calendar month. Returns a NEW Date — the input is not mutated.
 * Accepts a raw or normalized recurrence string.
 */
export function stepForward(d: Date, recurrence: string): Date {
  if (recurrence.toLowerCase() === 'biweekly') {
    const next = new Date(d);
    next.setDate(next.getDate() + 14);
    return next;
  }
  return addMonths(d, 1);
}
