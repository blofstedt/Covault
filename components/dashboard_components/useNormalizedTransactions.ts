import { useMemo } from 'react';
import { Transaction, BudgetCategory } from '../../types';

export default function useNormalizedTransactions(
  transactions: Transaction[],
  budgets: BudgetCategory[]
): Transaction[] {

  return useMemo(() => {

    const categoryToBudget = new Map<string, string>();

    budgets.forEach((b: any) => {

      const catId =
        b.category_id ??
        b.categoryId ??
        b.category?.id ??
        b.category ??
        null;

      if (catId && b.id) {

        categoryToBudget.set(
          String(catId),
          String(b.id)
        );

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

        budget_id:
          tx.budget_id ??
          mappedBudgetId ??
          null,

      };

    });

  }, [transactions, budgets]);

}
