import { useMemo } from 'react';
import { Transaction } from '../../types';
import { generateProjectedTransactions } from '../../lib/projectedTransactions';
import { getLocalMonthKey, getLocalToday } from '../../lib/dateUtils';
import { DEFAULT_MONTHLY_INCOME } from '../../lib/apiHelpers';
import { householdSpend, type PartnerSummary } from '../../lib/householdSharing';

export default function useDashboardTotals(
  transactions: Transaction[],
  monthlyIncome: number,
  /** Today as YYYY-MM-DD. Pass `useCurrentDay()` so the totals roll over at
   *  midnight; the default only covers callers that don't have it. */
  todayIso: string = getLocalToday(),
  /** Who is signed in, so a partner's rows can be told from their own. */
  myUserId: string = '',
  /**
   * What the partner spent when their rows are not readable. Null when there
   * is no partner, or when they share their rows and the rows are the answer.
   */
  partnerSummary: PartnerSummary | null = null,
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
    // A partner whose rows this phone is not allowed to read still spent the
    // money. Summing only what is on screen would claim the household had more
    // of it than it does — see householdSpend.
    const spent = householdSpend(currentMonthTransactions, myUserId, partnerSummary);

    const projectedCurrentMonth = projectedTransactions
      .filter((t) => typeof t.date === 'string' && getLocalMonthKey(t.date) === currentMonth)
      .reduce((sum, t) => sum + t.amount, 0);

    return effectiveIncome - spent - projectedCurrentMonth;
  }, [
    effectiveIncome,
    currentMonthTransactions,
    projectedTransactions,
    currentMonth,
    myUserId,
    partnerSummary,
  ]);

  return {
    currentMonthTransactions,
    projectedTransactions,
    remainingMoney,
    // Handed back so a caller doing the same arithmetic for another month
    // (the dashboard, when the user browses the rail) substitutes the starter
    // income exactly the same way rather than keeping a second fallback.
    effectiveIncome,
    isIncomeLoaded: monthlyIncome > 0,
  };
}