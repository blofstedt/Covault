import React, { useMemo } from 'react';
import { Transaction, BudgetCategory } from '../types';

import { getBudgetIcon } from './dashboard_components/getBudgetIcon';

interface TransactionItemProps {
  transaction: Transaction;
  onTap: (tx: Transaction) => void;
  currentUserName: string;
  isSharedView: boolean;
  currentBudgetId?: string;
  budgets?: BudgetCategory[];
  showBudgetIcon?: boolean;
}

const TransactionItem: React.FC<TransactionItemProps> = ({
  transaction,
  onTap,
  currentUserName,
  isSharedView,
  currentBudgetId,
  budgets,
  showBudgetIcon = false,
}) => {

  const displayAmount = useMemo(() => {
    if (transaction.splits && transaction.splits.length > 0 && currentBudgetId) {
      const split = transaction.splits.find((s) => s.budget_id === currentBudgetId);
      return split ? split.amount : transaction.amount;
    }
    return transaction.amount;
  }, [transaction, currentBudgetId]);

  const budget = useMemo(() => {
    if (!budgets || !showBudgetIcon) return null;
    const budgetId = transaction.splits && transaction.splits.length > 0
      ? transaction.splits[0].budget_id
      : transaction.budget_id;
    return budgets.find(b => b.id === budgetId);
  }, [budgets, transaction, showBudgetIcon]);

  const isFutureTransaction = useMemo(() => {
    if (transaction.is_projected) return false;
    const [y, m, d] = transaction.date.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d) > new Date();
  }, [transaction.date, transaction.is_projected]);

  const isOtherUser = isSharedView && transaction.userName !== currentUserName;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onTap(transaction);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-[2rem]">
      {/* Foreground content - now clickable */}
      <button
        onClick={() => onTap(transaction)}
        onKeyDown={handleKeyDown}
        className="relative z-10 p-5 rounded-[2rem] backdrop-blur-xl border shadow-sm bg-white/80 dark:bg-slate-900/80 border-slate-200/40 dark:border-slate-700/40 cursor-pointer hover:bg-white/90 dark:hover:bg-slate-900/90 active:scale-[0.98] transition-all w-full text-left"
        aria-label={`Transaction: ${transaction.vendor}, ${transaction.amount.toFixed(2)} dollars on ${(() => { const [y, m, d] = transaction.date.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(); })()}`}
      >
        <div className="flex items-center justify-between">
          {/* Budget icon on the left for search results */}
          {showBudgetIcon && budget && (
            <div className="flex-shrink-0 mr-3 p-2 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500">
              {getBudgetIcon(budget.name)}
            </div>
          )}
          
          <div className="flex flex-col text-left flex-1">
            <div className="flex items-center space-x-2">
              <span className="font-black text-[14px] text-slate-500 dark:text-slate-100 tracking-tight leading-none uppercase">
                {transaction.vendor}
              </span>
              {isSharedView && (
                <span
                  className={`text-[9px] font-black px-2 py-0.5 rounded-full tracking-widest transition-colors duration-700 ${
                    isOtherUser
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {transaction.userName?.split(' ')[0]}
                </span>
              )}
            </div>

            {/* Date, badges, and flag button */}
            <div className="flex flex-col mt-2 space-y-1">
              {/* Date + recurrence + projected */}
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">
                  {(() => {
                    const [y, m, d] = transaction.date.slice(0, 10).split('-').map(Number);
                    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    });
                  })()}
                </span>

                {transaction.recurrence !== 'One-time' && (
                  <span className="text-[8px] font-black text-slate-500 dark:text-slate-400 flex items-center uppercase tracking-[0.15em] bg-slate-100/50 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
                    {transaction.recurrence}
                  </span>
                )}

                {transaction.is_projected && (
                  <span className="text-[8px] font-black text-amber-500 dark:text-amber-400 uppercase tracking-[0.15em] bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md">
                    Projected
                  </span>
                )}

                {isFutureTransaction && (
                  <span className="text-[8px] font-black text-blue-500 dark:text-blue-400 uppercase tracking-[0.15em] bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-md">
                    Future
                  </span>
                )}
              </div>

              {/* Description */}
              {transaction.description && (
                <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 italic truncate max-w-[200px]">
                  {transaction.description}
                </span>
              )}

            </div>
          </div>

          <div className="text-right">
            <div
              className={`text-lg font-black tracking-tighter ${
                transaction.is_projected
                  ? 'text-slate-300 dark:text-slate-700'
                  : 'text-slate-500 dark:text-slate-50'
              }`}
            >
              ${displayAmount.toFixed(2)}
            </div>
            {transaction.splits && transaction.splits.length > 0 && (
              <div className="text-[8px] text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-[0.2em] mt-0.5">
                Split Vault
              </div>
            )}
          </div>
        </div>
      </button>
    </div>
  );
};

export default TransactionItem;
