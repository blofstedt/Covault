import React, { useState, useMemo } from 'react';
import { BudgetCategory, Transaction, SubCategory } from '../types';
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
  const [isManagingSubvaults, setIsManagingSubvaults] = useState(false);
  const [newSubvaultName, setNewSubvaultName] = useState('');
  const [expandedSubvaultId, setExpandedSubvaultId] = useState<string | null>(null);
  
  // States for editing a sub-vault
  const [editingSubvaultId, setEditingSubvaultId] = useState<string | null>(null);
  const [editSubvaultName, setEditSubvaultName] = useState('');
  const [editSubvaultLimit, setEditSubvaultLimit] = useState('');

  const getAmountForThisBudget = (tx: Transaction) => {
    if (tx.splits && tx.splits.length > 0) {
      const split = tx.splits.find(s => s.budgetId === budget.id);
      return split ? split.amount : 0;
    }
    return tx.budgetId === budget.id ? tx.amount : 0;
  };

  const spent = transactions.reduce((acc, tx) => acc + (tx.isProjected ? 0 : getAmountForThisBudget(tx)), 0);
  const projected = transactions.reduce((acc, tx) => acc + (tx.isProjected ? getAmountForThisBudget(tx) : 0), 0);
  const external = budget.externalDeduction || 0;
  const total = spent + external + projected;
  const isDanger = total > budget.totalLimit;

  const spentWidth = Math.min(100, (spent / budget.totalLimit) * 100);
  const externalWidth = Math.min(100 - spentWidth, (external / budget.totalLimit) * 100);
  const projectedWidth = Math.min(100 - spentWidth - externalWidth, (projected / budget.totalLimit) * 100);

  const handleAddSubvault = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubvaultName.trim() || budget.subCategories.length >= 10) return;
    
    const newSub: SubCategory = {
      id: Math.random().toString(36).substr(2, 9),
      name: newSubvaultName.trim(),
      allocatedAmount: 0 
    };

    onUpdateBudget({
      ...budget,
      subCategories: [...budget.subCategories, newSub]
    });
    setNewSubvaultName('');
  };

  const handleDeleteSubvault = (subId: string) => {
    onUpdateBudget({
      ...budget,
      subCategories: budget.subCategories.filter(s => s.id !== subId)
    });
    if (expandedSubvaultId === subId) setExpandedSubvaultId(null);
  };

  const handleStartEditSubvault = (sub: SubCategory) => {
    setEditingSubvaultId(sub.id);
    setEditSubvaultName(sub.name);
    setEditSubvaultLimit(sub.allocatedAmount.toString());
  };

  const handleSaveSubvaultEdit = (subId: string) => {
    onUpdateBudget({
      ...budget,
      subCategories: budget.subCategories.map(s => 
        s.id === subId 
          ? { ...s, name: editSubvaultName, allocatedAmount: parseFloat(editSubvaultLimit) || 0 } 
          : s
      )
    });
    setEditingSubvaultId(null);
  };

  const unassignedTransactions = transactions.filter(tx => !tx.subCategoryId);

  return (
    <div className={`flex-1 h-full bg-white dark:bg-slate-900 overflow-hidden transition-all duration-[1200ms] rounded-[2.5rem] border relative flex flex-col ${isExpanded ? 'ease-in border-emerald-300 dark:border-emerald-800 shadow-2xl' : 'ease-out border-slate-100 dark:border-slate-800/60 shadow-sm'}`}>
      <div className="absolute inset-0 z-0 pointer-events-none flex">
        <div style={{ width: `${spentWidth}%` }} className={`h-full bg-emerald-400/30 dark:bg-emerald-500/40 transition-all duration-[1200ms] ease-out relative ${isExpanded ? 'animate-breathe' : ''}`}>
          {spentWidth > 0 && (
            <>
              <div className={`liquid-start ${isExpanded ? 'liquid-active' : 'liquid-calm'}`} />
              <div className={`liquid-edge ${isExpanded ? 'liquid-active' : 'liquid-calm'}`} />
            </>
          )}
        </div>
        {external > 0 && (
          <div style={{ width: `${externalWidth}%` }} className={`h-full bg-rose-400/30 dark:bg-rose-500/40 transition-all duration-[1200ms] ease-out relative ${isExpanded ? 'animate-breathe' : ''}`}>
            <div className={`liquid-start ${isExpanded ? 'liquid-active-rose' : 'liquid-calm-rose'}`} />
            <div className={`liquid-edge ${isExpanded ? 'liquid-active-rose' : 'liquid-calm-rose'}`} />
          </div>
        )}
        <div style={{ width: `${projectedWidth}%` }} className="h-full budget-bar-dashed text-emerald-400 dark:text-emerald-800 transition-all duration-[1200ms] ease-out opacity-20" />
        {isDanger && <div className="flex-1 h-full bg-rose-500/10 dark:bg-rose-500/20" />}
      </div>

      <div onClick={onToggle} className={`relative z-10 flex-1 px-8 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all ${isExpanded ? 'flex-none py-10' : 'py-3'}`}>
        <div className="flex items-center space-x-6">
          <div className={`p-3 rounded-2xl transition-all duration-500 ${isExpanded ? 'bg-emerald-600 text-white shadow-lg scale-110 p-3.5' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 shadow-sm'}`}>
            {getBudgetIcon(budget.name)}
          </div>
          <div className="flex flex-col text-left">
            <h3 className="text-base font-black text-slate-500 dark:text-slate-100 tracking-tight leading-none uppercase">{budget.name}</h3>
            {!isExpanded && (
              <span className={`text-[10px] font-black uppercase tracking-[0.15em] mt-1.5 ${isDanger ? 'text-rose-500' : 'text-slate-400 dark:text-slate-500'}`}>
                {isDanger ? `Over: $${Math.max(0, total - budget.totalLimit).toFixed(0)}` : `$${Math.max(0, budget.totalLimit - total).toFixed(0)} left`}
              </span>
            )}
          </div>
        </div>
        
        <div className="text-right flex flex-col items-end">
          <div className="flex items-baseline space-x-1">
            {isExpanded && !isEditingLimit && (
              <span className={`text-sm font-black mr-2 tracking-tight ${isDanger ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                ${spent.toFixed(0)}
                <span className="mx-1.5 opacity-30 text-slate-400 font-medium">/</span>
              </span>
            )}
            
            {isEditingLimit ? (
              <input 
                autoFocus type="number" value={newLimit} onClick={e => e.stopPropagation()}
                onBlur={() => { onUpdateBudget({...budget, totalLimit: parseFloat(newLimit) || 0}); setIsEditingLimit(false); }}
                onKeyDown={e => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
                onChange={e => setNewLimit(e.target.value)}
                className="w-20 bg-white dark:bg-slate-900 text-right font-black text-base p-1 rounded-lg border-2 border-emerald-500 outline-none"
              />
            ) : (
              <div className="flex items-center">
                <span className="text-2xl font-black text-slate-500 dark:text-slate-100 tracking-tighter leading-none">${budget.totalLimit}</span>
                {isExpanded && (
                  <button onClick={e => { e.stopPropagation(); setIsEditingLimit(true); }} className="ml-2 p-1 text-slate-300 hover:text-emerald-500 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572" /></svg>
                  </button>
                )}
              </div>
            )}
          </div>
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-widest mt-0.5">{isExpanded ? 'Vault Capacity' : 'Target'}</span>
        </div>
      </div>

      {isExpanded && (
        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 animate-in fade-in slide-in-from-top-2 duration-500 relative z-10">
          <div className="py-6 space-y-6">
            
            {/* Sub-vault Management & Display Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">Sub-vaults ({budget.subCategories.length}/10)</span>
                <button 
                  onClick={() => setIsManagingSubvaults(!isManagingSubvaults)}
                  className={`text-[9px] font-black px-3 py-1 rounded-full transition-all border ${isManagingSubvaults ? 'bg-slate-800 text-white border-slate-800' : 'text-slate-400 border-slate-200 dark:border-slate-800'}`}
                >
                  {isManagingSubvaults ? 'DONE' : 'MANAGE'}
                </button>
              </div>

              {isManagingSubvaults ? (
                <div className="space-y-3 bg-slate-50 dark:bg-slate-800/40 p-4 rounded-3xl border border-slate-100 dark:border-slate-800/60">
                  <div className="flex flex-wrap gap-2">
                    {budget.subCategories.map(sub => (
                      <div key={sub.id} className="flex items-center bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-700 rounded-xl pl-3 pr-1 py-1 group">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-300">{sub.name}</span>
                        <button 
                          onClick={() => handleDeleteSubvault(sub.id)}
                          className="ml-2 p-1 text-slate-300 hover:text-rose-500 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  {budget.subCategories.length < 10 && (
                    <form onSubmit={handleAddSubvault} className="flex space-x-2 mt-4">
                      <input 
                        type="text" 
                        placeholder="Add sub-vault name..." 
                        value={newSubvaultName}
                        onChange={e => setNewSubvaultName(e.target.value)}
                        className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-xs font-bold text-slate-500 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                      <button 
                        type="submit"
                        className="px-4 py-2 bg-emerald-600 text-white text-[10px] font-black rounded-xl hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-500/10"
                      >
                        ADD
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {budget.subCategories.length > 0 ? (
                    budget.subCategories.map(sub => {
                      const subTxs = transactions.filter(tx => tx.subCategoryId === sub.id);
                      const subSpent = subTxs.reduce((acc, tx) => acc + (tx.isProjected ? 0 : getAmountForThisBudget(tx)), 0);
                      
                      // If allocatedAmount is 0, we can treat it as a partition of the main budget 
                      // or just show it as 0 capacity. Here we use allocatedAmount if > 0, else 0.
                      const subLimit = sub.allocatedAmount || 0;
                      const subProgress = subLimit > 0 ? Math.min(100, (subSpent / subLimit) * 100) : (subSpent > 0 ? 100 : 0);
                      const isSubExpanded = expandedSubvaultId === sub.id;
                      const isEditingSub = editingSubvaultId === sub.id;

                      return (
                        <div key={sub.id} className="flex flex-col">
                          <div className={`relative flex flex-col rounded-3xl transition-all duration-300 border overflow-hidden ${isSubExpanded ? 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-sm' : 'bg-white dark:bg-slate-900/50 border-slate-100 dark:border-slate-800/60'}`}>
                            {/* Sub-vault fill bar */}
                            {!isEditingSub && (
                              <div 
                                className="absolute left-0 top-0 bottom-0 bg-emerald-500/10 dark:bg-emerald-500/20 transition-all duration-1000 pointer-events-none"
                                style={{ width: `${subProgress}%` }}
                              />
                            )}
                            
                            <div className="relative z-10 flex items-center justify-between p-4 cursor-pointer" onClick={() => setExpandedSubvaultId(isSubExpanded ? null : sub.id)}>
                              <div className="flex items-center space-x-3 flex-1">
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${subSpent > subLimit && subLimit > 0 ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
                                {isEditingSub ? (
                                  <div className="flex items-center space-x-2 w-full" onClick={e => e.stopPropagation()}>
                                    <input 
                                      autoFocus
                                      type="text" 
                                      value={editSubvaultName} 
                                      onChange={e => setEditSubvaultName(e.target.value)}
                                      className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 dark:text-slate-100 outline-none"
                                    />
                                    <div className="flex items-center space-x-1">
                                      <span className="text-[10px] font-black text-slate-400">$</span>
                                      <input 
                                        type="number" 
                                        value={editSubvaultLimit} 
                                        onChange={e => setEditSubvaultLimit(e.target.value)}
                                        className="w-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 dark:text-slate-100 outline-none text-right"
                                      />
                                    </div>
                                    <button 
                                      onClick={() => handleSaveSubvaultEdit(sub.id)}
                                      className="p-1 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 rounded-md"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] font-black text-slate-500 dark:text-slate-200 uppercase tracking-widest truncate">{sub.name}</span>
                                )}
                              </div>

                              {!isEditingSub && (
                                <div className="flex items-center space-x-4 pl-2">
                                  <div className="text-right">
                                    <div className="flex items-baseline justify-end space-x-1">
                                      <span className="text-xs font-black text-slate-500 dark:text-slate-100 tracking-tight">${subSpent.toFixed(0)}</span>
                                      {subLimit > 0 && (
                                        <>
                                          <span className="text-[10px] font-medium text-slate-300 dark:text-slate-600">/</span>
                                          <span className="text-[10px] font-black text-slate-400 dark:text-slate-500">${subLimit.toFixed(0)}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                                    <button 
                                      onClick={() => handleStartEditSubvault(sub)}
                                      className="p-1 text-slate-300 hover:text-emerald-500 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572" /></svg>
                                    </button>
                                    <svg className={`w-3 h-3 text-slate-300 transition-transform duration-300 ${isSubExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
                                  </div>
                                </div>
                              )}
                            </div>

                            {isSubExpanded && !isEditingSub && (
                              <div className="px-4 pb-4 space-y-2 animate-in fade-in slide-in-from-top-1">
                                <div className="h-px bg-slate-200/40 dark:bg-slate-700/40 mb-3" />
                                {subTxs.length > 0 ? (
                                  subTxs.map(tx => (
                                    <TransactionItem 
                                      key={tx.id} transaction={tx} onDeleteRequest={onDeleteRequest} onEdit={onEdit}
                                      currentUserName={currentUserName} isSharedView={isSharedView} currentBudgetId={budget.id}
                                      budgets={allBudgets}
                                    />
                                  ))
                                ) : (
                                  <div className="py-6 text-center text-slate-300 dark:text-slate-700 text-[9px] font-black uppercase tracking-widest">Sub-vault Empty</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-2">
                       <span className="text-[10px] font-bold text-slate-300 dark:text-slate-700 italic">No sub-vaults assigned</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* General Activity Section */}
            <div className="space-y-4 pt-4">
              <div className="flex items-center justify-between px-2">
                <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">General Activity</span>
              </div>
              
              <div className="space-y-0">
                {unassignedTransactions.length > 0 ? (
                  unassignedTransactions.map(tx => (
                    <TransactionItem 
                      key={tx.id} transaction={tx} onDeleteRequest={onDeleteRequest} onEdit={onEdit}
                      currentUserName={currentUserName} isSharedView={isSharedView} currentBudgetId={budget.id}
                      budgets={allBudgets}
                    />
                  ))
                ) : (
                  <div className="py-10 text-center text-slate-200 dark:text-slate-800 text-[11px] font-black uppercase tracking-widest">No unassigned entries</div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetSection;