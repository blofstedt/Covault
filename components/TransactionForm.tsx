import React, { useState, useEffect, useRef } from 'react';
import { Transaction, BudgetCategory, Recurrence, TransactionLabel, TransactionSplit } from '../types';
import { getBudgetIcon } from './Dashboard';

interface TransactionFormProps {
  onClose: () => void;
  onSave: (t: Transaction) => void;
  budgets: BudgetCategory[];
  userId: string;
  userName: string;
  initialTransaction?: Transaction;
}

const TransactionForm: React.FC<TransactionFormProps> = ({ 
  onClose, 
  onSave, 
  budgets, 
  userId, 
  userName, 
  initialTransaction 
}) => {
  const [vendor, setVendor] = useState(initialTransaction?.vendor || '');
  const [amount, setAmount] = useState(initialTransaction?.amount.toString() || '');
  const [date, setDate] = useState(
    initialTransaction?.date 
      ? new Date(initialTransaction.date).toISOString().split('T')[0] 
      : new Date().toISOString().split('T')[0]
  );
  
  const [selectedBudgetId, setSelectedBudgetId] = useState(initialTransaction?.budgetId || budgets[0]?.id || '');
  const [selectedSubCategoryId, setSelectedSubCategoryId] = useState(initialTransaction?.subCategoryId || '');
  
  const [recurrence, setRecurrence] = useState<Recurrence>(initialTransaction?.recurrence || Recurrence.ONE_TIME);
  const [isSplitMode, setIsSplitMode] = useState(!!initialTransaction?.splits);
  
  const amountRef = useRef<HTMLInputElement>(null);
  const vendorRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  // Constrain splits to exactly two vaults
  const [splits, setSplits] = useState<TransactionSplit[]>(() => {
    if (initialTransaction?.splits && initialTransaction.splits.length >= 2) {
      return initialTransaction.splits.slice(0, 2);
    }
    const initialTotal = parseFloat(amount) || 0;
    const firstBudgetId = initialTransaction?.budgetId || budgets[0]?.id || '';
    const secondBudgetId = budgets.find(b => b.id !== firstBudgetId)?.id || budgets[0].id;
    
    return [
      { budgetId: firstBudgetId, amount: initialTotal },
      { budgetId: secondBudgetId, amount: 0 }
    ];
  });

  useEffect(() => {
    if (!isSplitMode) return;
    const total = parseFloat(amount) || 0;
    // Auto-balance the second split if total changes
    const next = [...splits];
    next[1].amount = Math.max(0, parseFloat((total - next[0].amount).toFixed(2)));
    setSplits(next);
  }, [amount, isSplitMode]);

  useEffect(() => {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, []);

  const totalAmount = parseFloat(amount) || 0;
  const selectedBudget = budgets.find(b => b.id === selectedBudgetId);

  const handleSplitAmountUpdate = (index: number, newVal: number) => {
    const total = parseFloat(amount) || 0;
    const next = [...splits];
    next[index].amount = newVal;
    const otherIdx = index === 0 ? 1 : 0;
    next[otherIdx].amount = parseFloat(Math.max(0, total - newVal).toFixed(2));
    setSplits(next);
  };

  const handleAmountKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      vendorRef.current?.focus();
    }
  };

  const handleVendorKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dateRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAmount = parseFloat(amount);
    if (!amount || finalAmount <= 0) return;

    const tx: Transaction = {
      id: initialTransaction?.id || Math.random().toString(),
      vendor: vendor || 'Untitled Vendor',
      amount: finalAmount,
      date: new Date(date).toISOString(),
      budgetId: isSplitMode ? splits[0].budgetId : selectedBudgetId,
      subCategoryId: isSplitMode ? undefined : (selectedSubCategoryId || undefined),
      recurrence,
      label: initialTransaction ? TransactionLabel.EDITED : TransactionLabel.MANUAL,
      userId,
      userName,
      isProjected: recurrence !== Recurrence.ONE_TIME && new Date(date) > new Date(),
      splits: isSplitMode ? splits : undefined
    };

    onSave(tx);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[3rem] p-8 space-y-6 shadow-2xl animate-in zoom-in-95 duration-300 border border-slate-100 dark:border-slate-800/60 max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            {initialTransaction ? 'Edit Entry' : 'New Entry'}
          </h2>
          <button onClick={onClose} className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-full transition-transform active:scale-90">
            <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Amount and Vendor Section */}
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center py-8 bg-slate-50/50 dark:bg-slate-800/20 rounded-3xl border border-slate-100/50 dark:border-slate-800/30">
              <div className="flex items-center justify-center space-x-1">
                <span className="text-xl font-black text-slate-300 dark:text-slate-700 select-none">$</span>
                <input 
                  ref={amountRef}
                  type="number" 
                  placeholder="0.00" 
                  value={amount} 
                  onChange={e => setAmount(e.target.value)}
                  onKeyDown={handleAmountKeyDown}
                  className="bg-transparent text-left text-3xl font-black tracking-tighter outline-none text-slate-500 dark:text-slate-50 placeholder-slate-200 dark:placeholder-slate-800 w-auto min-w-[1ch]"
                  style={{ width: amount ? `${amount.length + 0.5}ch` : '4ch' }}
                  autoFocus
                />
              </div>
            </div>
            <input 
              ref={vendorRef}
              type="text" 
              placeholder="Where was this spent?" 
              value={vendor} 
              onChange={e => setVendor(e.target.value)}
              onKeyDown={handleVendorKeyDown}
              className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-4 px-6 text-sm font-bold placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-500 dark:text-slate-100 text-center shadow-sm"
            />
          </div>

          {/* Allocation Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">
                {isSplitMode ? 'Vault Split' : 'Target Vault'}
              </span>
              <button 
                type="button"
                onClick={() => setIsSplitMode(!isSplitMode)}
                className={`text-[9px] font-black px-3 py-1 rounded-full transition-all border ${isSplitMode ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-400 border-slate-200 dark:border-slate-800'}`}
              >
                {isSplitMode ? 'SPLIT ACTIVE' : 'SPLIT VAULT'}
              </button>
            </div>

            {isSplitMode ? (
              <div className="space-y-6 p-6 bg-slate-50 dark:bg-slate-800/40 rounded-[2rem] border border-slate-100 dark:border-slate-800/60 shadow-inner">
                {splits.map((split, i) => (
                  <div key={i} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <select 
                        value={split.budgetId}
                        onChange={e => {
                          const next = [...splits];
                          next[i].budgetId = e.target.value;
                          setSplits(next);
                        }}
                        className="bg-transparent text-xs font-black text-slate-500 dark:text-slate-200 uppercase tracking-widest outline-none border-b border-transparent focus:border-emerald-500/30"
                      >
                        {budgets.map(b => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                      <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">${split.amount.toFixed(2)}</span>
                    </div>
                    <input 
                      type="range"
                      min="0"
                      max={totalAmount}
                      step="0.01"
                      value={split.amount}
                      onChange={e => handleSplitAmountUpdate(i, parseFloat(e.target.value))}
                      className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>
                ))}
                
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase">Total Split</span>
                  <span className="text-[10px] font-black text-slate-500 dark:text-slate-200">${totalAmount.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {budgets.map(b => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setSelectedBudgetId(b.id);
                        setSelectedSubCategoryId('');
                      }}
                      className={`flex flex-col items-center justify-center p-3 rounded-2xl transition-all border ${selectedBudgetId === b.id ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-400'}`}
                    >
                      {getBudgetIcon(b.name)}
                      <span className="text-[9px] font-black uppercase tracking-tighter mt-2">{b.name}</span>
                    </button>
                  ))}
                </div>

                {selectedBudget && selectedBudget.subCategories.length > 0 && (
                  <div className="space-y-3 animate-in fade-in slide-in-from-top-1">
                    <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest px-2">Sub-vault (Optional)</span>
                    <div className="flex flex-wrap gap-2">
                      {selectedBudget.subCategories.map(sub => (
                        <button
                          key={sub.id}
                          type="button"
                          onClick={() => setSelectedSubCategoryId(selectedSubCategoryId === sub.id ? '' : sub.id)}
                          className={`px-3 py-1.5 rounded-full text-[10px] font-black transition-all border ${selectedSubCategoryId === sub.id ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-800 text-slate-400'}`}
                        >
                          {sub.name.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Details Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
               <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Transaction Date</span>
               <input 
                ref={dateRef}
                type="date" 
                value={date} 
                onChange={e => setDate(e.target.value)}
                className="bg-transparent text-sm font-bold text-slate-500 dark:text-slate-100 outline-none"
              />
            </div>

            <div className="space-y-3">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-2 text-center block">Recurrence</span>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
                {Object.values(Recurrence).map(r => (
                  <button 
                    key={r}
                    type="button"
                    onClick={() => setRecurrence(r)}
                    className={`flex-1 py-3 text-[10px] font-black rounded-xl transition-all uppercase tracking-widest ${recurrence === r ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-400'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button 
            type="submit"
            className="w-full py-4 bg-emerald-600 dark:bg-emerald-600 text-white rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-all uppercase tracking-[0.2em] mt-4"
          >
            Confirm Entry
          </button>
        </form>
      </div>
    </div>
  );
};

export default TransactionForm;