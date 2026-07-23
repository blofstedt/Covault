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
import { aiFindRefundMatch } from './aiExtractor';

/** How far apart (in days) a refund and its expense can be and still
 *  be considered a match. 60 days covers longer card refund windows
 *  (e.g. items bought on a credit card statement that close at the
 *  end of the month, disputed charges, post-purchase price adjustments).
 *  Tuned from 30 to 60 after user feedback that some legitimate refunds
 *  were falling outside the window. */
export const REFUND_MATCH_WINDOW_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True if the transaction is a refund (negative amount, not income). */
export function isRefund(tx: Pick<Transaction, 'amount' | 'is_income'>): boolean {
  return Number(tx.amount) < 0 && !tx.is_income;
}

/** True if the transaction is income (positive flow into the account). */
export function isIncome(tx: Pick<Transaction, 'amount' | 'is_income'>): boolean {
  return tx.is_income === true;
}

/**
 * Normalize a vendor string for the strict equality used by refund matching.
 * Refunds are bookkeeping — we want zero false positives, so we use a
 * case-insensitive trim + collapse rather than fuzzy matching. If a
 * merchant rebrands or uses a slightly different surface form for the
 * refund than the original expense, the user can manually reconcile the
 * row in the app.
 */
function normalizeVendorForRefund(vendor: string): string {
  return vendor.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Find the closest matching expense for a refund notification.
 *
 * Matching rules (all must hold):
 *  - exact vendor (case-insensitive, whitespace-normalized)
 *  - exact |amount| (within $0.01 tolerance)
 *  - same budget (if both have a budget_id; if either is missing, we
 *    don't gate on budget)
 *  - |date difference| <= REFUND_MATCH_WINDOW_DAYS
 *  - expense is not already refunded
 *  - expense is not projected
 *
 * Returns the closest expense by date, or null if none match.
 */
export function findMatchingExpense(
  refund: Pick<Transaction, 'vendor' | 'amount' | 'date' | 'budget_id'>,
  candidates: Transaction[],
): Transaction | null {
  const refundAmount = Math.abs(Number(refund.amount));
  const refundDateStr = String(refund.date).slice(0, 10);
  const refundDate = new Date(refundDateStr + 'T12:00:00.000Z').getTime();
  if (!Number.isFinite(refundDate)) return null;
  const refundVendor = normalizeVendorForRefund(refund.vendor || '');
  if (!refundVendor) return null;
  const refundBudgetId = refund.budget_id || '';

  let best: Transaction | null = null;
  let bestDistance = Infinity;

  for (const expense of candidates) {
    if (Number(expense.amount) <= 0) continue;
    if (expense.is_projected) continue;
    if (expense.refunded) continue;

    const expenseVendor = normalizeVendorForRefund(expense.vendor || '');
    if (expenseVendor !== refundVendor) continue;

    if (Math.abs(Number(expense.amount) - refundAmount) > 0.01) continue;

    const expenseBudgetId = expense.budget_id || '';
    if (refundBudgetId && expenseBudgetId && refundBudgetId !== expenseBudgetId) continue;

    const expenseDateStr = String(expense.date).slice(0, 10);
    const expenseDate = new Date(expenseDateStr + 'T12:00:00.000Z').getTime();
    if (!Number.isFinite(expenseDate)) continue;
    const distance = Math.abs(expenseDate - refundDate) / MS_PER_DAY;
    if (distance > REFUND_MATCH_WINDOW_DAYS) continue;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = expense;
    }
  }
  // AI fallback for vendor-name mismatches (e.g. 'AMZN MKTP' vs 'Amazon')
  if (!best && candidates.length > 0) {
    const aiMatch = await aiFindRefundMatch(refund.vendor || '', Math.abs(Number(refund.amount)), candidates.map(c => ({
      id: c.id,
      vendor: c.vendor,
      amount: Number(c.amount),
      date: String(c.date).slice(0, 10),
    })));
    if (aiMatch) {
      best = candidates.find(c => c.id === aiMatch) || null;
    }
  }

  return best;
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
