import React, { useMemo } from 'react';
import { Transaction } from '../types';
import { FlagTransactionButton } from './FlagTransactionButton';

interface TransactionItemProps {
  transaction: Transaction;
  onTap: (tx: Transaction) => void;
  currentUserName: string;
  isSharedView: boolean;
  currentBudgetId?: string;
  budgets?: any[];
}

const TransactionItem: React.FC<TransactionItemProps> = ({
  transaction,
  onTap,
  currentUserName,
  isSharedView,
  currentBudgetId,
}) => {

  const displayAmount = useMemo(() => {
    if (transaction.splits && transaction.splits.length > 0 && currentBudgetId) {
      const split = transaction.splits.find((s) => s.budget_id === currentBudgetId);
      return split ? split.amount : transaction.amount;
    }
    return transaction.amount;
  }, [transaction, currentBudgetId]);

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
        aria-label={`Transaction: ${transaction.vendor}, ${transaction.amount.toFixed(2)} dollars on ${new Date(transaction.date).toLocaleDateString()}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col text-left">
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
                  {new Date(transaction.date).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
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
              </div>

              {/* "This looks wrong" button (only for auto‑added + parsed notifications) */}
              {transaction.label === 'Auto-Added' &&
                transaction.notification_rule_id &&
                transaction.raw_notification && (
                  <FlagTransactionButton
                    user={{
                      id: transaction.user_id,
                      name: transaction.userName ?? '',
                      email: '',
                      hasJointAccounts: false,
                      budgetingSolo: true,
                      monthlyIncome: 0,
                    }}
                    transaction={transaction}
                  />
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
