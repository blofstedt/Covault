import type { Transaction } from '../types';
import { parseLocalDate } from './dateUtils';

/**
 * Add months to a Date
 */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function toIsoDay(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function normalizeRecurrence(tx: Transaction): string {
  const raw = ((tx as any).recur ?? tx.recurrence ?? '').toString().trim().toLowerCase();
  if (raw === 'monthly') return 'monthly';
  if (raw === 'biweekly') return 'biweekly';
  return 'one-time';
}

function getTransactionBudgetId(tx: Transaction): string | undefined {
  return tx.budget_id ?? (tx as any).category_id;
}

/**
 * Generate projected recurring transactions from existing transactions.
 *
 * Rules:
 * - Monthly + Biweekly recurrences are projected.
 * - Current-month occurrences are included so on/before-today entries can solidify.
 * - Future occurrences stay projected until their date arrives.
 * - Project up to 3 months ahead as a rolling horizon.
 * - Display-only (never written to DB).
 */
export function generateProjectedTransactions(base: Transaction[]): Transaction[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const horizon = addMonths(today, 3);
  const currentMonthKey = toIsoDay(today).slice(0, 7);
  const realKeys = new Set(
    base.map((tx) => {
      const isoDate = toIsoDay(tx.date);
      return `${tx.vendor}|${tx.amount}|${isoDate}|${getTransactionBudgetId(tx) || ''}`;
    }),
  );

  const projected: Transaction[] = [];

  for (const tx of base) {
    const recurrence = normalizeRecurrence(tx);
    if (recurrence === 'one-time') continue;

    // Don't chain off projected entries generated in-app.
    // Keep DB rows eligible when they carry recurrence data.
    if (tx.is_projected && String(tx.id || '').startsWith('projected-')) continue;

    // Build the initial date in the user's local timezone. `new Date("YYYY-MM-DD")`
    // parses as UTC midnight, which lands on the previous local day for users
    // in negative-offset timezones and shifts the projected day-of-month after
    // the first addMonths().
    let current = parseLocalDate(toIsoDay(tx.date));
    if (Number.isNaN(current.getTime())) continue;

    while (true) {
      if (recurrence === 'biweekly') {
        current = new Date(current);
        current.setDate(current.getDate() + 14);
      } else {
        current = addMonths(current, 1);
      }

      if (current > horizon) break;

      const isoDate = toIsoDay(current);
      const budgetId = getTransactionBudgetId(tx);
      const key = `${tx.vendor}|${tx.amount}|${isoDate}|${budgetId || ''}`;

      const projectedMonthKey = isoDate.slice(0, 7);
      const isCurrentMonth = projectedMonthKey === currentMonthKey;

      if ((current > today || isCurrentMonth) && !realKeys.has(key)) {
        projected.push({
          ...tx,
          budget_id: budgetId,
          id: `projected-${tx.id}-${isoDate}`,
          date: isoDate,
          is_projected: current > today,
        });
      }
    }
  }

  return projected;
}
