import type { Transaction } from '../types';

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
 * - Only future occurrences are projected (today and past are treated as elapsed/real timeline).
 * - Project up to 6 months ahead so forward months can render in UI/chart.
 * - Display-only (never written to DB).
 */
export function generateProjectedTransactions(base: Transaction[]): Transaction[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const horizon = addMonths(today, 6);

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

    let current = new Date(toIsoDay(tx.date));
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

      if (current > today && !realKeys.has(key)) {
        projected.push({
          ...tx,
          budget_id: budgetId,
          id: `projected-${tx.id}-${isoDate}`,
          date: isoDate,
          is_projected: true,
        });
      }
    }
  }

  return projected;
}
