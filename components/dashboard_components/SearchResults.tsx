import React, { useState } from 'react';
import type { Transaction, BudgetCategory } from '../../types';
import TransactionItem from '../TransactionItem';

interface SectionProps {
  title: string;
  transactions: Transaction[];
  currentUserName: string;
  isSharedAccount: boolean;
  budgets: BudgetCategory[];
}

/** Reusable collapsible section for past/future */
const CollapsibleSection: React.FC<SectionProps> = ({
  title,
  transactions,
  currentUserName,
  isSharedAccount,
  budgets,
}) => {
  const [open, setOpen] = useState(false);

  if (transactions.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex justify-between items-center px-3 py-2 rounded-xl bg-slate-200/60 dark:bg-slate-800 text-[11px] font-black uppercase tracking-widest"
      >
        {title}
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {transactions.map((tx) => (
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

/** Main Search UI */
const SearchResults: React.FC<SearchResultsProps> = ({
  searchQuery,
  currentMonthTransactions,
  pastTransactions,
  futureTransactions,
  currentUserName,
  isSharedAccount,
  budgets,
}) => {
  const q = searchQuery.toLowerCase();

  const filterFn = (tx: Transaction) =>
    tx.vendor.toLowerCase().includes(q);

  const filteredCurrent = currentMonthTransactions.filter(filterFn);
  const filteredPast = pastTransactions.filter(filterFn);
  const filteredFuture = futureTransactions.filter(filterFn);

  return (
    <div className="px-3 pb-8">
      {/* CURRENT RESULTS */}
      {filteredCurrent.length > 0 && (
        <div className="space-y-3 mt-2">
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
      )}

      {/* PAST SECTION */}
      <CollapsibleSection
        title="Past Transactions"
        transactions={filteredPast}
        currentUserName={currentUserName}
        isSharedAccount={isSharedAccount}
        budgets={budgets}
      />

      {/* FUTURE SECTION */}
      <CollapsibleSection
        title="Future Transactions"
        transactions={filteredFuture}
        currentUserName={currentUserName}
        isSharedAccount={isSharedAccount}
        budgets={budgets}
      />

      {/* NO RESULTS */}
      {filteredCurrent.length === 0 &&
        filteredPast.length === 0 &&
        filteredFuture.length === 0 && (
          <div className="text-center text-[11px] font-black uppercase tracking-widest text-slate-400 mt-8">
            No transactions match your search
          </div>
      )}
    </div>
  );
};

export default SearchResults;
