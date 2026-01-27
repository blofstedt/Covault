
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
  mode?: 'Mine' | 'Ours';
}

const BudgetSection: React.FC<BudgetSectionProps> = ({ 
  budget, transactions, isExpanded, onToggle, onUpdateBudget, onDeleteRequest, onEdit, currentUserName, isSharedView, allBudgets, mode = 'Mine'
}) => {
  const [isEditingLimit, setIsEditingLimit] = useState(false);
  const [newLimit, setNewLimit] = useState(budget.totalLimit.toString());

  const isOursMode = mode === 'Ours';

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
    <div className={`flex-1 h-full overflow-hidden transition-all duration-[700ms] rounded-[2.5rem] border relative flex flex-col ${isExpanded ? 'ease-in border-emerald-300 dark:border-emerald-800 shadow-2xl' : 'ease-out border-slate-100 dark:border-slate-800/60 shadow-sm'} ${isOursMode ? 'bg-emerald-50 dark:bg-emerald-900/40 border-emerald-100 dark:border-emerald-800/50' : 'bg-white dark:bg-slate-900'}`}>
      <div className="absolute inset-0 z-0 pointer-events-none flex">
        <div 
          style={{ width: `${spentWidth}%` }} 
          className={`h-full transition-all duration-[700ms] ease-out relative ${isExpanded ? 'animate-breathe' : ''} ${isOursMode ? 'bg-emerald-600/10 dark:bg-emerald-800/40' : 'bg-emerald-400/30 dark:bg-emerald-500/40'}`}
        >
          {spentWidth > 0 && (
            <>
              <div className={`liquid-start ${isExpanded ? (isOursMode ? 'liquid-active-ours' : 'liquid-active') : (isOursMode ? 'liquid-ours' : 'liquid-calm')}`} />
              <div className={`liquid-edge ${isExpanded ? (isOursMode ? 'liquid-active-ours' : 'liquid-active') : (isOursMode ? 'liquid-ours' : 'liquid-calm')}`} />
            </>
          )}
        </div>
        {external > 0 && (
          <div style={{ width: `${externalWidth}%` }} className={`h-full bg-rose-400/30 dark:bg-rose-500/40 transition-all duration-[700ms] ease-out relative ${isExpanded ? 'animate-breathe' : ''}`}>
            <div className={`liquid-start ${isExpanded ? 'liquid-active-rose' : 'liquid-calm-rose'}`} />
            <div className={`liquid-edge ${isExpanded ? 'liquid-active-rose' : 'liquid-calm-rose'}`} />
          </div>
        )}
        <div style={{ width: `${projectedWidth}%` }} className={`h-full budget-bar-dashed transition-all duration-[700ms] ease-out opacity-20 ${isOursMode ? 'text-emerald-700 dark:text-emerald-300' : 'text-emerald-400 dark:text-emerald-800'}`} />
        {isDanger && <div className="flex-1 h-full bg-rose-500/10 dark:bg-rose-500/20" />}
      </div>

      <div onClick={onToggle} className={`relative z-10 flex-1 px-8 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all ${isExpanded ? 'flex-none py-10' : 'py-3'}`}>
        <div className="flex items-center space-x-6">
          <div className={`p-3 rounded-2xl transition-all duration-700 ${isExpanded ? (isOursMode ? 'bg-emerald-800' : 'bg-emerald-600') + ' text-white shadow-lg scale-110 p-3.5' : 'bg-white/80 dark:bg-slate-800 text-slate-400 dark:text-slate-500 shadow-sm'} ${isOursMode && !isExpanded ? 'text-emerald-600 dark:text-emerald-100' : ''}`}>
            {getBudgetIcon(budget.name)}
          </div>
          <div className="flex flex-col text-left">
            <h3 className={`text-base font-black tracking-tight leading-none uppercase transition-colors duration-700 ${isOursMode ? 'text-emerald-900 dark:text-emerald-50' : 'text-slate-500 dark:text-slate-100'}`}>{budget.name}</h3>
            {!isExpanded && (
              <span className={`text-[10px] font-black uppercase tracking-[0.15em] mt-1.5 transition-colors duration-700 ${isDanger ? 'text-rose-500' : (isOursMode ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500')}`}>
                {isDanger ? `Over: $${Math.max(0, total - budget.totalLimit).toFixed(0)}` : `$${Math.max(0, budget.totalLimit - total).toFixed(0)} left`}
              </span>
            )}
          </div>
        </div>
        
        <div className="text-right flex flex-col items-end">
          <div className="flex items-baseline space-x-1">
            {isExpanded && !isEditingLimit && (
              <span className={`text-sm font-black mr-2 tracking-tight transition-colors duration-700 ${isDanger ? 'text-rose-500' : (isOursMode ? 'text-emerald-700 dark:text-emerald-600' : 'text-slate-500')}`}>
                ${spent.toFixed(0)}
                <span className={`mx-1.5 opacity-30 font-medium ${isOursMode ? 'text-emerald-400 dark:text-emerald-200' : 'text-slate-400'}`}>/</span>
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
                <span className={`text-2xl font-black tracking-tighter leading-none transition-colors duration-700 ${isOursMode ? 'text-emerald-900 dark:text-emerald-50' : 'text-slate-500 dark:text-slate-100'}`}>${budget.totalLimit}</span>
                {isExpanded && (
                  <button onClick={e => { e.stopPropagation(); setIsEditingLimit(true); }} className={`ml-2 p-1 transition-colors ${isOursMode ? 'text-emerald-300 hover:text-emerald-600' : 'text-slate-300 hover:text-emerald-500'}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572" /></svg>
                  </button>
                )}
              </div>
            )}
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-widest mt-0.5 transition-colors duration-700 ${isOursMode ? 'text-emerald-600/60 dark:text-emerald-500' : 'text-slate-400 dark:text-slate-600'}`}>
            {isExpanded ? 'Vault Capacity' : (isOursMode ? 'Ours Shared' : 'My Target')}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 animate-in fade-in slide-in-from-top-2 duration-500 relative z-10">
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-between px-2">
              <span className={`text-[10px] font-black uppercase tracking-[0.2em] transition-colors duration-700 ${isOursMode ? 'text-emerald-600/60 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>{isOursMode ? 'Activity History (Ours)' : 'My Activity History'}</span>
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
                <div className={`py-16 text-center text-[11px] font-black uppercase tracking-widest ${isOursMode ? 'text-emerald-200' : 'text-slate-200 dark:text-slate-800'}`}>No entries found</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetSection;
