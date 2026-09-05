// lib/discretionaryShield.ts
//
// The Discretionary Shield.
//
// The setting has existed since the dashboard was split up, and it saved
// correctly, but nothing ever computed an amount: `Dashboard.tsx` passed a
// literal `0` down as the Leisure vial's `externalDeduction`, so turning the
// shield on changed precisely nothing on screen. Everything else was wired —
// the toggle, the DB column, the vial's arithmetic — which is why it looked
// like it worked.
//
// What the shield means, deliberately, is ONE direction: an overspent category
// is absorbed by Leisure, so the Leisure vault shows less left and fills
// further. The overspent category itself is NOT rewritten to look as though it
// came in under its limit. Money did not actually move — the shield is a way
// of reading the month, not a transfer — and a category that quietly stopped
// saying "Over by $80" the moment the shield was switched on would hide the
// one fact the user most needs from that vial.
//
// It is display-only for the same reason. The headline balance already counts
// every transaction once, whatever category it landed in, so adding the
// shielded amount to any total would count the overspend twice.

import type { BudgetCategory, Transaction } from '../types';
import { isRefund, matchRefundsToExpenses } from './refundMatching';

/**
 * Which vault absorbs the overflow.
 *
 * Matched on the name rather than the id because the id is not stable: a
 * budget loaded from the database is keyed `budget:<name>` while the starter
 * constants carry fixed UUIDs (see the onboarding invariant in CLAUDE.md).
 */
export function isLeisureBudget(budget: { name?: string | null }): boolean {
  return String(budget?.name || '').toLowerCase().includes('leisure');
}

export interface BudgetTotals {
  /** Expenses cancelled out by a matching refund — rendered struck through. */
  refundedExpenseIds: Set<string>;
  /** Money already spent in this budget this month. */
  spent: number;
  /** Recurring occurrences still expected this month. */
  projected: number;
  /** Everything that should appear as a row (refunds are bookkeeping). */
  visibleTransactions: Transaction[];
}

/**
 * What one vial is showing, from the rows it was handed.
 *
 * This lives here rather than inside BudgetSection so the shield's arithmetic
 * and the vial's arithmetic cannot drift: the number deducted from Leisure has
 * to be the same overspend the other vial is displaying, to the cent, or the
 * user is looking at two different answers to one question.
 */
export function computeBudgetTotals(
  budgetId: string,
  transactions: Transaction[],
): BudgetTotals {
  const { matchedExpenseIds } = matchRefundsToExpenses(transactions);
  const refundedExpenseIds = new Set<string>(matchedExpenseIds);
  let spent = 0;
  let projected = 0;
  const visibleTransactions: Transaction[] = [];

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    if (tx.refunded) refundedExpenseIds.add(tx.id);
    if (!isRefund(tx)) visibleTransactions.push(tx);

    if (tx.budget_id === budgetId) {
      if (tx.is_projected) {
        projected += tx.amount;
      } else if (
        !tx.refunded &&
        !(refundedExpenseIds.has(tx.id) && Number(tx.amount) > 0)
      ) {
        spent += tx.amount;
      }
    }
  }

  return { refundedExpenseIds, spent, projected, visibleTransactions };
}

export interface ShieldOptions {
  /** Categories the user has hidden. Their overflow is left out — see below. */
  hiddenCategories?: readonly string[];
}

/**
 * How much of this month's overspending Leisure is absorbing.
 *
 * Sums, over every other budget, the amount by which what the vial is showing
 * (spent plus this month's remaining recurring charges) exceeds that vial's
 * limit. Returns 0 when nothing is over.
 *
 * Hidden categories are deliberately excluded. Their overflow is real money,
 * but a hidden category has no vial on screen — counting it would take a chunk
 * out of Leisure that nothing visible accounts for, which is indistinguishable
 * from the bug this file fixes. Every dollar the shield removes from Leisure
 * can be found on another vial on the same screen.
 *
 * @param budgets     Every budget in app state, Leisure included.
 * @param transactions The month being read: real rows plus this month's
 *                     projected occurrences, exactly as handed to the vials.
 */
export function computeShieldedOverflow(
  budgets: readonly BudgetCategory[],
  transactions: readonly Transaction[],
  options: ShieldOptions = {},
): number {
  if (!budgets || budgets.length === 0) return 0;

  const hidden = new Set(options.hiddenCategories || []);

  // Group once. Each vial's totals are computed from its own rows, the same
  // way the dashboard groups them before rendering.
  const byBudgetId = new Map<string, Transaction[]>();
  for (const tx of transactions || []) {
    const bucket = byBudgetId.get(tx.budget_id);
    if (bucket) bucket.push(tx);
    else byBudgetId.set(tx.budget_id, [tx]);
  }

  let overflow = 0;

  for (const budget of budgets) {
    if (isLeisureBudget(budget)) continue;
    if (hidden.has(budget.id)) continue;

    const rows = byBudgetId.get(budget.id);
    if (!rows || rows.length === 0) continue;

    const { spent, projected } = computeBudgetTotals(budget.id, rows);
    const limit = Number(budget.totalLimit) || 0;
    const over = spent + projected - limit;
    if (over > 0) overflow += over;
  }

  // Cents, not floating-point dust. Summing several budgets' overflow can
  // land on 84.99999999999999, and the vial renders whole dollars off it.
  return Math.round(overflow * 100) / 100;
}
