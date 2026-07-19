import React, { useState, useEffect, useCallback } from 'react';
import { Transaction, BudgetCategory } from '../../types';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { parseLocalDate } from '../../lib/dateUtils';
import { isSoftDupDismissed, markSoftDupDismissed } from '../../lib/localNotificationMemory';
import SoftDuplicateBadge from './SoftDuplicateBadge';
import RawNotificationExpander from './RawNotificationExpander';
import InlineVendorEdit from './InlineVendorEdit';
import NotATransactionModal, { type NotATxRuleType } from './NotATransactionModal';
import BackfillPreviewModal from './BackfillPreviewModal';
import { toVendorKey } from '../../lib/deviceTransactionParser';
import { countBackfillMatches, applyVendorBackfill } from '../../lib/vendorBackfill';

interface AIEnteredRowProps {
  /** The auto-entered transaction row. */
  tx: Transaction;
  /** Available budgets, for resolving budget_id → budget name. */
  budgets: BudgetCategory[];
  /** True when the row is in the "needs review" set. */
  isForReview: boolean;
  /** Called when the row is tapped (opens the full edit modal). */
  onTransactionTap?: (tx: Transaction) => void;
  /** Called to delete the transaction (used by soft-dup popover + not-a-tx flow). */
  onDeleteTransaction?: (id: string) => Promise<void> | void;
  /** Persist a vendor rename. Should write to the overrides table so the
   *  AI pipeline picks it up for future notifications from the same vendor. */
  onVendorRenamed?: (tx: Transaction, newVendor: string) => Promise<void> | void;
  /** Persist a "not a transaction" rule + delete the row. */
  onMarkNotTransaction?: (tx: Transaction, ruleType: NotATxRuleType) => Promise<void> | void;
  /** User id, needed for the backfill count/apply. */
  userId?: string;
}

const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

/**
 * One row in the "Caught Transactions" list on the <> page. Wraps the
 * previous row design with three new affordances:
 *
 * 1. A "View original notification" expander (hidden by default per spec)
 *    that reveals the raw notification text the parser saw. Lets the user
 *    audit why a row was created.
 * 2. An inline vendor rename input (triggered by a small "rename" affordance
 *    that appears on hover/focus). Persists to the overrides table so the
 *    AI pipeline uses the new name for future notifications.
 * 3. A "Not a transaction" button (chevron only, on the right) that opens
 *    a confirmation modal where the user picks the rule type (exact or
 *    contains) before a skip rule is created and the row is deleted.
 */
