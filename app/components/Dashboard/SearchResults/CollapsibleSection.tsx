import React, { useState } from 'react';
import type { Transaction, BudgetCategory } from '../../../types';
import TransactionItem from '../../transactions/TransactionItem';

type SearchResultTransaction = Transaction & { category_id?: string };

interface CollapsibleSectionProps {
  title: string;
  subtitle: string;
  transactions: SearchResultTransaction[];
  currentUserName: string;
  isSharedAccount: boolean;
  budgets: BudgetCategory[];
  onTransactionTap: (tx: Transaction) => void;
  matchedExpenseIds: Set<string>;
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
  matchedExpenseIds,
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
          <span className="text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500">
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
              onTap={onTransactionTap}
              currentUserName={currentUserName}
              isSharedView={isSharedAccount}
              budgets={budgets}
              showBudgetIcon={true}
              isRefunded={matchedExpenseIds.has(tx.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};


export default CollapsibleSection;
