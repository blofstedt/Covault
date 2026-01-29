
import React, { useState } from 'react';
import { BudgetCategory, Transaction } from '../types';
import TransactionItem from './TransactionItem';
import { getBudgetIcon } from './Dashboard';

interface ExtendedBudgetCategory extends BudgetCategory {
  externalDeduction?: number;
}

interface BudgetSectionProps {
  budget: ExtendedBudgetCategory;
  transactions: Transaction[];
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateBudget: (b: BudgetCategory) => void;
  onDeleteRequest: (id: string) => void;
  onEdit: (tx: Transaction) => void;
  currentUserName: string;
  isSharedView: boolean;
  allBudgets?: BudgetCategory[];
}

const BudgetSection: React.FC<BudgetSectionProps> = ({
  budget, transactions, isExpanded, onToggle, onUpdateBudget, onDeleteRequest, onEdit, currentUserName, isSharedView, allBudgets
}) => {
  const [isEditingLimit, setIsEditingLimit] = useState(false);
  const [newLimit, setNewLimit] = useState(budget.totalLimit.toString());

  const getAmountForThisBudget = (tx: Transaction) => {
    if (tx.splits && tx.splits.length > 0) {
      const split = tx.splits.find(s => s.budget_id === budget.id);
      return split ? split.amount : 0;
    }
    return tx.budget_id === budget.id ? tx.amount : 0;
  };

  const spent = transactions.reduce((acc, tx) => acc + (tx.is_projected ? 0 : getAmountForThisBudget(tx)), 0);
  const projected = transactions.reduce((acc, tx) => acc + (tx.is_projected ? getAmountForThisBudget(tx) : 0), 0);
  const external = budget.externalDeduction || 0;
  const total = spent + external + projected;
  const isDanger = total > budget.totalLimit;

  const spentWidth = Math.min(100, (spent / budget.totalLimit) * 100);
  const externalWidth = Math.min(100 - spentWidth, (external / budget.totalLimit) * 100);
  const projectedWidth = Math.min(100 - spentWidth - externalWidth, (projected / budget.totalLimit) * 100);

  return (
    <div className={`flex-1 h-full overflow-hidden transition-all duration-[700ms] rounded-[2.5rem] border relative flex flex-col bg-white dark:bg-slate-900 ${isExpanded ? 'ease-in border-emerald-300 dark:border-emerald-800 shadow-2xl' : 'ease-out border-slate-100 dark:border-slate-800/60 shadow-sm'}`}>
      <div className="absolute inset-0 z-0 pointer-events-none flex">
        <div
          style={{ width: `${spentWidth}%` }}
          className={`h-full transition-all duration-[700ms] ease-out relative ${isExpanded ? 'animate-breathe' : ''} bg-emerald-400/30 dark:bg-emerald-500/40`}
        >
          {spentWidth > 0 && (
            <div className="absolute right-[-5px] top-0 w-[10px] overflow-hidden pointer-events-none" style={{ height: '100%' }}>
              <svg
                className={isExpanded ? 'sine-wave-fast' : 'sine-wave-slow'}
                width="10"
                style={{ position: 'absolute', top: '-60px', left: 0, height: 'calc(100% + 120px)' }}
                viewBox="0 0 10 120"
                preserveAspectRatio="none"
              >
                <path
                  d="M5 0 Q10 15 5 30 Q0 45 5 60 Q10 75 5 90 Q0 105 5 120"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="1.5"
                  strokeOpacity="0.5"
                />
              </svg>
            </div>
          )}
        </div>
        {external > 0 && (
          <div style={{ width: `${externalWidth}%` }} className={`h-full bg-rose-400/30 dark:bg-rose-500/40 transition-all duration-[700ms] ease-out relative ${isExpanded ? 'animate-breathe' : ''}`}>
            <div className="absolute right-[-5px] top-0 w-[10px] overflow-hidden pointer-events-none" style={{ height: '100%' }}>
              <svg
                className={isExpanded ? 'sine-wave-fast' : 'sine-wave-slow'}
                width="10"
                style={{ position: 'absolute', top: '-60px', left: 0, height: 'calc(100% + 120px)' }}
                viewBox="0 0 10 120"
                preserveAspectRatio="none"
              >
                <path
                  d="M5 0 Q10 15 5 30 Q0 45 5 60 Q10 75 5 90 Q0 105 5 120"
                  fill="none"
                  stroke="#F43F5E"
                  strokeWidth="1.5"
                  strokeOpacity="0.5"
                />
              </svg>
            </div>
          </div>
        )}
        <div style={{ width: `${projectedWidth}%` }} className="h-full budget-bar-dashed transition-all duration-[700ms] ease-out opacity-20 text-emerald-400 dark:text-emerald-800" />
        {isDanger && <div className="flex-1 h-full bg-rose-500/10 dark:bg-rose-500/20" />}
      </div>

      <div onClick={onToggle} className={`relative z-10 flex-1 px-8 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all ${isExpanded ? 'flex-none py-10' : 'py-3'}`}>
        <div className="flex items-center space-x-6">
          <div className={`p-3 rounded-2xl transition-all duration-700 ${isExpanded ? 'bg-emerald-600 text-white shadow-lg scale-110 p-3.5' : 'bg-white/80 dark:bg-slate-800 text-slate-400 dark:text-slate-500 shadow-sm'}`}>
            {getBudgetIcon(budget.name)}
          </div>
          <div className="flex flex-col text-left">
            <h3 className="text-base font-black tracking-tight leading-none uppercase transition-colors duration-700 text-slate-500 dark:text-slate-100">{budget.name}</h3>
            {!isExpanded && (
              <span className={`text-[10px] font-black uppercase tracking-[0.15em] mt-1.5 transition-colors duration-700 ${isDanger ? 'text-rose-500' : 'text-slate-400 dark:text-slate-500'}`}>
                {isDanger ? `Over: $${Math.max(0, total - budget.totalLimit).toFixed(0)}` : `$${Math.max(0, budget.totalLimit - total).toFixed(0)} left`}
              </span>
            )}
          </div>
        </div>

        <div className="text-right flex flex-col items-end">
          <div className="flex items-baseline space-x-1">
            {isExpanded && !isEditingLimit && (
              <span className={`text-sm font-black mr-2 tracking-tight transition-colors duration-700 ${isDanger ? 'text-rose-500' : 'text-slate-500'}`}>
                ${spent.toFixed(0)}
                <span className="mx-1.5 opacity-30 font-medium text-slate-400">/</span>
              </span>
            )}

            {isEditingLimit ? (
              <input
                autoFocus type="number" value={newLimit} onClick={e => e.stopPropagation()}
                onBlur={() => { onUpdateBudget({...budget, totalLimit: parseFloat(newLimit) || 0}); setIsEditingLimit(false); }}
                onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                onChange={e => setNewLimit(e.target.value)}
                className="w-20 bg-white dark:bg-slate-900 text-right font-black text-base p-1 rounded-lg border-2 border-emerald-500 outline-none text-slate-700 dark:text-slate-100"
              />
            ) : (
              <div className="flex items-center">
                <span className="text-2xl font-black tracking-tighter leading-none transition-colors duration-700 text-slate-500 dark:text-slate-100">${budget.totalLimit}</span>
                {isExpanded && (
                  <button onClick={e => { e.stopPropagation(); setIsEditingLimit(true); }} className="ml-2 p-1 transition-colors text-slate-300 hover:text-emerald-500">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572" /></svg>
                  </button>
                )}
              </div>
            )}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest mt-0.5 transition-colors duration-700 text-slate-400 dark:text-slate-600">
            {isExpanded ? 'Vault Capacity' : (isSharedView ? 'Our Target' : 'My Target')}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 animate-in fade-in slide-in-from-top-2 duration-500 relative z-10">
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-between px-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] transition-colors duration-700 text-slate-400 dark:text-slate-500">
                {isSharedView ? 'Our Activity History' : 'Activity History'}
              </span>
            </div>

            <div className="space-y-0">
              {transactions.length > 0 ? (
                transactions.map(tx => (
                  <TransactionItem
                    key={tx.id} transaction={tx} onDeleteRequest={onDeleteRequest} onEdit={onEdit}
                    currentUserName={currentUserName} isSharedView={isSharedView} currentBudgetId={budget.id}
                    budgets={allBudgets}
                  />
                ))
              ) : (
                <div className="py-16 text-center text-[11px] font-black uppercase tracking-widest text-slate-200 dark:text-slate-800">No entries found</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetSection;