const AIEnteredRow: React.FC<AIEnteredRowProps> = ({
  tx,
  budgets,
  isForReview,
  onTransactionTap,
  onDeleteTransaction,
  onVendorRenamed,
  onMarkNotTransaction,
  userId,
}) => {
  const budgetName = tx.budget_id ? budgets.find((b) => b.id === tx.budget_id)?.name || null : null;

  // Soft-dup popover state
  const [deletingSimilar, setDeletingSimilar] = useState(false);
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(() => new Set());
  const softDup = tx.softDuplicateOf
    && !isSoftDupDismissed(tx.id, tx.softDuplicateOf.id)
    && !localDismissed.has(`${tx.id}|${tx.softDuplicateOf.id}`)
    ? tx.softDuplicateOf
    : null;

  // Inline vendor edit state
  const [isEditingVendor, setIsEditingVendor] = useState(false);
  const [isSavingVendor, setIsSavingVendor] = useState(false);

  // Backfill preview state. After a successful rename, we count how
  // many historical transactions share the old vendor's normalized
  // form and ask the user if they want to rename them too.
  const [backfillPrompt, setBackfillPrompt] = useState<{
    oldVendor: string;
    newVendor: string;
    matchKey: string;
    count: number;
  } | null>(null);
  const [isApplyingBackfill, setIsApplyingBackfill] = useState(false);
  const [backfillToast, setBackfillToast] = useState<string | null>(null);

  // Not-a-transaction modal state
  const [notAModalOpen, setNotAModalOpen] = useState(false);
  const [isMarkingNotTx, setIsMarkingNotTx] = useState(false);

  // Reset edit mode if the row updates (e.g. after save)
  useEffect(() => {
    if (!isEditingVendor) setIsSavingVendor(false);
  }, [tx.vendor, isEditingVendor]);

  const handleDismissSoftDup = useCallback((currentTxId: string, similarTxId: string) => {
    markSoftDupDismissed(currentTxId, similarTxId);
    setLocalDismissed((prev) => {
      const next = new Set(prev);
      next.add(`${currentTxId}|${similarTxId}`);
      return next;
    });
  }, []);

  const handleDeleteSimilar = useCallback(async (similarTxId: string) => {
    if (!onDeleteTransaction) return;
    setDeletingSimilar(true);
    try {
      await onDeleteTransaction(similarTxId);
    } finally {
      setDeletingSimilar(false);
    }
  }, [onDeleteTransaction]);

  const handleSaveVendor = useCallback(
    async (newName: string) => {
      if (!onVendorRenamed) {
        setIsEditingVendor(false);
        return;
      }
      const oldVendor = tx.vendor;
      setIsSavingVendor(true);
      try {
        await onVendorRenamed(tx, newName);
        setIsEditingVendor(false);
        // After the rename succeeds, ask the user if they want to
        // backfill historical transactions. Count first; if there
        // are 0 matches, skip the prompt entirely.
        if (userId) {
          const matchKey = toVendorKey(oldVendor);
          if (matchKey) {
            const count = await countBackfillMatches(userId, matchKey, 'exact');
            if (count > 0) {
              setBackfillPrompt({ oldVendor, newVendor: newName, matchKey, count });
            }
          }
        }
      } catch (err) {
        console.warn('[AIEnteredRow] vendor rename failed:', err);
      } finally {
        setIsSavingVendor(false);
      }
    },
    [onVendorRenamed, tx, userId],
  );

  const handleConfirmBackfill = useCallback(async () => {
    if (!backfillPrompt || !userId) return;
    setIsApplyingBackfill(true);
    try {
      const result = await applyVendorBackfill(
        userId,
        backfillPrompt.matchKey,
        backfillPrompt.newVendor,
        'exact',
      );
      setBackfillToast(
        result.updated > 0
          ? `Renamed ${result.updated} historical ${result.updated === 1 ? 'transaction' : 'transactions'}`
          : null,
      );
      // Auto-dismiss the toast after 3.5s
      if (result.updated > 0) {
        setTimeout(() => setBackfillToast(null), 3500);
      }
      setBackfillPrompt(null);
    } catch (err) {
      console.warn('[AIEnteredRow] backfill failed:', err);
    } finally {
      setIsApplyingBackfill(false);
    }
  }, [backfillPrompt, userId]);

  const handleConfirmNotATx = useCallback(
    async (ruleType: NotATxRuleType) => {
      if (!onMarkNotTransaction) return;
      setIsMarkingNotTx(true);
      try {
        await onMarkNotTransaction(tx, ruleType);
        setNotAModalOpen(false);
      } finally {
        setIsMarkingNotTx(false);
      }
    },
    [onMarkNotTransaction, tx],
  );

  return (
    <>
      <div
        onClick={() => !isEditingVendor && onTransactionTap?.(tx)}
        onKeyDown={(e) => {
          if (!isEditingVendor && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onTransactionTap?.(tx);
          }
        }}
        role="button"
        tabIndex={0}
        className={`group w-full p-4 rounded-2xl border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] transition-all duration-200 active:scale-[0.98] cursor-pointer hover:shadow-md ${
          softDup
            ? 'bg-amber-50/70 dark:bg-amber-900/15 border-amber-200 dark:border-amber-700/40'
            : isForReview
            ? 'bg-amber-50/70 dark:bg-amber-900/15 border-amber-200 dark:border-amber-700/40'
            : 'bg-white/60 dark:bg-emerald-900/10 backdrop-blur-sm border-emerald-100 dark:border-emerald-800/30'
        }`}
        aria-label={`Transaction: ${tx.vendor}, ${fmt(tx.amount)} on ${parseLocalDate(tx.date).toLocaleDateString()}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="w-9 h-9 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center shrink-0">
              {budgetName ? <span className="text-emerald-600 dark:text-emerald-400 w-4 h-4">{getBudgetIcon(budgetName)}</span> : <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="20 6 9 17 4 12" /></svg>}
            </div>
            <div className="text-left min-w-0 flex-1">
              {isEditingVendor ? (
                <InlineVendorEdit
                  value={tx.vendor}
                  editing={true}
                  isSaving={isSavingVendor}
                  onStartEdit={() => setIsEditingVendor(true)}
                  onCancel={() => setIsEditingVendor(false)}
                  onSave={handleSaveVendor}
                />
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                    {tx.vendor}
                  </p>
                  <InlineVendorEdit
                    value={tx.vendor}
                    editing={false}
                    isSaving={false}
                    onStartEdit={() => setIsEditingVendor(true)}
                    onCancel={() => setIsEditingVendor(false)}
                    onSave={handleSaveVendor}
                  />
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {softDup && (
                  <SoftDuplicateBadge
                    tx={tx}
                    similar={softDup}
                    onDismiss={handleDismissSoftDup}
                    onDeleteSimilar={handleDeleteSimilar}
                    isDeleting={deletingSimilar}
                  />
                )}
                {isForReview && (
                  <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 tracking-wide">For Review</span>
                )}
                {budgetName && (
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 tracking-wide">{budgetName}</span>
                )}
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  {parseLocalDate(tx.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <RawNotificationExpander rawNotification={tx.raw_notification} />
            </div>
          </div>
          <div className="text-right shrink-0 flex items-start gap-2">
            <div>
              <span className={`text-sm font-extrabold font-mono ${tx.amount < 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>
                {tx.amount < 0 ? '+' : ''}{fmt(tx.amount)}
              </span>
              <p className="text-[10px] font-semibold tracking-wide text-emerald-600 dark:text-emerald-400 mt-0.5">
                {tx.amount < 0 ? (tx.is_income ? 'Income' : 'Refund') : 'AI'}
              </p>
            </div>
            {onMarkNotTransaction && !isEditingVendor && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setNotAModalOpen(true); }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 mt-0.5 p-1 rounded-md text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-all duration-150"
                title="Mark as not a transaction"
                aria-label="Mark as not a transaction"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {notAModalOpen && (
        <NotATransactionModal
          rawNotification={tx.raw_notification || ''}
          vendor={tx.vendor}
          amount={tx.amount}
          isSaving={isMarkingNotTx}
          onConfirm={handleConfirmNotATx}
          onCancel={() => setNotAModalOpen(false)}
        />
      )}

      {backfillPrompt && (
        <BackfillPreviewModal
          oldVendor={backfillPrompt.oldVendor}
          newVendor={backfillPrompt.newVendor}
          matchCount={backfillPrompt.count}
          isApplying={isApplyingBackfill}
          onConfirm={handleConfirmBackfill}
          onCancel={() => setBackfillPrompt(null)}
        />
      )}

      {backfillToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-emerald-500 text-white text-[11px] font-bold shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {backfillToast}
        </div>
      )}
    </>
  );
};

export default AIEnteredRow;
