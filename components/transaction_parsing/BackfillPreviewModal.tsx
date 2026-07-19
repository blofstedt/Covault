import React, { useEffect } from 'react';

interface BackfillPreviewModalProps {
  /** The OLD vendor name (what we're replacing). */
  oldVendor: string;
  /** The NEW vendor name (what we're renaming to). */
  newVendor: string;
  /** Number of historical transactions that would be updated. */
  matchCount: number;
  /** True while the backfill is in progress. */
  isApplying?: boolean;
  /** User confirmed — apply the backfill. */
  onConfirm: () => void;
  /** User cancelled. */
  onCancel: () => void;
  /** User chose "this time only" — apply just this row, no backfill. */
  onApplyOnce?: () => void;
}

/**
 * Preview modal shown right after a vendor rename, asking the user
 * whether to apply the rename retroactively to historical
 * transactions. Per product spec: always show the count first,
 * require explicit confirmation.
 *
 * Three choices:
 *   1. Apply to all (backfill historical transactions)
 *   2. Apply to this one (the current row, which already happened)
 *   3. Cancel
 *
 * Visually consistent with the rest of the app: dark backdrop blur,
 * rounded-[2.5rem] card, emerald accent for the primary action.
 */
const BackfillPreviewModal: React.FC<BackfillPreviewModalProps> = ({
  oldVendor,
  newVendor,
  matchCount,
  isApplying = false,
  onConfirm,
  onCancel,
  onApplyOnce,
}) => {
  // Escape cancels (unless a request is in flight)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isApplying) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, isApplying]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm animate-in fade-in"
      onClick={(e) => { if (e.target === e.currentTarget && !isApplying) onCancel(); }}
    >
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-200 dark:border-slate-700/50 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                Apply to historical transactions?
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                Renamed <span className="font-semibold text-slate-700 dark:text-slate-200">{oldVendor}</span> to <span className="font-semibold text-slate-700 dark:text-slate-200">{newVendor}</span>.
              </p>
            </div>
          </div>
        </div>

        {/* Count callout */}
        <div className="px-6 pb-4">
          <div className={`px-4 py-3 rounded-2xl border ${
            matchCount > 0
              ? 'bg-emerald-50 dark:bg-emerald-900/15 border-emerald-200 dark:border-emerald-700/40'
              : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50'
          }`}>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-2xl font-black tracking-tighter ${
                matchCount > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-400 dark:text-slate-500'
              }`}>
                {matchCount}
              </span>
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                historical {matchCount === 1 ? 'transaction matches' : 'transactions match'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
              {matchCount > 0
                ? 'They will be renamed to match. New notifications from this vendor will also use the new name going forward.'
                : 'No historical transactions to update. New notifications from this vendor will use the new name going forward.'}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col gap-2">
          {matchCount > 0 && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={isApplying}
              className="w-full px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-wait flex items-center justify-center gap-1.5"
            >
              {isApplying ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <circle cx="12" cy="12" r="10" opacity="0.25" />
                    <path d="M12 2a10 10 0 0110 10" />
                  </svg>
                  Applying to {matchCount} {matchCount === 1 ? 'transaction' : 'transactions'}…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Apply to all {matchCount}
                </>
              )}
            </button>
          )}
          {matchCount > 0 && onApplyOnce && (
            <button
              type="button"
              onClick={onApplyOnce}
              disabled={isApplying}
              className="w-full px-4 py-2 rounded-xl text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/60 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all duration-150 disabled:opacity-50"
            >
              Just this one
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={isApplying}
            className="w-full px-4 py-2 rounded-xl text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 active:scale-95 transition-all duration-150 disabled:opacity-50"
          >
            {matchCount > 0 ? 'Decide later' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BackfillPreviewModal;
