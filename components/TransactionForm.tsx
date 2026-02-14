
import React, { useState, useEffect, useRef } from 'react';
import { Transaction, BudgetCategory, Recurrence, TransactionLabel, TransactionSplit } from '../types';
import { getBudgetIcon } from './dashboard_components/getBudgetIcon';
import { formatVendorName } from '../lib/formatVendorName';
import { parseLocalDate } from '../lib/dateUtils';
import CalendarPicker from './CalendarPicker';
import { CloseButton } from './shared';

interface VendorHistoryItem {
  vendor: string;
  budget_id: string;
  splits?: { budget_id: string; amount: number }[];
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
  onDelete?: () => void;
  isTutorialMode?: boolean;
  demoSplitTrigger?: number;
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
  vendorHistory = [],
  onDelete,
  isTutorialMode = false,
  demoSplitTrigger,
}) => {
  const [vendor, setVendor] = useState(initialTransaction?.vendor || '');
  const [amountStr, setAmountStr] = useState(initialTransaction?.amount.toString() || '');
  const [date, setDate] = useState(() => {
    if (initialTransaction?.date) {
      return initialTransaction.date.slice(0, 10);
    }
    // Use local date (not UTC) so the transaction lands in the correct month
    // relative to the dashboard's local-time month filter.
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });

  const [recurrence, setRecurrence] = useState<Recurrence>(initialTransaction?.recurrence || 'One-time');
  const [description, setDescription] = useState(initialTransaction?.description || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const amountInputRef = useRef<HTMLInputElement>(null);

  const CLOSE_ANIMATION_MS = 250;

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => onClose(), CLOSE_ANIMATION_MS);
  };

  useEffect(() => {
    if (!initialTransaction && !isTutorialMode) {
      amountInputRef.current?.focus();
    }
  }, []);

  // Vendor autocomplete suggestions
  const suggestions = vendor.length > 0
    ? vendorHistory.filter(v =>
        v.vendor.toLowerCase().startsWith(vendor.toLowerCase()) &&
        v.vendor.toLowerCase() !== vendor.toLowerCase()
      ).slice(0, 5)
    : [];

  const selectSuggestion = (item: VendorHistoryItem) => {
    setVendor(item.vendor);
    setShowSuggestions(false);
    // Auto-select the last-used budget(s) for this vendor
    if (!initialTransaction) {
      if (item.splits && item.splits.length > 1) {
        // Restore the previous split configuration
        const ids = new Set(item.splits.map(s => s.budget_id));
        setSelectedIds(ids);
        const restored: Record<string, number> = {};
        item.splits.forEach(s => { restored[s.budget_id] = s.amount; });
        setSplits(restored);
      } else if (item.budget_id) {
        setSelectedIds(new Set([item.budget_id]));
      }
    }
  };

  // Format date for styled display — use parseLocalDate to avoid timezone shifts
  const formattedDate = parseLocalDate(date).toLocaleDateString(undefined, {
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

  // Demo split animation: select two budgets and animate the split
  useEffect(() => {
    if (!demoSplitTrigger || !isTutorialMode || budgets.length < 2) return;
    const demoAmount = 50;
    setAmountStr('50');
    setVendor('Demo Split');
    const id1 = budgets[0].id;
    const id2 = budgets[1].id;
    setSelectedIds(new Set([id1, id2]));
    setSplits({ [id1]: demoAmount / 2, [id2]: demoAmount / 2 });

    // Animate the split shifting
    let frame = 0;
    const totalFrames = 40;
    const interval = setInterval(() => {
      frame++;
      const ratio = 0.5 + 0.3 * Math.sin((frame / totalFrames) * Math.PI * 2);
      setSplits({ [id1]: demoAmount * ratio, [id2]: demoAmount * (1 - ratio) });
      if (frame >= totalFrames) clearInterval(interval);
    }, 50);

    return () => clearInterval(interval);
  }, [demoSplitTrigger]);

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
      // When a single budget is already selected and the user taps a different one,
      // replace the selection (reassign) rather than entering split mode
      if (next.size === 1) {
        next.clear();
      }
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
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
      vendor: formatVendorName(vendor || 'Untitled Vendor'),
      amount: amount,
      date: date + 'T12:00:00.000Z',
      budget_id: (Array.from(selectedIds) as string[])[0],
      recurrence,
      label: initialTransaction
        ? (initialTransaction.label === TransactionLabel.AUTO_ADDED || initialTransaction.label === TransactionLabel.EDITED
          ? TransactionLabel.EDITED
          : TransactionLabel.MANUAL)
        : TransactionLabel.MANUAL,
      user_id: userId,
      userName,
      is_projected: false,
      splits: finalSplits.length > 1 ? finalSplits : undefined,
      description: description.trim() || undefined,
      created_at: initialTransaction?.created_at || new Date().toISOString()
    };

    onSave(tx);
    onClose();
  };

  const isFormValid = amount > 0 && selectedIds.size > 0 && vendor.trim() !== '';

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl transition-opacity duration-250 ${isClosing ? 'opacity-0' : 'animate-in fade-in duration-300'}`}>
      <div id="tutorial-transaction-form" className={`w-full max-w-sm bg-white dark:bg-slate-900 rounded-[3rem] p-6 space-y-4 shadow-2xl border border-slate-100 dark:border-slate-800/60 max-h-[90vh] overflow-y-auto no-scrollbar transition-all duration-250 ${isClosing ? 'opacity-0 scale-95' : 'animate-in zoom-in-95 duration-300'}`}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-lg font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
              {initialTransaction ? 'Edit Entry' : 'New Entry'}
            </h2>
            {isSharedAccount && (
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mt-1">
                Recording as {userName}
              </span>
            )}
          </div>
          <CloseButton onClick={handleClose} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <div id="tutorial-amount-field" className="flex flex-col items-center justify-center py-5 bg-slate-50/50 dark:bg-slate-800/20 rounded-3xl border border-slate-100/50 dark:border-slate-800/30">
              <div className="flex items-center justify-center space-x-1">
                <span className="text-xl font-black text-slate-300 dark:text-slate-700 select-none">$</span>
                <input
                  ref={amountInputRef}
                  type="number"
                  placeholder="0.00"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  readOnly={isTutorialMode}
                  className="bg-transparent text-center text-3xl font-black tracking-tighter outline-none text-slate-500 dark:text-slate-50 placeholder-slate-200 dark:placeholder-slate-800 w-auto min-w-[1ch]"
                  style={{ width: amountStr ? `${amountStr.length + 0.5}ch` : '4ch' }}
                />
              </div>
            </div>

            {/* Vendor input with autocomplete */}
            <div id="tutorial-vendor-field" className="relative">
              <input
                type="text"
                placeholder="Where was this spent?"
                value={vendor}
                onChange={e => { setVendor(e.target.value); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-3 px-6 text-sm font-bold placeholder-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-500 dark:text-slate-100 text-center shadow-sm"
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
                          <span className="text-[10px] font-bold text-slate-400 ml-auto uppercase tracking-wider">{budget.name}</span>
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
              <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em]">
                {selectedIds.size > 1 ? 'Slide to Allocate' : 'Target Vault (Max 2)'}
              </span>
              {selectedIds.size > 1 && (
                <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-full animate-pulse">
                  SPLIT ACTIVE
                </span>
              )}
            </div>

            <div id="tutorial-budget-grid" className="flex flex-col gap-1.5">
              {[budgets.slice(0, 3), budgets.slice(3)].map((row, rowIdx) => (
                <div key={rowIdx} className="flex justify-center gap-1.5">
                  {row.map(b => {
                    const isSelected = selectedIds.has(b.id);
                    const isMaxSelected = selectedIds.size >= 2;
                    const isSplit = selectedIds.size > 1;
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
                          relative group flex items-center justify-center p-2 rounded-2xl transition-all overflow-hidden border w-[calc(25%-5px)] aspect-square
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

                        <div className={`relative z-10 flex flex-col items-center justify-center transition-transform ${isSliding ? 'scale-110' : ''}`}>
                          <div className={`flex items-center justify-center w-5 h-5 ${isSelected ? 'text-emerald-600 dark:text-emerald-400' : ''} ${isSelected && isSplit ? 'opacity-30' : ''}`}>
                            {getBudgetIcon(b.name)}
                          </div>
                          <span className={`text-[9px] font-black uppercase tracking-tighter mt-1.5 leading-none text-center ${isSelected ? 'text-emerald-700 dark:text-emerald-300' : ''} ${isSelected && isSplit ? 'opacity-30' : ''}`}>
                            {b.name}
                          </span>
                          {isSelected && isSplit && (
                            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-emerald-800 dark:text-emerald-200">
                              ${share.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {/* Styled date picker */}
            <div
              onClick={() => setShowCalendar(true)}
              className="relative flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800 cursor-pointer active:scale-[0.98] transition-all"
            >
              <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest ml-1">Date</span>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-slate-500 dark:text-slate-100">{formattedDate}</span>
                <svg className="w-4 h-4 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
            </div>

            <div className="space-y-3">
              <span className="text-[11px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-2 text-center block">Recurrence</span>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
                {['One-time', 'Biweekly', 'Monthly'].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRecurrence(r as Recurrence)}
                    className={`flex-1 py-2.5 text-[11px] font-black rounded-xl transition-all uppercase tracking-widest ${recurrence === r ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-400'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Description input */}
            <input
              type="text"
              placeholder="Add a description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-2xl py-3 px-6 text-sm font-bold placeholder-slate-300 dark:placeholder-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-500 dark:text-slate-100 text-center shadow-sm"
            />
          </div>

          <button
            type="submit"
            disabled={!isFormValid}
            className={`w-full py-3 rounded-2xl font-black text-xs shadow-xl active:scale-95 transition-all uppercase tracking-[0.15em] mt-1 ${isFormValid ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 opacity-50 cursor-not-allowed'}`}
          >
            {initialTransaction ? 'Update Transaction' : 'Confirm Entry'}
          </button>

          {/* Delete button only shown when editing an existing transaction */}
          {initialTransaction && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="w-full py-3 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 rounded-2xl font-black text-xs active:scale-95 transition-all uppercase tracking-[0.15em] flex items-center justify-center space-x-2 mt-1"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              <span>Delete Transaction</span>
            </button>
          )}
        </form>
      </div>

      {showCalendar && (
        <CalendarPicker
          value={date}
          onChange={setDate}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </div>
  );
};

export default TransactionForm;
