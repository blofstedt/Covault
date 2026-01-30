// components/dashboard_components/SearchResults.tsx
import React, { useState, useMemo } from 'react';
import type { Transaction, BudgetCategory } from '../../types';
import TransactionItem from '../TransactionItem';

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
            {subtitle} • {transactions.length} entr{transactions.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <span className="text-[11px] font-black text-slate-400 dark:text-slate-500">
          {open ? 'HIDE' : 'SHOW'}
        </span>
      </button>

      {/* Section body */}
      {open && (
        <div className="mt-3 space-y-2">
          {transactions.map((tx) => (
            <TransactionItem
              key={tx.id}
              transaction={tx}
              // In search view we usually don’t edit/delete directly.
              // If you want that later, you can pass real handlers here.
              onDeleteRequest={() => {}}
              onEdit={() => {}}
              currentUserName={currentUserName}
              isSharedView={isSharedAccount}
              // For split/amount formatting, we still pass all budgets
              budgets={budgets}
            />
          ))}
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

  const filteredCurrent = useMemo(
    () => currentMonthTransactions.filter(filterFn),
    [currentMonthTransactions, q],
  );

  const filteredPast = useMemo(
    () => pastTransactions.filter(filterFn),
    [pastTransactions, q],
  );

  const filteredFuture = useMemo(
    () => futureTransactions.filter(filterFn),
    [futureTransactions, q],
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

        {/* CURRENT MONTH RESULTS */}
        {filteredCurrent.length > 0 && (
          <div className="space-y-2">
            <div className="px-1">
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                This Month
              </span>
            </div>

            <div className="space-y-2">
              {filteredCurrent.map((tx) => (
                <TransactionItem
                  key={tx.id}
                  transaction={tx}
                  onDeleteRequest={() => {}}
                  onEdit={() => {}}
                  currentUserName={currentUserName}
                  isSharedView={isSharedAccount}
                  budgets={budgets}
                />
              ))}
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

        {/* FUTURE SECTION */}
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
