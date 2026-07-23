import React, { useState, useEffect } from 'react';

export type NotATxRuleType = 'exact' | 'contains';

interface NotATransactionModalProps {
  /** The raw notification text the user is marking as not-a-transaction. */
  rawNotification: string;
  /** The vendor/amount the row currently shows, for context in the modal. */
  vendor: string;
  amount: number;
  /** Whether a save is currently in progress. */
  isSaving?: boolean;
  /** Confirmed: create the rule and delete the transaction. */
  onConfirm: (ruleType: NotATxRuleType) => void;
  /** Cancelled. */
  onCancel: () => void;
}

/**
 * Confirmation modal for "this isn't a transaction". Lets the user pick
 * how the skip rule should match future notifications:
 *   - exact   : full text must match (safest, ship-first per user)
 *   - contains: substring match (broader, riskier)
 *
 * The user is shown the rule that will be created before they confirm,
 * so they can sanity-check. Defaults to 'exact' to be safe.
 *
 * Visually consistent with the rest of the app: dark backdrop blur,
 * rounded-[2.5rem] card, emerald accents, monospace for the pattern
 * preview to match the raw-notification expander.
 */
const NotATransactionModal: React.FC<NotATransactionModalProps> = ({
  rawNotification,
  vendor,
  amount,
  isSaving = false,
  onConfirm,
  onCancel,
}) => {
  const [ruleType, setRuleType] = useState<NotATxRuleType>('exact');

  // Escape to cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, isSaving]);

  const pattern = rawNotification.trim();
  const absAmount = Math.abs(amount);
  const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm animate-in fade-in"
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onCancel(); }}
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-700/50 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                Mark as not a transaction?
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{vendor}</span> {fmt(amount)} will be removed and a skip rule will be created so future notifications matching it are ignored.
              </p>
            </div>
          </div>
        </div>

        {/* Pattern preview */}
        <div className="px-6 pb-3">
          <p className="text-[10px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase mb-1.5">
            Pattern
          </p>
          <div className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 font-mono text-[11px] text-slate-700 dark:text-slate-200 break-words leading-relaxed max-h-32 overflow-y-auto">
            {pattern || <span className="italic text-slate-400">no notification text available</span>}
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
            Source: {vendor} {fmt(amount)} · ${absAmount.toFixed(2)} charge
          </p>
        </div>

        {/* Rule type selector */}
        <div className="px-6 pb-4">
          <p className="text-[10px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase mb-2">
            Match future notifications by
          </p>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setRuleType('exact')}
              disabled={isSaving}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all duration-200 active:scale-[0.98] ${
                ruleType === 'exact'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/60'
                  : 'bg-white dark:bg-slate-800/30 border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className={`w-4 h-4 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                ruleType === 'exact'
                  ? 'border-emerald-500'
                  : 'border-slate-300 dark:border-slate-600'
              }`}>
                {ruleType === 'exact' && (
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Exact text match
                  <span className="ml-2 text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded">Recommended</span>
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  Only this exact notification text is skipped. Safest.
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setRuleType('contains')}
              disabled={isSaving}
              className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all duration-200 active:scale-[0.98] ${
                ruleType === 'contains'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/60'
                  : 'bg-white dark:bg-slate-800/30 border-slate-200 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <div className={`w-4 h-4 mt-0.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                ruleType === 'contains'
                  ? 'border-emerald-500'
                  : 'border-slate-300 dark:border-slate-600'
              }`}>
                {ruleType === 'contains' && (
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  Contains substring
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  Any notification containing this text is skipped. May block similar legitimate transactions.
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all duration-150 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(ruleType)}
            disabled={isSaving || !pattern}
            className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-1.5"
          >
            {isSaving ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <circle cx="12" cy="12" r="10" opacity="0.25" />
                  <path d="M12 2a10 10 0 0110 10" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Mark + learn
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotATransactionModal;
