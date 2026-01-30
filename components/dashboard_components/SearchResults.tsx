// components/dashboard_components/SearchResults.tsx
import React, { useState, useMemo } from 'react';
import type { Transaction, BudgetCategory } from '../../types';
import TransactionItem from '../TransactionItem';

/**
 * Helper: add months to a Date
 */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Helper: end of month for a given Date
 */
function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Generate projected recurring transactions (Biweekly / Monthly)
 * from existing real transactions, **only in the future**, up to
 * two months after the end of the current month.
 *
 * We never save these to the DB; they're just for UI/search.
 */
function generateProjectedTransactions(base: Transaction[]): Transaction[] {
  const today = new Date();
  const endCurrentMonth = endOfMonth(today);
  const projectionEnd = endOfMonth(addMonths(endCurrentMonth, 2));

  // Avoid duplicating real transactions
  const realKeys = new Set(
    base.map((tx) => {
      const isoDate = new Date(tx.date).toISOString().slice(0, 10);
      return `${tx.vendor}|${tx.amount}|${isoDate}|${tx.budget_id}`;
    }),
  );

  const projected: Transaction[] = [];

  for (const tx of base) {
    if (tx.recurrence === 'One-time') continue;
    if (tx.is_projected) continue; // don't chain off generated ones

    let current = new Date(tx.date);

    // Walk forward in time until we pass the projectionEnd
    while (current <= projectionEnd) {
      const isoDate = current.toISOString().slice(0, 10);
      const key = `${tx.vendor}|${tx.amount}|${isoDate}|${tx.budget_id}`;

      // Only generate future occurrences (today or later),
      // and skip any that already exist as real transactions.
      if (current >= today && !realKeys.has(key)) {
        projected.push({
          ...tx,
          id: `projected-${tx.id}-${isoDate}`,
          date: isoDate,
          is_projected: true,
        });
      }

      // Step by recurrence
      if (tx.recurrence === 'Biweekly') {
        current.setDate(current.getDate() + 14);
      } else if (tx.recurrence === 'Monthly') {
        current = addMonths(current, 1);
      } else {
        break;
      }
    }
  }

  return projected;
}

interface CollapsibleSectionProps {
  title: string;
  subtitle: string;
  transactions: Transaction[];
  currentUserName: string;
  isSharedAccount: boolean;
  budgets: BudgetCategory[];
}

/**
 * Covault-style collapsible section for Past / Future results.
 */
