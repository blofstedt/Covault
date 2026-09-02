// lib/budgetAllocation.ts
//
// "How much of the month is already spoken for?" — and, more importantly, when
// the app is allowed to refuse a change to that.
//
// The limits screen used to refuse any save whose resulting total came out
// above the monthly income. That reads as a sensible rule and is a trap for
// exactly the person the app most needs to be gentle with: a brand-new user.
// The starter set is seven categories at $500, which is $3,500 spoken for
// before they have touched anything. Someone whose income is $3,000 is
// therefore over-allocated on arrival — and because the rule only looked at
// the resulting total, LOWERING a limit was refused too: dropping Housing from
// $500 to $400 still leaves $3,400, still above $3,000, still refused. The
// only way out of the state the app put them in was to raise the income
// figure until the defaults fitted.
//
// So the rule is now about direction, not only about the line: a change that
// moves the total toward the income is always allowed, however far away it
// still is. Only a change that pushes further past it is refused, and the
// figure the user needs is shown continuously rather than appearing as an
// error after a save they thought they had made.

import type { BudgetCategory } from '../types';

/** The subset of a budget row this module needs. */
export interface AllocatableBudget {
  id: string;
  totalLimit: number;
}

/**
 * What the visible budgets add up to.
 *
 * Hidden categories are excluded because they are excluded everywhere else —
 * a category the user has put away is not spending they have planned.
 */
export function allocationTotal(
  budgets: readonly AllocatableBudget[],
  hiddenCategories: readonly string[] = [],
): number {
  const hidden = new Set(hiddenCategories);
  return (budgets || []).reduce(
    (sum, budget) => (hidden.has(budget.id) ? sum : sum + (Number(budget.totalLimit) || 0)),
    0,
  );
}

/**
 * The total if `categoryId`'s limit were `nextLimit` instead.
 *
 * A hidden category stays out of the sum whatever is typed into it.
 */
export function allocationTotalWith(
  budgets: readonly AllocatableBudget[],
  hiddenCategories: readonly string[],
  categoryId: string,
  nextLimit: number,
): number {
  const hidden = new Set(hiddenCategories);
  return (budgets || []).reduce((sum, budget) => {
    if (hidden.has(budget.id)) return sum;
    const limit = budget.id === categoryId ? nextLimit : Number(budget.totalLimit) || 0;
    return sum + (Number(limit) || 0);
  }, 0);
}

/**
 * What is left of the month's money after the visible limits.
 *
 * Signed on purpose: negative is a real state the app has to be able to show,
 * not one it can refuse to enter.
 */
export function remainingToAllocate(income: number, total: number): number {
  return (Number(income) || 0) - (Number(total) || 0);
}

/**
 * May this change be saved?
 *
 * Yes when the result fits inside the income, and yes when it does not fit but
 * is smaller than what is already there — see the header. No income set (0, or
 * not yet loaded) means there is no line to be over, so everything is allowed.
 */
export function isAllowedLimitChange({
  previousTotal,
  nextTotal,
  income,
}: {
  previousTotal: number;
  nextTotal: number;
  income: number;
}): boolean {
  const limit = Number(income) || 0;
  if (limit <= 0) return true;
  if (nextTotal <= limit) return true;
  return nextTotal < previousTotal;
}

/** Convenience for callers holding the app's own budget shape. */
export function budgetsToAllocatable(
  budgets: readonly BudgetCategory[],
): AllocatableBudget[] {
  return (budgets || []).map((b) => ({ id: b.id, totalLimit: b.totalLimit }));
}
