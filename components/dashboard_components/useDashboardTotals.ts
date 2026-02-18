import { useMemo } from 'react';
import { Transaction } from '../../types';
import { generateProjectedTransactions } from '../../lib/projectedTransactions';

function getCurrentMonth() {

  const d = new Date();

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1
  ).padStart(2, '0')}`;

}

export default function useDashboardTotals(
  transactions: Transaction[],
  monthlyIncome: number
) {

  const currentMonth = getCurrentMonth();

  const currentMonthTransactions = useMemo(() => {

    return transactions.filter(
      t => t.date?.slice(0, 7) === currentMonth
    );

  }, [transactions]);


  const projectedTransactions = useMemo(() => {

    return generateProjectedTransactions(
      transactions
    );

  }, [transactions]);


  const remainingMoney = useMemo(() => {

    const spent = currentMonthTransactions.reduce(
      (sum, t) => sum + t.amount,
      0
    );

    const projected = projectedTransactions.reduce(
      (sum, t) => sum + t.amount,
      0
    );

    return monthlyIncome - spent - projected;

  }, [
    monthlyIncome,
    currentMonthTransactions,
    projectedTransactions
  ]);


  return {

    currentMonthTransactions,

    projectedTransactions,

    remainingMoney,

  };

}
