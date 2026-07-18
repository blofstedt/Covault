// lib/refundMatching.ts
//
// Refund handling.
//
// A refund is a negative-amount transaction (e.g. -$282.00 from "You Got")
// that offsets a previous positive-amount expense (e.g. the $282.00 the
// user spent at the same vendor). The product spec is:
//
//   1. Refunds never show in the transaction list as their own line item.
//      They are bookkeeping, not activity.
//   2. If a refund matches an existing expense (same vendor, same |amount|,
//      same budget, within REFUND_MATCH_WINDOW_DAYS of each other), the
//      expense is "refunded" — rendered with a strikethrough, and the
//      budget's spent total is reduced by the refund's absolute amount.
//   3. If a refund does NOT match any current expense, it falls back to
//      the existing behaviour: the negative amount is still subtracted
//      from the budget total (so the budget "earns back" the money), but
//      no line is struck through. This is rare but can happen if the
//      original expense was older than the match window or already removed.
//
// The budget total is reduced by `acc + tx.amount` regardless (negative
// amount subtracts), so the only UI change is hiding refund line items
// and striking through matched expenses.

import type { Transaction } from '../types';

/** How far apart (in days) a refund and its expense can be and still
 *  be considered a match. 30 days covers most card refund windows. */
export const REFUND_MATCH_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True if the transaction is a refund (negative amount, not income). */
export function isRefund(tx: Pick<Transaction, 'amount' | 'is_income'>): boolean {
  return Number(tx.amount) < 0 && !tx.is_income;
}

/** True if the transaction is income (positive flow into the account). */
export function isIncome(tx: Pick<Transaction, 'amount' | 'is_income'>): boolean {
  return tx.is_income === true;
}

/** Get the date string (YYYY-MM-DD) for a transaction, regardless of
 *  whether it's a full ISO timestamp or a date-only string. */
function txDateStr(tx: Pick<Transaction, 'date'>): string {
  return String(tx.date).slice(0, 10);
}

/** Build a map of expenseId → matched refund for the given transaction
 *  list. Only real (non-projected) refunds are matched.
 *
 *  Matching algorithm:
 *  - For each refund R, find positive-amount expense E in the same
 *    budget where:
 *      * vendor matches (case-insensitive, trimmed)
 *      * |E.amount| === |R.amount| (within $0.01 tolerance)
 *      * |E.date − R.date| <= REFUND_MATCH_WINDOW_DAYS
 *    Pick the closest date match if multiple candidates exist.
 *  - Each expense can only be matched by one refund.
 *  - Projected transactions never participate in matching.
 *
 *  Returns: { matchedExpenseIds: Set<string>, unmatchedRefunds: Transaction[] }
 *    - matchedExpenseIds: expenses that have a corresponding refund
 *    - unmatchedRefunds: refunds that didn't match any expense (still
 *      affect the budget total via their negative amount)
 */
export function matchRefundsToExpenses(
  transactions: Transaction[],
): { matchedExpenseIds: Set<string>; unmatchedRefunds: Transaction[] } {
  const matchedExpenseIds = new Set<string>();
  const matchedRefundIds = new Set<string>();

  // Separate refunds and candidate expenses
  const refunds = transactions.filter((t) => isRefund(t) && !t.is_projected);
  const expenses = transactions.filter(
    (t) => !isRefund(t) && !t.is_income && !t.is_projected && Number(t.amount) > 0,
  );

  for (const refund of refunds) {
    const refundAmount = Math.abs(Number(refund.amount));
    const refundDate = new Date(txDateStr(refund) + 'T12:00:00.000Z').getTime();
    if (!Number.isFinite(refundDate)) continue;
    const refundVendor = refund.vendor?.toLowerCase().trim() ?? '';
    const refundBudgetId = refund.budget_id ?? (refund as any).category_id ?? '';

    let bestExpense: Transaction | null = null;
    let bestDistance = Infinity;

    for (const expense of expenses) {
      if (matchedExpenseIds.has(expense.id)) continue; // already claimed
      if (Number(expense.amount) <= 0) continue;

      // Vendor match (case-insensitive)
      const expenseVendor = expense.vendor?.toLowerCase().trim() ?? '';
      if (expenseVendor !== refundVendor) continue;

      // Budget match — skip if the user has since recategorized the expense
      // to a different budget. Without a budget match, a refund from a
      // generic-sounding vendor (e.g. "Amazon") would hit unrelated charges.
      const expenseBudgetId = expense.budget_id ?? (expense as any).category_id ?? '';
      if (refundBudgetId && expenseBudgetId && refundBudgetId !== expenseBudgetId) {
        continue;
      }

      // Amount match (within 1 cent)
      if (Math.abs(Number(expense.amount) - refundAmount) > 0.01) continue;

      // Date match within window
      const expenseDate = new Date(txDateStr(expense) + 'T12:00:00.000Z').getTime();
      if (!Number.isFinite(expenseDate)) continue;
      const distance = Math.abs(expenseDate - refundDate) / MS_PER_DAY;
      if (distance > REFUND_MATCH_WINDOW_DAYS) continue;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestExpense = expense;
      }
    }

    if (bestExpense) {
      matchedExpenseIds.add(bestExpense.id);
      matchedRefundIds.add(refund.id);
    }
  }

  const unmatchedRefunds = refunds.filter((r) => !matchedRefundIds.has(r.id));
  return { matchedExpenseIds, unmatchedRefunds };
}
