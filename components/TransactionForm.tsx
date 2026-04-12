
import React, { useState, useEffect, useRef } from 'react';
import { Transaction, BudgetCategory, Recurrence, TransactionLabel } from '../types';
import { getBudgetIcon } from './dashboard_components/getBudgetIcon';
import { formatVendorName } from '../lib/formatVendorName';
import { parseLocalDate } from '../lib/dateUtils';
import CalendarPicker from './CalendarPicker';
import { CloseButton } from './shared';

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
  onDelete?: () => void;
  /** Callback when an AI transaction's budget category is updated (vendor override) */
  onVendorOverrideUpdated?: (vendor: string, categoryName: string) => void;
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
  onVendorOverrideUpdated,
}) => {
  const [vendor, setVendor] = useState(initialTransaction?.vendor || '');
  const [amountStr, setAmountStr] = useState(initialTransaction ? Math.abs(initialTransaction.amount).toString() : '');
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
  const [isRefund, setIsRefund] = useState(() => initialTransaction ? initialTransaction.amount < 0 : false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);

  const isAITransaction = initialTransaction?.label === 'Automatic';
  const amountInputRef = useRef<HTMLInputElement>(null);

  const CLOSE_ANIMATION_MS = 250;

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => onClose(), CLOSE_ANIMATION_MS);
  };

  useEffect(() => {
    if (!initialTransaction) {
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
    if (!initialTransaction && item.budget_id) {
      setSelectedId(item.budget_id);
    }
  };

  // Format date for styled display — use parseLocalDate to avoid timezone shifts
  const formattedDate = parseLocalDate(date).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  });

  const [selectedId, setSelectedId] = useState<string | null>(
    initialTransaction?.budget_id ?? null
  );

  const toggleCategory = (id: string) => {
    setSelectedId(prev => (prev === id ? null : id));
  };

  const amount = parseFloat(amountStr) || 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0 || !selectedId) return;

    const tx: Transaction = {
      id: initialTransaction?.id || generateUUID(),
      vendor: formatVendorName(vendor || 'Untitled Vendor'),
      amount: isRefund ? -Math.abs(amount) : Math.abs(amount),
      date: date + 'T12:00:00.000Z',
      budget_id: selectedId,
      recurrence,
      label: initialTransaction
        ? (initialTransaction.label === TransactionLabel.AUTO_ADDED || initialTransaction.label === TransactionLabel.EDITED
          ? TransactionLabel.EDITED
          : TransactionLabel.MANUAL)
        : TransactionLabel.MANUAL,
      user_id: userId,
      userName,
      is_projected: false,
      created_at: initialTransaction?.created_at || new Date().toISOString()
    };

    // Notify about vendor override changes for AI transactions (only on save)
    if (isAITransaction && onVendorOverrideUpdated && initialTransaction) {
      const vendorChanged = formatVendorName(vendor || '') !== formatVendorName(initialTransaction.vendor || '');
      const categoryChanged = tx.budget_id !== initialTransaction.budget_id;
      if (vendorChanged) {
        onVendorOverrideUpdated(formatVendorName(vendor || ''), 'vendor_name_changed');
      }
      if (categoryChanged) {
        const budgetName = budgets.find(b => b.id === tx.budget_id)?.name || '';
        onVendorOverrideUpdated(formatVendorName(vendor || ''), budgetName);
      }
    }

    onSave(tx);
    onClose();
  };

  const isFormValid = amount > 0 && selectedId !== null && vendor.trim() !== '';

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl transition-opacity duration-250 ${isClosing ? 'opacity-0' : 'animate-in fade-in duration-300'}`}>
      <div id="tutorial-transaction-form" className={`w-full max-w-sm lg:max-w-lg bg-white dark:bg-slate-900 rounded-[3rem] p-6 space-y-4 shadow-2xl border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] border-slate-100 dark:border-slate-800/60 max-h-[90vh] overflow-y-auto no-scrollbar transition-all duration-250 ${isClosing ? 'opacity-0 scale-95' : 'animate-in zoom-in-95 duration-300'}`}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-lg font-bold text-slate-600 dark:text-slate-100 tracking-tight">
              {initialTransaction ? 'Edit Entry' : 'New Entry'}
            </h2>
            {isSharedAccount && (
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 tracking-wide mt-1">
                Recording as {userName}
              </span>
            )}
            {isAITransaction && (
              <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full tracking-wide mt-1 inline-block">
                AI Transaction
              </span>
            )}
          </div>
          <CloseButton onClick={handleClose} />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <div id="tutorial-amount-field" className="flex flex-col items-center justify-center py-5 bg-slate-50/50 dark:bg-slate-800/20 rounded-3xl border border-slate-100/50 dark:border-slate-800/30">
              <div className="flex items-center justify-center space-x-1">
                <span className={`text-xl font-black select-none ${isRefund ? 'text-emerald-400 dark:text-emerald-500' : 'text-slate-300 dark:text-slate-700'}`}>$</span>
                <input
                  ref={amountInputRef}
                  type="number"
                  placeholder="0.00"
                  value={amountStr}
                  onChange={e => setAmountStr(e.target.value)}
                  className={`bg-transparent text-center text-3xl font-black tracking-tighter outline-none placeholder-slate-200 dark:placeholder-slate-800 w-auto min-w-[1ch] ${isRefund ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-50'}`}
                  style={{ width: amountStr ? `${amountStr.length + 0.5}ch` : '4ch' }}
                />
              </div>

              {/* Expense / Refund toggle */}
              <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-full mt-3 w-48 mx-auto">
                <button
                  type="button"
                  onClick={() => setIsRefund(false)}
                  className={`flex-1 py-1.5 text-[10px] font-semibold rounded-full transition-all tracking-wide ${
                    !isRefund
                      ? 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 shadow-sm'
                      : 'text-slate-400'
                  }`}
                >
                  Expense
                </button>
                <button
                  type="button"
                  onClick={() => setIsRefund(true)}
                  className={`flex-1 py-1.5 text-[10px] font-semibold rounded-full transition-all tracking-wide ${
                    isRefund
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-slate-400'
                  }`}
                >
                  Refund
                </button>
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
                          <span className="text-[10px] font-semibold text-slate-400 ml-auto tracking-wide">{budget.name}</span>
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
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide">
                Target Vault
              </span>
            </div>

            <div id="tutorial-budget-grid" className="flex flex-col gap-1.5">
              {[budgets.slice(0, 3), budgets.slice(3)].map((row, rowIdx) => (
                <div key={rowIdx} className="flex justify-center gap-1.5">
                  {row.map(b => {
                    const isSelected = selectedId === b.id;

                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => toggleCategory(b.id)}
                        className={`
                          relative flex items-center justify-center p-2 rounded-2xl transition-all duration-200 border w-[calc(25%-5px)] aspect-square active:scale-[0.97]
                          ${isSelected
                            ? 'border-emerald-500/50 bg-emerald-50/60 dark:bg-emerald-900/20 shadow-lg shadow-emerald-500/10'
                            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-400'
                          }
                        `}
                      >
                        <div className="flex flex-col items-center justify-center">
                          <div className={`flex items-center justify-center w-5 h-5 ${isSelected ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                            {getBudgetIcon(b.name)}
                          </div>
                          <span className={`text-[9px] font-bold tracking-tight mt-1.5 leading-none text-center ${isSelected ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>
                            {b.name}
                          </span>
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
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide ml-1">Date</span>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-slate-500 dark:text-slate-100">{formattedDate}</span>
                <svg className="w-4 h-4 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
            </div>

            <div className="space-y-3">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide px-2 text-center block">Recurrence</span>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
                {['One-time', 'Biweekly', 'Monthly'].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRecurrence(r as Recurrence)}
                    className={`flex-1 py-2.5 text-[11px] font-semibold rounded-xl transition-all tracking-wide ${recurrence === r ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-400'}`}
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
            className={`w-full py-3 rounded-2xl font-semibold text-xs shadow-xl active:scale-[0.97] transition-all duration-200 tracking-wide mt-1 ${isFormValid ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 opacity-50 cursor-not-allowed'}`}
          >
            {initialTransaction ? 'Update Transaction' : 'Confirm Entry'}
          </button>

          {/* Delete button only shown when editing an existing transaction */}
          {initialTransaction && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="w-full py-3 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 rounded-2xl font-semibold text-xs active:scale-[0.97] transition-all duration-200 tracking-wide flex items-center justify-center space-x-2 mt-1"
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
