import { useMemo } from 'react';
import { Transaction } from '../../types';
import { generateProjectedTransactions } from '../../lib/projectedTransactions';
import { getLocalMonthKey, getLocalToday } from '../../lib/dateUtils';
import { DEFAULT_MONTHLY_INCOME } from '../../lib/apiHelpers';

export default function useDashboardTotals(
  transactions: Transaction[],
  monthlyIncome: number
) {
  const currentMonth = getLocalMonthKey(getLocalToday());

  const currentMonthTransactions = useMemo(() => {
    return transactions.filter(
      t => typeof t.date === 'string' && getLocalMonthKey(t.date) === currentMonth
    );
  }, [transactions, currentMonth]);

  const projectedTransactions = useMemo(() => {
    return generateProjectedTransactions(
      transactions
    );
  }, [transactions]);

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