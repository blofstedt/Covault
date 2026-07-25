import { log } from '../../lib/log';
import React, { useState, useCallback, useMemo, useRef, useEffect, memo } from 'react';
import { formatCurrency } from '../../lib/formatCurrency';
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
import { classifyMatch, type VendorMatchResult } from '../../lib/hooks/useVendorMatcher';

interface AIEnteredRowProps {
  tx: Transaction;
  budgets: BudgetCategory[];
  isForReview: boolean;
  onTransactionTap?: (tx: Transaction) => void;
  onDeleteTransaction?: (id: string) => Promise<void> | void;
  onVendorRenamed?: (tx: Transaction, newVendor: string) => Promise<void> | void;
  onMarkNotTransaction?: (tx: Transaction, ruleType: NotATxRuleType) => Promise<void> | void;
  userId?: string;
  /** Deterministic vendor-override match for this row (from useVendorMatcher). */
  matchResult?: VendorMatchResult;
  /** Accept the current mapping and file the row. */
  onAccept?: (tx: Transaction) => Promise<void> | void;
  /** Change the mapping to a different budget, then file. */
  onChangeCategory?: (tx: Transaction, targetBudgetId: string) => Promise<void> | void;
  /** Create a permanent vendor→budget rule (so future captures auto-match), then file. */
  onCreateRule?: (tx: Transaction, targetBudgetId: string) => Promise<void> | void;
  /** Called after the file animation so the parent can drop the row from the list. */
  onFiled?: (txId: string) => void;
}

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
  onAccept,
  onChangeCategory,
  onCreateRule,
  onFiled,
}) => {
  const budgetName = tx.budget_id ? budgets.find((b) => b.id === tx.budget_id)?.name || null : null;

  // ── Triage classification (how this row was categorized) ──
  // Exact: a deterministic vendor-override rule matches the vendor now.
  // AI: no rule, but the pipeline assigned a category with a confidence score.
  // Unmatched: no rule, no confidence → needs a manual category.
  const overrideMatch = matchResult?.match && matchResult.state !== 'none' ? matchResult.match : null;
  const confidencePct = tx.confidence != null ? Math.round(Math.max(0, Math.min(1, tx.confidence)) * 100) : null;
  const matchKind = classifyMatch({
    hasOverrideMatch: !!overrideMatch,
    confidence: tx.confidence,
    hasBudget: !!budgetName,
  });
  const confTier: 'high' | 'medium' | 'low' =
    confidencePct == null ? 'low' : confidencePct >= 75 ? 'high' : confidencePct >= 50 ? 'medium' : 'low';

  // ── Completion animation + file state ──
  const [filing, setFiling] = useState<string | null>(null);
  const fileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (fileTimerRef.current != null) clearTimeout(fileTimerRef.current);
  }, []);

  const fileWith = useCallback(
    (label: string, run: () => Promise<void> | void) => {
      if (filing) return;
      setFiling(label);
      // Let the check/slide animation play, then persist and drop the row.
      fileTimerRef.current = setTimeout(async () => {
        fileTimerRef.current = null;
        try {
          await run();
        } catch (err) {
          log.warn('[AIEnteredRow] file action failed:', err);
        }
        onFiled?.(tx.id);
      }, 620);
    },
    [filing, onFiled, tx.id],
  );

  const [deletingSimilar, setDeletingSimilar] = useState(false);
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(() => new Set());
  const softDupId = tx.softDuplicateOf?.id;
  const softDup = useMemo(() => {
    if (!tx.softDuplicateOf || !softDupId) return null;
    if (isSoftDupDismissed(tx.id, softDupId)) return null;
    if (localDismissed.has(`${tx.id}|${softDupId}`)) return null;
    return tx.softDuplicateOf;
  }, [tx.softDuplicateOf, softDupId, tx.id, localDismissed]);

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
  const [pickerMode, setPickerMode] = useState<'change' | 'create'>('change');

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
        log.warn('[AIEnteredRow] vendor rename failed:', err);
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
      log.warn('[AIEnteredRow] backfill failed:', err);
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
    if (matchKind === 'exact') {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><polyline points="20 6 9 17 4 12" /></svg>
          Exact match{budgetName ? ` · ${budgetName}` : ''}
        </span>
      );
    }
    if (matchKind === 'ai') {
      const tierChip =
        confTier === 'high'
          ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/30'
          : confTier === 'medium'
          ? 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30'
          : 'text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-900/30';
      const tierBar =
        confTier === 'high' ? 'bg-emerald-500' : confTier === 'medium' ? 'bg-amber-500' : 'bg-rose-500';
      return (
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${tierChip}`}>
          <span>AI</span>
          {budgetName && <span className="opacity-70">· {budgetName}</span>}
          {confidencePct != null && (
            <span className="inline-flex items-center gap-1">
              <span className="w-7 h-1 rounded-full bg-black/10 dark:bg-white/15 overflow-hidden">
                <span className={`block h-full rounded-full ${tierBar}`} style={{ width: `${confidencePct}%` }} />
              </span>
              {confidencePct}%
            </span>
          )}
        </span>
      );
    }
    return (
      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-full">
        Needs category
      </span>
    );
  };

  const renderMatchActions = () => {
    const canAccept = matchKind !== 'unmatched' && !!budgetName;
    return (
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        {canAccept && (
          <button
            onClick={(e) => { e.stopPropagation(); fileWith(`Filed to ${budgetName}`, () => onAccept?.(tx)); }}
            className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><polyline points="20 6 9 17 4 12" /></svg>
            Accept
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setPickerMode('change'); setShowCategoryPicker(true); }}
          className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 active:scale-95 transition-all"
        >
          {canAccept ? 'Change' : 'Categorize'}
        </button>
        {matchKind !== 'exact' && (
          <button
            onClick={(e) => { e.stopPropagation(); setPickerMode('create'); setShowCategoryPicker(true); }}
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 active:scale-95 transition-all"
          >
            Create rule
          </button>
        )}
      </div>
    );
  };

  // Completion state: brief success card shown while the parent removes the row.
  if (filing) {
    return (
      <div className="w-full p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 flex items-center gap-3 animate-in fade-in slide-in-from-right-2 duration-300">
        <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 animate-in zoom-in-50 duration-300">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300 truncate">{tx.vendor}</p>
          <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{filing}</p>
        </div>
      </div>
    );
  }

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
            : matchKind === 'unmatched'
            ? 'bg-slate-50/70 dark:bg-slate-900/15 border-slate-200 dark:border-slate-700/40'
            : 'bg-white/60 dark:bg-emerald-900/10 backdrop-blur-sm border-emerald-100 dark:border-emerald-800/30'
        }`}
        aria-label={`Transaction: ${tx.vendor}, ${formatCurrency(tx.amount)}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              matchKind === 'unmatched' ? 'bg-slate-100 dark:bg-slate-800/60' : 'bg-emerald-100 dark:bg-emerald-900/30'
            }`}>
              {budgetName ? (
                <span className="text-emerald-600 dark:text-emerald-400 w-4 h-4">{getBudgetIcon(budgetName)}</span>
              ) : (
                <svg className={`w-4 h-4 ${matchKind === 'unmatched' ? 'text-slate-400' : 'text-emerald-600 dark:text-emerald-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
                {tx.amount < 0 ? '+' : ''}{formatCurrency(tx.amount)}
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
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1">
              {pickerMode === 'create' ? 'Create a rule' : 'Choose category'}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              {pickerMode === 'create'
                ? `Always file "${tx.vendor}" under…`
                : `File "${tx.vendor}" under…`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {budgets.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    setShowCategoryPicker(false);
                    if (pickerMode === 'create') {
                      fileWith(`Rule created · ${b.name}`, () => onCreateRule?.(tx, b.id));
                    } else {
                      fileWith(`Moved to ${b.name}`, () => onChangeCategory?.(tx, b.id));
                    }
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

// Memoized: this row re-rendered on every parent state change (filedIds,
// isRefreshing, expandedSections, monitoredBanks, ...), re-running the budget
// lookup, classifyMatch and the full badge/action tree each time. Its props
// are stable now that the card's defaults and handlers keep their identities.
export default memo(AIEnteredRow);