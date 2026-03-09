import { useMemo } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import { SYSTEM_CATEGORIES } from '../../constants';

export function normalizeTransactions(
  transactions: Transaction[],
  budgets: BudgetCategory[]
): Transaction[] {
  const categoryToBudget = new Map<string, string>();
  const budgetIds = new Set<string>();
  const budgetNameToId = new Map<string, string>();
  const systemCategoryIdToName = new Map<string, string>(
    SYSTEM_CATEGORIES.map(category => [String(category.id).toLowerCase(), category.name.trim().toLowerCase()]),
  );
  const otherBudgetId =
    budgets.find((b: any) => String(b?.name || '').toLowerCase() === 'other')?.id || null;

  budgets.forEach((b: any) => {
    if (b?.id) {
      const normalizedId = String(b.id);
      budgetIds.add(normalizedId);
      if (typeof b?.name === 'string' && b.name.trim()) {
        budgetNameToId.set(b.name.trim().toLowerCase(), normalizedId);
      }
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

    const rawBudgetIdValue = tx.budget_id ?? null;
    const rawBudgetNameValue = tx.Budget ?? tx.budget ?? null;

    const normalizedBudgetIdValue =
      typeof rawBudgetIdValue === 'string'
        ? rawBudgetIdValue.trim().toLowerCase()
        : null;

    const normalizedBudgetNameValue =
      typeof rawBudgetNameValue === 'string'
        ? rawBudgetNameValue.trim().toLowerCase()
        : null;

    const budgetIdFromBudgetColumn =
      normalizedBudgetNameValue
        ? budgetNameToId.get(normalizedBudgetNameValue)
        : null;

    const budgetIdFromBudgetIdName =
      normalizedBudgetIdValue
        ? budgetNameToId.get(normalizedBudgetIdValue)
        : null;

    const systemCategoryNameFromId =
      normalizedBudgetIdValue
        ? systemCategoryIdToName.get(normalizedBudgetIdValue)
        : null;

    const budgetIdFromSystemCategoryId =
      systemCategoryNameFromId
        ? budgetNameToId.get(systemCategoryNameFromId)
        : null;

    const budgetIdFromPrefixedBudgetId =
      normalizedBudgetIdValue && normalizedBudgetIdValue.startsWith('budget:')
        ? budgetNameToId.get(normalizedBudgetIdValue.slice('budget:'.length).replace(/-/g, ' '))
        : null;

    const rawBudgetId =
      rawBudgetIdValue != null && budgetIds.has(String(rawBudgetIdValue))
        ? String(rawBudgetIdValue)
        : null;

    const initialBudgetId =
      budgetIdFromBudgetColumn ??
      budgetIdFromBudgetIdName ??
      budgetIdFromSystemCategoryId ??
      budgetIdFromPrefixedBudgetId ??
      mappedBudgetId ??
      rawBudgetId ??
      null;

    const rawBudgetValue = tx.budget_id ?? tx.Budget ?? tx.budget ?? null;
    const normalizedRawBudget =
      typeof rawBudgetValue === 'string'
        ? rawBudgetValue.trim().toLowerCase()
        : null;

    const budgetIdFromName =
      normalizedRawBudget
        ? budgetNameToId.get(normalizedRawBudget)
        : null;

    const budgetIdFromPrefixedName =
      normalizedRawBudget && normalizedRawBudget.startsWith('budget:')
        ? budgetNameToId.get(normalizedRawBudget.slice('budget:'.length).replace(/-/g, ' '))
        : null;

    const rawBudgetId =
      rawBudgetValue != null && budgetIds.has(String(rawBudgetValue))
        ? String(rawBudgetValue)
        : null;

    const initialBudgetId =
      budgetIdFromName ?? budgetIdFromPrefixedName ?? mappedBudgetId ?? rawBudgetId ?? null;
    const hasValidBudgetId = initialBudgetId != null && budgetIds.has(String(initialBudgetId));

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
