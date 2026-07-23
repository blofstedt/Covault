import React, { useState, useRef, useEffect } from 'react';
import { Transaction } from '../../types';

interface SoftDuplicateBadgeProps {
  /** The auto-entered transaction that has the soft-dup flag */
  tx: Transaction;
  /** Details of the similar transaction (from softDuplicateOf) */
  similar: NonNullable<Transaction['softDuplicateOf']>;
  /** Called when the user dismisses the warning ("not a duplicate") */
  onDismiss: (currentTxId: string, similarTxId: string) => void;
  /** Called when the user wants to delete the similar transaction */
  onDeleteSimilar: (similarTxId: string) => void;
  /** Called when the user wants to view the similar transaction's details */
  onViewSimilar?: (similarTxId: string) => void;
  /** Whether deletion is currently in progress (disables the delete button) */
  isDeleting?: boolean;
}

/**
 * Cute amber pill badge that surfaces a "possible duplicate" warning on an
 * auto-entered transaction. Tapping it opens a small popover with three
 * actions: "Not a duplicate" (dismiss), "Delete the older one" (remove
 * the similar transaction), and optionally "View both" (open the
 * similar transaction's details).
 *
 * The badge has a subtle pulse animation to draw the eye without being
 * annoying — it stops once the user opens the popover.
 *
 * Dismissals are persisted by the parent via onDismiss — the badge
 * itself is stateless so the same logic can be reused in any list.
 */
const SoftDuplicateBadge: React.FC<SoftDuplicateBadgeProps> = ({
  tx,
  similar,
  onDismiss,
  onDeleteSimilar,
  onViewSimilar,
  isDeleting = false,
}) => {
  const [open, setOpen] = useState(false);
  const [pulseActive, setPulseActive] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Stop the pulse once the user interacts
  useEffect(() => {
    if (open) setPulseActive(false);
  }, [open]);

  const handleToggle = (e: React.MouseEvent) => {
    // Prevent the parent <button> (the transaction card) from firing.
    e.stopPropagation();
    setOpen((o) => !o);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDismiss(tx.id, similar.id);
    setOpen(false);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteSimilar(similar.id);
    setOpen(false);
  };

  const handleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    onViewSimilar?.(similar.id);
    setOpen(false);
  };

  const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

  return (
    <div className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide
          bg-amber-100 text-amber-800 border border-amber-200
          dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/50
          hover:bg-amber-200 dark:hover:bg-amber-900/60
          active:scale-95
          transition-all duration-150
          ${pulseActive ? 'animate-softdup-pulse' : ''}`}
        title={`Possible duplicate of ${similar.vendor} ${fmt(similar.amount)} on ${similar.date}`}
        aria-label="Possible duplicate — tap to review"
        aria-expanded={open}
      >
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>Possible dup</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Duplicate review"
          className="absolute left-0 top-full mt-1.5 z-50 w-64 rounded-2xl border border-amber-200 dark:border-amber-700/50 bg-white dark:bg-slate-800 shadow-xl shadow-amber-500/10 p-3 text-left animate-in fade-in slide-in-from-top-1"
        >
          <div className="flex items-start gap-2 mb-2">
            <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-3.5 h-3.5 text-amber-600 dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100">Looks like a duplicate</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                You already have <span className="font-semibold text-slate-700 dark:text-slate-200">{similar.vendor}</span> {fmt(similar.amount)} on {similar.date}.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 mt-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold text-white bg-rose-500 hover:bg-rose-600 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-wait"
            >
              {isDeleting ? (
                <>
                  <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="12" cy="12" r="10" opacity="0.25" /><path d="M12 2a10 10 0 0110 10" /></svg>
                  Deleting…
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                  Delete the older one
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              className="w-full px-3 py-2 rounded-xl text-[11px] font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all duration-150"
            >
              Not a duplicate — keep both
            </button>
            {onViewSimilar && (
              <button
                type="button"
                onClick={handleView}
                className="w-full px-2 py-1.5 rounded-lg text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 active:scale-95 transition-all duration-150"
              >
                View the older transaction
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SoftDuplicateBadge;
