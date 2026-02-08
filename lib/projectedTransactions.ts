import type { Transaction } from '../types';

/**
 * Add months to a Date
 */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Generate projected recurring transactions (Biweekly / Monthly)
 * from existing real transactions, **only in the future**.
 *
 * Limits:
 * - Biweekly: next 2 occurrences
 * - Monthly: next 1 occurrence
 *
 * These are display-only and never saved to the DB.
 * When their date arrives they "solidify" into actual transactions.
 */
export function generateProjectedTransactions(base: Transaction[]): Transaction[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Avoid duplicating real transactions
  const realKeys = new Set(
    base.map((tx) => {
      const isoDate = new Date(tx.date).toISOString().slice(0, 10);
      return `${tx.vendor}|${tx.amount}|${isoDate}|${tx.budget_id}`;
    }),
  );

  const projected: Transaction[] = [];

  for (const tx of base) {
    if (tx.recurrence === 'One-time') continue;
    if (tx.is_projected) continue; // don't chain off generated ones

    const maxOccurrences = tx.recurrence === 'Biweekly' ? 2 : 1;
    let count = 0;

    let current = new Date(tx.date);

    while (count < maxOccurrences) {
      if (tx.recurrence === 'Biweekly') {
        current.setDate(current.getDate() + 14);
      } else if (tx.recurrence === 'Monthly') {
        current = addMonths(current, 1);
      } else {
        break;
      }

      const isoDate = current.toISOString().slice(0, 10);
      const key = `${tx.vendor}|${tx.amount}|${isoDate}|${tx.budget_id}`;

      if (current >= today && !realKeys.has(key)) {
        projected.push({
          ...tx,
          id: `projected-${tx.id}-${isoDate}`,
          date: isoDate,
          is_projected: true,
        });
        count++;
      } else if (current >= today) {
        count++;
      }
    }
  }

  return projected;
}
