// components/dashboard_components/SearchResults.tsx
import React, { useState, useMemo, useEffect } from 'react';
import type { Transaction, BudgetCategory } from '../../types';
import TransactionItem from '../TransactionItem';
import { generateProjectedTransactions } from '../../lib/projectedTransactions';
import { EmptyState } from '../shared';

interface CollapsibleSectionProps {
  title: string;
  subtitle: string;
  transactions: Transaction[];
  currentUserName: string;
  isSharedAccount: boolean;
  budgets: BudgetCategory[];
  onTransactionTap: (tx: Transaction) => void;
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
  onTransactionTap,
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
          {transactions.map((tx: any) => {
            const budgetIdForTx = tx.budget_id ?? tx.category_id;

            return (
              <TransactionItem
                key={tx.id}
                transaction={tx}
                onTap={onTransactionTap}
                currentUserName={currentUserName}
                isSharedView={isSharedAccount}
                currentBudgetId={budgetIdForTx}
                budgets={budgets}
                showBudgetIcon={true}
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
  allTransactions: Transaction[];
  currentUserName: string;
  isSharedAccount: boolean;
  budgets: BudgetCategory[];
  onTransactionTap: (tx: Transaction) => void;
}

const getCurrentYearMonth = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const SearchResults: React.FC<SearchResultsProps> = ({
  searchQuery,
  currentMonthTransactions,
  pastTransactions,
  futureTransactions,
  allTransactions,
  currentUserName,
  isSharedAccount,
  budgets,
  onTransactionTap,
}) => {
  const q = searchQuery.toLowerCase().trim();

  const filterFn = (tx: Transaction) => tx.vendor.toLowerCase().includes(q);

  const projectedTransactions = useMemo(
    () => generateProjectedTransactions(allTransactions),
    [allTransactions],
  );

  const txYearMonth = (dateStr: string) => dateStr.slice(0, 7);

  const [currentYearMonth, setCurrentYearMonth] = useState(getCurrentYearMonth);

  useEffect(() => {
    const checkMonth = () => {
      setCurrentYearMonth((prev) => {
        const newYearMonth = getCurrentYearMonth();
        return prev !== newYearMonth ? newYearMonth : prev;
      });
    };

    checkMonth();
    const interval = setInterval(checkMonth, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const projectedCurrentMonth = useMemo(
    () => projectedTransactions.filter((tx) => txYearMonth(tx.date) === currentYearMonth),
    [projectedTransactions, currentYearMonth],
  );

  const projectedFuture = useMemo(
    () => projectedTransactions.filter((tx) => txYearMonth(tx.date) !== currentYearMonth),
    [projectedTransactions, currentYearMonth],
  );

  const augmentedCurrent = useMemo(
    () => [...currentMonthTransactions, ...projectedCurrentMonth],
    [currentMonthTransactions, projectedCurrentMonth],
  );

  const augmentedFuture = useMemo(
    () => [...futureTransactions, ...projectedFuture],
    [futureTransactions, projectedFuture],
  );

  const filteredCurrent = useMemo(() => augmentedCurrent.filter(filterFn), [augmentedCurrent, q]);
  const filteredPast = useMemo(() => pastTransactions.filter(filterFn), [pastTransactions, q]);
  const filteredFuture = useMemo(() => augmentedFuture.filter(filterFn), [augmentedFuture, q]);

  const hasAnyResults = filteredCurrent.length > 0 || filteredPast.length > 0 || filteredFuture.length > 0;

  return (
    <div className="flex-1 overflow-y-auto no-scrollbar mt-3">
      <div className="px-2 pb-8 space-y-4">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-300 dark:text-slate-600">
            Search Results
          </span>
          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500">
            “{searchQuery}”
          </span>
        </div>

        {filteredCurrent.length > 0 && (
          <div className="space-y-2">
            <div className="px-1">
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                This Month
              </span>
            </div>

            <div className="space-y-2">
              {filteredCurrent.map((tx: any) => {
                const budgetIdForTx = tx.budget_id ?? tx.category_id;

                return (
                  <TransactionItem
                    key={tx.id}
                    transaction={tx}
                    onTap={onTransactionTap}
                    currentUserName={currentUserName}
                    isSharedView={isSharedAccount}
                    currentBudgetId={budgetIdForTx}
                    budgets={budgets}
                    showBudgetIcon={true}
                  />
                );
              })}
            </div>
          </div>
        )}

        <CollapsibleSection
          title="Past Transactions"
          subtitle="Before this month"
          transactions={filteredPast}
          currentUserName={currentUserName}
          isSharedAccount={isSharedAccount}
          budgets={budgets}
          onTransactionTap={onTransactionTap}
        />

        {filteredFuture.filter(tx => !tx.is_projected).length > 0 && (
          <CollapsibleSection
            title="Future Transactions"
            subtitle="Scheduled future entries"
            transactions={filteredFuture.filter(tx => !tx.is_projected)}
            currentUserName={currentUserName}
            isSharedAccount={isSharedAccount}
            budgets={budgets}
            onTransactionTap={onTransactionTap}
          />
        )}

        {filteredFuture.filter(tx => tx.is_projected).length > 0 && (
          <CollapsibleSection
            title="Projected Transactions"
            subtitle="Based on recurring entries"
            transactions={filteredFuture.filter(tx => tx.is_projected)}
            currentUserName={currentUserName}
            isSharedAccount={isSharedAccount}
            budgets={budgets}
            onTransactionTap={onTransactionTap}
          />
        )}

        {!hasAnyResults && (
          <EmptyState
            message="No entries found"
            description="Try a different vendor name or check another month."
          />
        )}
      </div>
    </div>
  );
};

export default SearchResults;
