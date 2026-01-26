
import React, { useState, useEffect } from 'react';
import { Transaction, BudgetCategory, TransactionSplit } from '../types';

interface SplitModalProps {
  transaction: Transaction;
  budgets: BudgetCategory[];
  onClose: () => void;
  onSave: (splits: TransactionSplit[]) => void;
}

const SplitModal: React.FC<SplitModalProps> = ({ transaction, budgets, onClose, onSave }) => {
  const [splits, setSplits] = useState<TransactionSplit[]>([
    { budgetId: transaction.budgetId, amount: transaction.amount },
    { budgetId: budgets.find(b => b.id !== transaction.budgetId)?.id || budgets[0].id, amount: 0 }
  ]);

  const totalAllocated = splits.reduce((acc, s) => acc + s.amount, 0);

  const handleUpdateAmount = (index: number, newAmount: number) => {
    const othersTotal = splits.reduce((acc, s, i) => i === index ? acc : acc + s.amount, 0);
    const cappedAmount = Math.min(newAmount, Math.max(0, transaction.amount - othersTotal));
    
    const nextSplits = [...splits];
    nextSplits[index].amount = cappedAmount;
    
    // Auto-balance if there are exactly 2 splits
    if (splits.length === 2) {
      const otherIdx = index === 0 ? 1 : 0;
      nextSplits[otherIdx].amount = Math.max(0, transaction.amount - cappedAmount);
    }

    setSplits(nextSplits);
  };

  const addSplit = () => {
    if (splits.length >= 3) return;
    setSplits([...splits, { budgetId: budgets[0].id, amount: 0 }]);
  };

  const removeSplit = (idx: number) => {
    if (splits.length <= 1) return;
    const next = splits.filter((_, i) => i !== idx);
    // Redistribute
    if (next.length === 1) next[0].amount = transaction.amount;
    setSplits(next);
  };

  return (
    <div className="absolute inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="absolute bottom-0 inset-x-0 bg-white dark:bg-slate-900 rounded-t-[2.5rem] p-8 pb-12 space-y-8 animate-in slide-in-from-bottom duration-500 transition-colors">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Split Transaction</h2>
            <p className="text-slate-500 dark:text-slate-400">${transaction.amount.toFixed(2)} at {transaction.vendor}</p>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full">
            <svg className="w-6 h-6 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-8">
          {splits.map((split, i) => {
            const othersTotal = splits.reduce((acc, s, idx) => idx === i ? acc : acc + s.amount, 0);
            const currentMax = Math.max(0, transaction.amount - othersTotal);

            return (
              <div key={i} className="space-y-4">
                <div className="flex items-center justify-between">
                  <select 
                    value={split.budgetId}
                    onChange={e => {
                      const next = [...splits];
                      next[i].budgetId = e.target.value;
                      setSplits(next);
                    }}
                    className="bg-transparent border-none text-lg font-bold text-slate-800 dark:text-slate-100 p-0 focus:ring-0"
                  >
                    {budgets.map(b => (
                      <option key={b.id} value={b.id} className="dark:bg-slate-900">{b.name}</option>
                    ))}
                  </select>
                  <div className="flex items-center space-x-3">
                    <span className="text-xl font-black text-slate-900 dark:text-slate-100">${split.amount.toFixed(2)}</span>
                    {splits.length > 1 && (
                      <button onClick={() => removeSplit(i)} className="text-rose-400 hover:text-rose-500">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                
                <input 
                  type="range"
                  min="0"
                  max={transaction.amount}
                  step="0.01"
                  value={split.amount}
                  onChange={e => handleUpdateAmount(i, parseFloat(e.target.value))}
                  style={{
                    // Visual cue of where the hard limit is
                    background: `linear-gradient(to right, #10b981 ${ (split.amount / transaction.amount) * 100 }%, #e2e8f0 ${ (split.amount / transaction.amount) * 100 }%, #e2e8f0 ${ (currentMax / transaction.amount) * 100 }%, #fecaca ${ (currentMax / transaction.amount) * 100 }%)`
                  }}
                  className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full appearance-none cursor-pointer accent-emerald-600"
                />
              </div>
            );
          })}

          {splits.length < 3 && (
            <button 
              onClick={addSplit}
              className="w-full py-4 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 dark:text-slate-500 font-bold hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
            >
              + Add another split
            </button>
          )}

          <div className="pt-4 space-y-4">
             <div className="flex items-center justify-between px-2">
                <span className="text-sm font-bold text-slate-400 dark:text-slate-500 uppercase">Remaining</span>
                <span className={`font-bold ${Math.abs(transaction.amount - totalAllocated) < 0.01 ? 'text-emerald-500' : 'text-rose-500 dark:text-rose-400'}`}>
                  ${Math.max(0, transaction.amount - totalAllocated).toFixed(2)}
                </span>
             </div>

             <button 
              disabled={Math.abs(transaction.amount - totalAllocated) > 0.01}
              onClick={() => onSave(splits)}
              className="w-full py-5 bg-slate-900 dark:bg-emerald-600 text-white rounded-3xl font-bold text-xl shadow-xl active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all"
            >
              Confirm Split
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SplitModal;
