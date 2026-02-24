import { useMemo } from 'react';
import { Transaction, BudgetCategory } from '../../types';

export function normalizeTransactions(
  transactions: Transaction[],
  budgets: BudgetCategory[]
): Transaction[] {
  const categoryToBudget = new Map<string, string>();
  const budgetIds = new Set<string>();
  const otherBudgetId =
    budgets.find((b: any) => String(b?.name || '').toLowerCase() === 'other')?.id || null;

  budgets.forEach((b: any) => {
    if (b?.id) {
      budgetIds.add(String(b.id));
    }

    const catId =
      b.category_id ??
      b.categoryId ??
      b.category?.id ??
      b.category ??
      null;

    if (catId && b.id) {
      categoryToBudget.set(String(catId), String(b.id));
    }
  });

  return transactions.map((tx: any) => {
    const rawCategoryId =
      tx.category_id ??
      tx.categoryId ??
      tx.category?.id ??
      tx.category ??
      null;

    const mappedBudgetId =
      rawCategoryId != null
        ? categoryToBudget.get(String(rawCategoryId))
        : null;

    const amount =
      typeof tx.amount === 'number'
        ? tx.amount
        : Number(tx.amount ?? 0);

    const date =
      typeof tx.date === 'string'
        ? tx.date.slice(0, 10)
        : '';

    const initialBudgetId = tx.budget_id ?? mappedBudgetId ?? null;
    const hasValidBudgetId =
      initialBudgetId != null && budgetIds.has(String(initialBudgetId));

    return {
      ...tx,
      amount: Number.isFinite(amount)
        ? amount
        : 0,
      date,
      userName:
        tx.userName ??
        tx.user_name ??
        '',
      budget_id: hasValidBudgetId
        ? String(initialBudgetId)
        : otherBudgetId,
    };
  });
}

export default function useNormalizedTransactions(
  transactions: Transaction[],
  budgets: BudgetCategory[]
): Transaction[] {
  return useMemo(() => normalizeTransactions(transactions, budgets), [transactions, budgets]);
}
