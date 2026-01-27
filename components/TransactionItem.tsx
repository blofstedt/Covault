
import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';

interface TransactionItemProps {
  transaction: Transaction;
  onDeleteRequest: (id: string) => void;
  onEdit: (tx: Transaction) => void;
  currentUserName: string;
  isSharedView: boolean;
  currentBudgetId?: string;
  budgets?: any[]; 
}

const TransactionItem: React.FC<TransactionItemProps> = ({ 
  transaction, 
  onDeleteRequest, 
  onEdit, 
  currentUserName, 
  isSharedView,
  currentBudgetId
}) => {
  const [showActions, setShowActions] = useState(false);

  const displayAmount = useMemo(() => {
    if (transaction.splits && transaction.splits.length > 0 && currentBudgetId) {
      const split = transaction.splits.find(s => s.budget_id === currentBudgetId);
      return split ? split.amount : transaction.amount;
    }
    return transaction.amount;
  }, [transaction, currentBudgetId]);

  const isOtherUser = isSharedView && transaction.userName !== currentUserName;

  return (
    <div 
      onClick={() => setShowActions(!showActions)}
      className={`group relative p-5 rounded-[2rem] transition-all duration-500 cursor-pointer mb-3
        ${showActions 
          ? 'bg-white/90 dark:bg-slate-800/80 shadow-2xl scale-[1.02] border-emerald-500/40 z-20' 
          : 'bg-white/20 dark:bg-slate-900/20 hover:bg-white/40 dark:hover:bg-slate-800/30 active:scale-[0.98] border-white/10 dark:border-slate-700/40'
        }
        backdrop-blur-xl border shadow-sm
      `}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col text-left">
          <div className="flex items-center space-x-2">
            <span className="font-black text-[14px] text-slate-500 dark:text-slate-100 tracking-tight leading-none uppercase">{transaction.vendor}</span>
            {isSharedView && (
              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full tracking-widest transition-colors duration-700 ${isOtherUser ? 'bg-emerald-950 text-emerald-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
                {transaction.userName.split(' ')[0]}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-tight">
              {new Date(transaction.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
            {transaction.recurrence !== 'One-time' && (
              <span className="text-[8px] font-black text-slate-500 dark:text-slate-400 flex items-center uppercase tracking-[0.15em] bg-slate-100/50 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
                {transaction.recurrence}
              </span>
            )}
          </div>
        </div>
        
        <div className="text-right">
          <div className={`text-lg font-black tracking-tighter ${transaction.is_projected ? 'text-slate-300 dark:text-slate-700' : 'text-slate-500 dark:text-slate-50'}`}>
            ${displayAmount.toFixed(2)}
          </div>
          {transaction.splits && transaction.splits.length > 0 && (
            <div className="text-[8px] text-emerald-600 dark:text-emerald-400 font-black uppercase tracking-[0.2em] mt-0.5">Split Vault</div>
          )}
        </div>
      </div>

      {showActions && (
        <div className="flex items-center justify-end space-x-8 mt-5 pt-5 border-t border-slate-200/30 dark:border-slate-700/30 animate-in fade-in slide-in-from-top-1 duration-300">
          <button 
            onClick={(e) => { e.stopPropagation(); onEdit(transaction); }}
            className="flex items-center text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.2em] hover:scale-110 transition-transform"
          >
            <svg className="w-3.5 h-3.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572" /></svg>
            Edit
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onDeleteRequest(transaction.id); }}
            className="flex items-center text-[10px] font-black text-rose-500 uppercase tracking-[0.2em] hover:scale-110 transition-transform"
          >
            <svg className="w-3.5 h-3.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7" /></svg>
            Remove
          </button>
        </div>
      )}
    </div>
  );
};

export default TransactionItem;