const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  subtitle,
  transactions,
  currentUserName,
  isSharedAccount,
  budgets,
}) => {
  const [open, setOpen] = useState(false);

  if (transactions.length === 0) return null;

  return (
    <div className="mt-4">
      {/* Header row (button) */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-100/90 dark:bg-slate-900/80 border border-slate-200/60 dark:border-slate-800/80 active:scale-[0.99] transition-all"
      >
        <div className="flex flex-col items-start text-left">
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
            {title}
          </span>
          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">
            {subtitle} • {transactions.length} entr
            {transactions.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <span className="text-[11px] font-black text-slate-400 dark:text-slate-500">
          {open ? 'HIDE' : 'SHOW'}
        </span>
      </button>

      {/* Section body */}
      {open && (
        <div className="mt-3 space-y-2">
          {transactions.map((tx) => {
            const budgetIdForTx =
              tx.splits && tx.splits.length > 0
                ? tx.splits[0].budget_id
                : tx.budget_id;

            return (
              <TransactionItem
                key={tx.id}
                transaction={tx}
                // In search view we usually don’t edit/delete directly.
                onDeleteRequest={() => {}}
                onEdit={() => {}}
                currentUserName={currentUserName}
                isSharedView={isSharedAccount}
                // Pass currentBudgetId so TransactionItem can show the correct icon
                currentBudgetId={budgetIdForTx}
                // For split/amount formatting, we still pass all budgets
                budgets={budgets}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

interface SearchResultsProps {
  searchQuery: string;
  currentMonthTransactions: Transaction[];
  pastTransactions: Transaction[];
  futureTransactions: Transaction[];
  currentUserName: string;
  isSharedAccount: boolean;
  budgets: BudgetCategory[];
}

/**
 * Main search results panel:
 * - Shows THIS MONTH'S matches inline (same style as the dashboard list)
 * - Plus collapsible Past / Future sections for matching transactions
 * - NOW also includes PROJECTED recurring transactions (biweekly/monthly)
 *   up to 2 months after the end of the current month.
 */
const SearchResults: React.FC<SearchResultsProps> = ({
  searchQuery,
  currentMonthTransactions,
  pastTransactions,
  futureTransactions,
  currentUserName,
  isSharedAccount,
  budgets,
}) => {
  const q = searchQuery.toLowerCase().trim();

  const filterFn = (tx: Transaction) =>
    tx.vendor.toLowerCase().includes(q);

  // Combine all known transactions so we can generate projections.
  const allBaseTransactions = useMemo(
    () => [
      ...pastTransactions,
      ...currentMonthTransactions,
      ...futureTransactions,
    ],
    [pastTransactions, currentMonthTransactions, futureTransactions],
  );

  // Generate projected recurring transactions just for UI/search.
  const projectedTransactions = useMemo(
    () => generateProjectedTransactions(allBaseTransactions),
    [allBaseTransactions],
  );

  // Split projected ones into "this month" vs "future after this month"
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const endCurrentMonth = endOfMonth(now);

  const projectedCurrentMonth = useMemo(
    () =>
      projectedTransactions.filter((tx) => {
        const d = new Date(tx.date);
        return (
          d.getFullYear() === currentYear &&
          d.getMonth() === currentMonth
        );
      }),
    [projectedTransactions, currentYear, currentMonth],
  );

  const projectedFuture = useMemo(
    () =>
      projectedTransactions.filter((tx) => {
        const d = new Date(tx.date);
        return d > endCurrentMonth;
      }),
    [projectedTransactions, endCurrentMonth],
  );

  // Augment the existing sets with projected ones
  const augmentedCurrent = useMemo(
    () => [...currentMonthTransactions, ...projectedCurrentMonth],
    [currentMonthTransactions, projectedCurrentMonth],
  );

  const augmentedFuture = useMemo(
    () => [...futureTransactions, ...projectedFuture],
    [futureTransactions, projectedFuture],
  );

  // Apply search filter
  const filteredCurrent = useMemo(
    () => augmentedCurrent.filter(filterFn),
    [augmentedCurrent, q],
  );

  const filteredPast = useMemo(
    () => pastTransactions.filter(filterFn),
    [pastTransactions, q],
  );

  const filteredFuture = useMemo(
    () => augmentedFuture.filter(filterFn),
    [augmentedFuture, q],
  );

  const hasAnyResults =
    filteredCurrent.length > 0 ||
    filteredPast.length > 0 ||
    filteredFuture.length > 0;

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar mt-3">
      <div className="px-2 pb-8 space-y-4">
        {/* Label for current search scope */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 dark:text-slate-600">
            Search Results
          </span>
          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">
            “{searchQuery}”
          </span>
        </div>

        {/* CURRENT MONTH RESULTS (including projected) */}
        {filteredCurrent.length > 0 && (
          <div className="space-y-2">
            <div className="px-1">
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                This Month
              </span>
            </div>

            <div className="space-y-2">
              {filteredCurrent.map((tx) => {
                const budgetIdForTx =
                  tx.splits && tx.splits.length > 0
                    ? tx.splits[0].budget_id
                    : tx.budget_id;

                return (
                  <TransactionItem
                    key={tx.id}
                    transaction={tx}
                    onDeleteRequest={() => {}}
                    onEdit={() => {}}
                    currentUserName={currentUserName}
                    isSharedView={isSharedAccount}
                    currentBudgetId={budgetIdForTx}
                    budgets={budgets}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* PAST SECTION */}
        <CollapsibleSection
          title="Past Transactions"
          subtitle="Before this month"
          transactions={filteredPast}
          currentUserName={currentUserName}
          isSharedAccount={isSharedAccount}
          budgets={budgets}
        />

        {/* FUTURE SECTION (real + projected) */}
        <CollapsibleSection
          title="Future Transactions"
          subtitle="After this month"
          transactions={filteredFuture}
          currentUserName={currentUserName}
          isSharedAccount={isSharedAccount}
          budgets={budgets}
        />

        {/* NO RESULTS STATE */}
        {!hasAnyResults && (
          <div className="pt-10 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.25em] text-slate-300 dark:text-slate-600">
              No entries found
            </p>
            <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-2">
              Try a different vendor name or check another month.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchResults;
