import React, { useState, useCallback } from 'react';
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
import type { VendorMatchResult, AICategorizationState } from '../../lib/vendorMatcher';

interface AIEnteredRowProps {
  tx: Transaction;
  budgets: BudgetCategory[];
  isForReview: boolean;
  onTransactionTap?: (tx: Transaction) => void;
  onDeleteTransaction?: (id: string) => Promise<void> | void;
  onVendorRenamed?: (tx: Transaction, newVendor: string) => Promise<void> | void;
  onMarkNotTransaction?: (tx: Transaction, ruleType: NotATxRuleType) => Promise<void> | void;
  userId?: string;
  matchResult?: VendorMatchResult;
  matchState?: AICategorizationState;
  onConfirmMatch?: (tx: Transaction, match: VendorMatchResult) => void;
  onChangeCategory?: (tx: Transaction, targetBudgetId?: string) => void;
}

const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;

const AIEnteredRow: React.FC<AIEnteredRowProps> = ({
  tx,
  budgets,
  isForReview,
  onTransactionTap,
  onDeleteTransaction,
  onVendorRenamed,
  onMarkNotTransaction,
  userId,
  matchResult,
  matchState = 'other',
  onConfirmMatch,
  onChangeCategory,
}) => {
  const budgetName = tx.budget_id ? budgets.find((b) => b.id === tx.budget_id)?.name || null : null;

  const [deletingSimilar, setDeletingSimilar] = useState(false);
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(() => new Set());
  const softDup = tx.softDuplicateOf
    && !isSoftDupDismissed(tx.id, tx.softDuplicateOf.id)
    && !localDismissed.has(`${tx.id}|${tx.softDuplicateOf.id}`)
    ? tx.softDuplicateOf
    : null;

  const [isEditingVendor, setIsEditingVendor] = useState(false);
  const [isSavingVendor, setIsSavingVendor] = useState(false);

  const [backfillPrompt, setBackfillPrompt] = useState<{
    oldVendor: string;
    newVendor: string;
    matchKey: string;
    count: number;
  } | null>(null);
  const [isApplyingBackfill, setIsApplyingBackfill] = useState(false);
  const [backfillToast, setBackfillToast] = useState<string | null>(null);

  const [notAModalOpen, setNotAModalOpen] = useState(false);
  const [isMarkingNotTx, setIsMarkingNotTx] = useState(false);

  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

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
      const result = await applyVendorBackfill(userId, backfillPrompt.matchKey, backfillPrompt.newVendor, 'exact');
      setBackfillToast(result.updated > 0 ? `Renamed ${result.updated} historical ${result.updated === 1 ? 'transaction' : 'transactions'}` : null);
      if (result.updated > 0) setTimeout(() => setBackfillToast(null), 3500);
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

  const renderMatchBadge = () => {
    if (matchState === 'auto') {
      return (
        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
          Auto: {matchResult?.properName} → {matchResult?.categoryName}
        </span>
      );
    }
    if (matchState === 'suggested') {
      return (
        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
          Suggested: {matchResult?.properName || 'New category'} → {matchResult?.categoryName || budgetName}
        </span>
      );
    }
    return (
      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-full">
        Other — tap to categorize
      </span>
    );
  };

  const renderMatchActions = () => {
    if (matchState === 'auto') {
      return (
        <div className="flex items-center gap-1 mt-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onConfirmMatch?.(tx, matchResult!); }}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-all"
          >
            Confirm
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onChangeCategory?.(tx); }}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 transition-all"
          >
            Change
          </button>
        </div>
      );
    }
    if (matchState === 'suggested') {
      return (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          <span className="text-[10px] text-slate-500 dark:text-slate-400">Did you mean?</span>
          <button
            onClick={(e) => { e.stopPropagation(); onConfirmMatch?.(tx, matchResult!); }}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-all"
          >
            Confirm
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onChangeCategory?.(tx); }}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 transition-all"
          >
            Use Different
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setShowCategoryPicker(true); }}
            className="text-[10px] font-bold px-2 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 transition-all"
          >
            New Rule
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 mt-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); setShowCategoryPicker(true); }}
          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-violet-500 text-white hover:bg-violet-600 transition-all"
        >
          Categorize
        </button>
      </div>
    );
  };

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
            : matchState === 'other'
            ? 'bg-slate-50/70 dark:bg-slate-900/15 border-slate-200 dark:border-slate-700/40'
            : 'bg-white/60 dark:bg-emerald-900/10 backdrop-blur-sm border-emerald-100 dark:border-emerald-800/30'
        }`}
        aria-label={`Transaction: ${tx.vendor}, ${fmt(tx.amount)}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              matchState === 'other' ? 'bg-slate-100 dark:bg-slate-800/60' : 'bg-emerald-100 dark:bg-emerald-900/30'
            }`}>
              {budgetName ? (
                <span className="text-emerald-600 dark:text-emerald-400 w-4 h-4">{getBudgetIcon(budgetName)}</span>
              ) : (
                <svg className={`w-4 h-4 ${matchState === 'other' ? 'text-slate-400' : 'text-emerald-600 dark:text-emerald-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
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
                {renderMatchBadge()}
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  {parseLocalDate(tx.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
              {renderMatchActions()}
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
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {showCategoryPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowCategoryPicker(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 max-w-sm w-full mx-4 shadow-2xl border border-slate-200 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-3">Choose Category</h3>
            <div className="grid grid-cols-2 gap-2">
              {budgets.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    onChangeCategory?.(tx, b.id);
                    setShowCategoryPicker(false);
                  }}
                  className="px-3 py-2 text-xs font-bold rounded-xl bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 transition-all text-left"
                >
                  {b.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowCategoryPicker(false)}
              className="mt-3 w-full py-2 text-xs font-bold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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