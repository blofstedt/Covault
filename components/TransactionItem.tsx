import React, { useMemo } from 'react';
import { Transaction, BudgetCategory } from '../types';
import { parseLocalDate } from '../lib/dateUtils';

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

  const budget = useMemo(() => {
    if (!budgets || !showBudgetIcon) return null;
    const budgetId = transaction.budget_id;
    return budgets.find(b => b.id === budgetId);
  }, [budgets, transaction, showBudgetIcon]);

  const isFutureTransaction = useMemo(() => {
    if (transaction.is_projected) return false;
    return parseLocalDate(transaction.date) > new Date();
  }, [transaction.date, transaction.is_projected]);

  const isOtherUser = isSharedView && transaction.userName !== currentUserName;
  const txAmount = typeof transaction.amount === 'number' ? transaction.amount : Number(transaction.amount) || 0;
  const isRefund = txAmount < 0;

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
        className="relative z-10 p-4 rounded-[2rem] backdrop-blur-xl border shadow-sm ring-1 ring-inset ring-white/10 dark:ring-white/[0.03] bg-white/80 dark:bg-slate-900/80 border-slate-200/40 dark:border-slate-700/40 cursor-pointer hover:bg-white/90 dark:hover:bg-slate-900/90 active:scale-[0.98] transition-all duration-200 w-full text-left"
        aria-label={`Transaction: ${transaction.vendor}, ${Math.abs(txAmount).toFixed(2)} dollars on ${parseLocalDate(transaction.date).toLocaleDateString()}`}
      >
        <div className="flex items-center justify-between">
          {/* Budget icon on the left for search results */}
          {showBudgetIcon && budget && (
            <div className="flex-shrink-0 mr-3 p-2 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500">
              {getBudgetIcon(budget.name)}
            </div>
          )}
          
          <div className="flex flex-col text-left flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[14px] text-slate-600 dark:text-slate-100 tracking-tight leading-none">
                {transaction.vendor}
              </span>
              {isSharedView && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wide transition-colors duration-700 ${
                    isOtherUser
                      ? 'bg-emerald-950 text-emerald-400'
                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {transaction.userName?.split(' ')[0]}
                </span>
              )}

              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 tracking-tight">
                {parseLocalDate(transaction.date).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>

              {transaction.recurrence !== 'One-time' && (
                <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400 flex items-center tracking-wide bg-slate-100/50 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
                  {transaction.recurrence}
                </span>
              )}

              {transaction.is_projected && (
                <span className="text-[8px] font-bold text-amber-500 dark:text-amber-400 tracking-wide bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-md">
                  Projected
                </span>
              )}

              {isFutureTransaction && (
                <span className="text-[8px] font-bold text-blue-500 dark:text-blue-400 tracking-wide bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-md">
                  Future
                </span>
              )}

              {transaction.label === 'Automatic' && (
                <span className="text-[8px] font-bold text-violet-500 dark:text-violet-400 tracking-wide bg-violet-50 dark:bg-violet-900/20 px-2 py-0.5 rounded-md">
                  AI
                </span>
              )}

              {isRefund && (
                <span className="text-[8px] font-bold text-emerald-500 dark:text-emerald-400 tracking-wide bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-md">
                  {transaction.is_income ? 'Income' : 'Refund'}
                </span>
              )}
            </div>
          </div>

          <div className="text-right">
            <div
              className={`text-lg font-black tracking-tighter ${
                isRefund
                  ? 'text-emerald-500 dark:text-emerald-400'
                  : transaction.is_projected
                    ? 'text-slate-300 dark:text-slate-700'
                    : 'text-slate-500 dark:text-slate-50'
              }`}
            >
              {isRefund ? '+' : ''}${Math.abs(txAmount).toFixed(2)}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
};

export default TransactionItem;
