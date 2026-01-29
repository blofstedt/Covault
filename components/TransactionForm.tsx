
import React, { useState, useEffect, useRef } from 'react';
import { Transaction, BudgetCategory, Recurrence, TransactionLabel, TransactionSplit } from '../types';
import { getBudgetIcon } from './Dashboard';

interface VendorHistoryItem {
  vendor: string;
  budget_id: string;
}

interface TransactionFormProps {
  onClose: () => void;
  onSave: (t: Transaction) => void;
  budgets: BudgetCategory[];
  userId: string;
  userName: string;
  initialTransaction?: Transaction;
  isSharedAccount?: boolean;
  vendorHistory?: VendorHistoryItem[];
}

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const TransactionForm: React.FC<TransactionFormProps> = ({
  onClose,
  onSave,
  budgets,
  userId,
  userName,
  initialTransaction,
  isSharedAccount = false,
  vendorHistory = []
}) => {
  const [vendor, setVendor] = useState(initialTransaction?.vendor || '');
  const [amountStr, setAmountStr] = useState(initialTransaction?.amount.toString() || '');
  const [date, setDate] = useState(
    initialTransaction?.date
      ? new Date(initialTransaction.date).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]
  );

  const [recurrence, setRecurrence] = useState<Recurrence>(initialTransaction?.recurrence || 'One-time');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const amountInputRef = useRef<HTMLInputElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initialTransaction) {
      amountInputRef.current?.focus();
    }
  }, []);

  // Vendor autocomplete suggestions
  const suggestions = vendor.length > 0
    ? vendorHistory.filter(v =>
        v.vendor.toLowerCase().includes(vendor.toLowerCase()) &&
        v.vendor.toLowerCase() !== vendor.toLowerCase()
      ).slice(0, 5)
    : [];

  const selectSuggestion = (item: VendorHistoryItem) => {
    setVendor(item.vendor);
    setShowSuggestions(false);
    // Auto-select the last-used budget for this vendor
    if (item.budget_id && !initialTransaction) {
      setSelectedIds(new Set([item.budget_id]));
    }
  };

  // Format date for styled display
  const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  });

  // Track selected budget IDs
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (initialTransaction?.splits) {
      return new Set(initialTransaction.splits.map(s => s.budget_id));
    }
    if (initialTransaction?.budget_id) {
      return new Set([initialTransaction.budget_id]);
    }
    return new Set();
  });

  const [splits, setSplits] = useState<Record<string, number>>(() => {
    const amountVal = parseFloat(initialTransaction?.amount.toString() || '0');
    if (initialTransaction?.splits) {
      const initial: Record<string, number> = {};
      initialTransaction.splits.forEach(s => { initial[s.budget_id] = s.amount; });
      return initial;
    }
    const res: Record<string, number> = {};
    if (initialTransaction?.budget_id) {
      res[initialTransaction.budget_id] = amountVal;
    }
    return res;
  });

  const [activeSlideId, setActiveSlideId] = useState<string | null>(null);
  const slideStartRef = useRef<{ x: number, initialSplit: number } | null>(null);
  const trackRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const hasMovedRef = useRef<boolean>(false);

  const amount = parseFloat(amountStr) || 0;

  // Sync splits when amount or selectedIds change
  useEffect(() => {
    const ids = Array.from(selectedIds) as string[];
    if (ids.length === 0) {
      setSplits({});
      return;
    }

    if (ids.length === 1) {
      setSplits({ [ids[0]]: amount });
      return;
    }

    const currentSum = (Object.values(splits) as number[]).reduce((a: number, b: number) => a + b, 0);
    const splitKeys = Object.keys(splits) as string[];
    const setKeys = Array.from(selectedIds) as string[];

    const needsReset = splitKeys.length !== setKeys.length || !setKeys.every(k => splitKeys.includes(k));

    if (needsReset) {
      const equalShare = amount / ids.length;
      const newSplits: Record<string, number> = {};
      ids.forEach(id => { newSplits[id] = equalShare; });
      setSplits(newSplits);
    } else if (Math.abs(currentSum - amount) > 0.01) {
      const scale = currentSum === 0 ? 1 / ids.length : amount / currentSum;
      const newSplits: Record<string, number> = {};
      ids.forEach(id => {
        newSplits[id] = (splits[id] || (amount / ids.length)) * scale;
      });
      setSplits(newSplits);
    }
  }, [amount, selectedIds]);

  const toggleCategory = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size < 2) {
        next.add(id);
      }
    }
    setSelectedIds(next);
  };

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    if (document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur();
    }

    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActiveSlideId(id);
    hasMovedRef.current = false;
    slideStartRef.current = { x: e.clientX, initialSplit: splits[id] || 0 };
  };

  const handlePointerMove = (e: React.PointerEvent, id: string) => {
    if (activeSlideId !== id || !slideStartRef.current) return;

    if (!selectedIds.has(id) || selectedIds.size < 2) return;

    const deltaX = e.clientX - slideStartRef.current.x;

    if (Math.abs(deltaX) > 5) {
      hasMovedRef.current = true;
    }

    if (!hasMovedRef.current) return;

    const rect = trackRef.current.get(id)?.getBoundingClientRect();
    if (!rect) return;

    const deltaAmount = (deltaX / rect.width) * amount;
    let newVal = Math.max(0, Math.min(amount, slideStartRef.current.initialSplit + deltaAmount));

    const otherIds = (Array.from(selectedIds) as string[]).filter(sid => sid !== id);
    if (otherIds.length === 0) return;

    const diff = newVal - (splits[id] || 0);
    const otherSum = otherIds.reduce((sum: number, sid: string) => sum + (splits[sid] || 0), 0);

    const newSplits = { ...splits };
    newSplits[id] = newVal;

    if (otherSum > 0) {
      otherIds.forEach(sid => {
        newSplits[sid] = Math.max(0, (splits[sid] || 0) - (diff * ((splits[sid] || 0) / otherSum)));
      });
    } else {
      otherIds.forEach(sid => {
        newSplits[sid] = Math.max(0, (amount - newVal) / otherIds.length);
      });
    }

    const finalSum = (Object.values(newSplits) as number[]).reduce((a: number, b: number) => a + b, 0);
    if (Math.abs(finalSum - amount) > 0.001) {
      const adjustment = amount - finalSum;
      const firstOtherId = otherIds[0];
      newSplits[firstOtherId] = Math.max(0, (newSplits[firstOtherId] || 0) + adjustment);
    }

    setSplits(newSplits);
  };

  const handlePointerUp = (e: React.PointerEvent, id: string) => {
    if (activeSlideId === id) {
      if (!hasMovedRef.current) {
        toggleCategory(id);
      }
    }
    setActiveSlideId(null);
    slideStartRef.current = null;
    hasMovedRef.current = false;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0 || selectedIds.size === 0) return;

    const finalSplits: TransactionSplit[] = (Array.from(selectedIds) as string[]).map(id => ({
      budget_id: id,
      amount: parseFloat((splits[id] || 0).toFixed(2))
    }));

    const tx: Transaction = {
      id: initialTransaction?.id || generateUUID(),
      vendor: vendor || 'Untitled Vendor',
      amount: amount,
      date: new Date(date).toISOString(),
      budget_id: (Array.from(selectedIds) as string[])[0],
      recurrence,
      label: initialTransaction ? TransactionLabel.EDITED : TransactionLabel.MANUAL,
      user_id: userId,
      userName,
      is_projected: recurrence !== Recurrence.ONE_TIME && new Date(date) > new Date(),
      splits: finalSplits.length > 1 ? finalSplits : undefined,
      created_at: initialTransaction?.created_at || new Date().toISOString()
    };

    onSave(tx);
    onClose();
  };

  const isFormValid = amount > 0 && selectedIds.size > 0 && vendor.trim() !== '';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-[3rem] p-8 space-y-6 shadow-2xl animate-in zoom-in-95 duration-300 border border-slate-100 dark:border-slate-800/60 max-h-[90vh] overflow-y-auto no-scrollbar">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-2xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
              {initialTransaction ? 'Edit Entry' : 'New Entry'}
            </h2>
            {isSharedAccount && (
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mt-1">
                Recording as {userName}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-2.5 bg-slate-100 dark:bg-slate-800 rounded-full transition-transform active:scale-90">
            <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-4">
            <div className="flex flex-col items-center justify-center py-8 bg-slate-50/50 dark:bg-slate-800/20 rounded-3xl border border-slate-100/50 dark:border-slate-800/30">
              <div className="flex items-center justify-center space-x-1">
                <span className="text-xl font-black text-slate-300 dark:text-slate-700 select-none">$</span>
                <input
                  ref={amountInputRef}
                  type="number"
                  placeholder="0.00"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  className="bg-transparent text-left text-3xl font-black tracking-tighter outline-none text-slate-500 dark:text-slate-50 placeholder-slate-200 dark:placeholder-slate-800 w-auto min-w-[1ch]"
                  style={{ width: amountStr ? `${amountStr.length + 0.5}ch` : '4ch' }}
                />
              </div>
            </div>

            {/* Vendor input with autocomplete */}
            <div className="relative">
              <input
                type="text"
                placeholder="Where was this spent?"
                value={vendor}
                onChange={e => { setVendor(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-4 px-6 text-sm font-bold placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-500 dark:text-slate-100 text-center shadow-sm"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-xl overflow-hidden">
                  {suggestions.map((s, i) => {
                    const budget = budgets.find(b => b.id === s.budget_id);
                    return (
                      <button
                        key={i}
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => selectSuggestion(s)}
                        className="w-full flex items-center px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                      >
                        <div className="w-6 h-6 flex items-center justify-center text-emerald-500 mr-3 shrink-0">
                          {budget ? getBudgetIcon(budget.name) : null}
                        </div>
                        <span className="text-sm font-bold text-slate-500 dark:text-slate-200 capitalize">{s.vendor}</span>
                        {budget && (
                          <span className="text-[9px] font-bold text-slate-400 ml-auto uppercase tracking-wider">{budget.name}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between px-2">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">
                {selectedIds.size > 1 ? 'Slide to Allocate' : 'Target Vault (Max 2)'}
              </span>
              {selectedIds.size > 1 && (
                <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full animate-pulse">
                  SPLIT ACTIVE
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {budgets.map(b => {
                const isSelected = selectedIds.has(b.id);
                const isMaxSelected = selectedIds.size >= 2;
                const share = isSelected ? (splits[b.id] || 0) : 0;
                const percentage = amount > 0 ? (share / amount) * 100 : 0;
                const isSliding = activeSlideId === b.id;

                return (
                  <button
                    key={b.id}
                    ref={el => { if (el) trackRef.current.set(b.id, el); else trackRef.current.delete(b.id); }}
                    type="button"
                    onPointerDown={e => handlePointerDown(e, b.id)}
                    onPointerMove={e => handlePointerMove(e, b.id)}
                    onPointerUp={e => handlePointerUp(e, b.id)}
                    onPointerCancel={e => handlePointerUp(e, b.id)}
                    style={{
                      background: isSelected
                        ? `linear-gradient(to right, rgba(16, 185, 129, 0.4) ${percentage}%, transparent ${percentage}%)`
                        : 'transparent'
                    }}
                    className={`
                      relative group flex flex-col items-center justify-center p-3 rounded-2xl transition-all overflow-hidden border
                      ${isSelected
                        ? 'border-emerald-500/50 shadow-lg shadow-emerald-500/10'
                        : (isMaxSelected ? 'bg-slate-50/50 dark:bg-slate-900/50 border-slate-50 dark:border-slate-900 opacity-40 text-slate-300' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-400')
                      }
                      ${isSliding ? 'scale-[1.05] ring-2 ring-emerald-500/40' : 'active:scale-95'}
                      touch-none
                    `}
                  >
                    {isSelected && (
                      <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        <div className={`liquid-edge liquid-active`} style={{ left: `${percentage}%`, transform: 'translateX(-50%)', opacity: 0.4 }} />
                      </div>
                    )}

                    <div className={`relative z-10 flex flex-col items-center transition-transform ${isSliding ? 'scale-110' : ''}`}>
                      <div className={`w-5 h-5 ${isSelected ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                        {getBudgetIcon(b.name)}
                      </div>
                      <span className={`text-[8px] font-black uppercase tracking-tighter mt-1.5 ${isSelected ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                        {b.name}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] font-black text-emerald-800 dark:text-emerald-200 mt-0.5">
                          ${share.toFixed(selectedIds.size > 1 ? 2 : 0)}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            {/* Styled date picker */}
            <div
              onClick={() => {
                try { (dateInputRef.current as any)?.showPicker?.(); } catch { dateInputRef.current?.focus(); }
              }}
              className="relative flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 cursor-pointer active:scale-[0.98] transition-all"
            >
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Date</span>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-slate-500 dark:text-slate-100">{formattedDate}</span>
                <svg className="w-4 h-4 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <input
                ref={dateInputRef}
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </div>

            <div className="space-y-3">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-2 text-center block">Recurrence</span>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
                {['One-time', 'Biweekly', 'Monthly'].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRecurrence(r as Recurrence)}
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
            disabled={!isFormValid}
            className={`w-full py-4 rounded-2xl font-black text-sm shadow-xl active:scale-95 transition-all uppercase tracking-[0.2em] mt-2 ${isFormValid ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 opacity-50 cursor-not-allowed'}`}
          >
            Confirm Entry
          </button>
        </form>
      </div>
    </div>
  );
};

export default TransactionForm;
