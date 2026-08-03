import { useMemo } from 'react';
import { Transaction } from '../../types';
import { generateProjectedTransactions } from '../../lib/projectedTransactions';
import { getLocalMonthKey, getLocalToday } from '../../lib/dateUtils';
import { DEFAULT_MONTHLY_INCOME } from '../../lib/apiHelpers';

export default function useDashboardTotals(
  transactions: Transaction[],
  monthlyIncome: number,
  /** Today as YYYY-MM-DD. Pass `useCurrentDay()` so the totals roll over at
   *  midnight; the default only covers callers that don't have it. */
  todayIso: string = getLocalToday(),
) {
  const currentMonth = getLocalMonthKey(todayIso);

  const currentMonthTransactions = useMemo(() => {
    return transactions.filter(
      t => typeof t.date === 'string' && getLocalMonthKey(t.date) === currentMonth
    );
  }, [transactions, currentMonth]);

  // Keyed on the day, not just on `transactions`: the projection decides which
  // occurrences are still in the future and which month counts as "current".
  // Memoised on `transactions` alone, a set generated yesterday kept yesterday's
  // answers to both — including last month's occurrences — until a transaction
  // happened to change.
  const projectedTransactions = useMemo(() => {
    return generateProjectedTransactions(
      transactions,
      todayIso,
    );
  }, [transactions, todayIso]);

  // Use DEFAULT_MONTHLY_INCOME if monthlyIncome is 0 (not loaded yet from DB)
  const effectiveIncome = monthlyIncome > 0 ? monthlyIncome : DEFAULT_MONTHLY_INCOME;

  const remainingMoney = useMemo(() => {
    const spent = currentMonthTransactions.reduce(
      (sum, t) => sum + t.amount,
      0
    );

    const projectedCurrentMonth = projectedTransactions
      .filter((t) => typeof t.date === 'string' && getLocalMonthKey(t.date) === currentMonth)
      .reduce((sum, t) => sum + t.amount, 0);

    return effectiveIncome - spent - projectedCurrentMonth;
  }, [
    effectiveIncome,
    currentMonthTransactions,
    projectedTransactions,
    currentMonth
  ]);

  return {
    currentMonthTransactions,
    projectedTransactions,
    remainingMoney,
    isIncomeLoaded: monthlyIncome > 0,
  };
}