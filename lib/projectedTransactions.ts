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
  // Use local date components, NOT toISOString(). The UTC slice
  // can roll over to the wrong day for users in negative-offset
  // timezones (e.g. America/Chicago after ~6 PM local), which would
  // push projected transactions into the wrong month.
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
 *
 * IMPORTANT: Only the EARLIEST transaction per (vendor, amount) group is
 * used as a projection source. The recurring executor spawns new real
 * transactions from each template (e.g. a Jul 13 Fizz spawns Aug 13, Sep 13,
 * ...). Without this filter, the projection function would generate
 * duplicate Sep 13 / Oct 13 / ... entries from both the original Jul 13
 * template AND the executor-spawned Aug 13 row, causing the dashboard
 * "red block" (remainingMoney went hugely negative because projectedCurrentMonth
 * was summed twice per template). See commit ed14cc3 for the bug history.
 *
 * Executor-spawned rows are also skipped explicitly as a belt-and-suspenders:
 * if a future change ever stores the original template under source='executor',
 * the projection would still be correctly attributed to the manual/notification
 * source rather than chained.
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

  // Find the earliest transaction per (vendor, amount, recurrence, day-of-month)
  // group. Only these are used as projection sources.
  //
  // Why include day-of-month in the key:
  //   The user has two Fizz charges per month ($26.20 on the 13th and the
  //   16th) — these are LEGITIMATE separate charges, not a single template
  //   that was duplicated. Grouping by day-of-month keeps them as separate
  //   projection sources so both get their own future series.
  //
  // Why include recurrence in the key:
  //   A Monthly $50 Netflix and a separate Biweekly $50 Netflix (e.g. monthly
  //   subscription + biweekly purchases) must also stay separate.
  //
  // Executor-spawned rows share the same (vendor, amount, recurrence, day)
  // as their template, so they're automatically collapsed into the same group.
  const earliestByKey = new Map<string, Transaction>();
  for (const tx of base) {
    if (tx.is_projected && String(tx.id || '').startsWith('projected-')) continue;
    // Skip executor-spawned rows — they're already handled by the original
    // template. Using them as a second source would double-project.
    if ((tx as any).source === 'executor') continue;
    const recurrence = normalizeRecurrence(tx);
    if (recurrence === 'one-time') continue;
    const dayOfMonth = String(toIsoDay(tx.date).slice(8, 10));
    const key = `${tx.vendor.toLowerCase().trim()}|${Number(tx.amount).toFixed(2)}|${recurrence}|${dayOfMonth}`;
    const existing = earliestByKey.get(key);
    if (!existing) {
      earliestByKey.set(key, tx);
      continue;
    }
    const existingDate = parseLocalDate(toIsoDay(existing.date)).getTime();
    const candidateDate = parseLocalDate(toIsoDay(tx.date)).getTime();
    if (Number.isFinite(candidateDate) && candidateDate < existingDate) {
      earliestByKey.set(key, tx);
    }
  }

  const projected: Transaction[] = [];

  for (const tx of earliestByKey.values()) {
    const recurrence = normalizeRecurrence(tx);
    if (recurrence === 'one-time') continue;

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
