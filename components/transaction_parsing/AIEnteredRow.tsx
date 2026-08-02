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
import RowActionSheet, { type RowAction } from './RowActionSheet';
import CategoryPickerSheet, { type ExistingRule } from './CategoryPickerSheet';
import { toVendorKey } from '../../lib/deviceTransactionParser';
import { countBackfillMatches, applyVendorBackfill } from '../../lib/vendorBackfill';
import { classifyMatch, type VendorMatchResult } from '../../lib/hooks/useVendorMatcher';
import Portal from '../ui/Portal';
import { hapticTap, hapticWarn } from '../../lib/haptics';

// Hoisted for the same reason TransactionItem hoists its formatters:
// `toLocaleDateString` builds a fresh Intl.DateTimeFormat on every call, and
// this runs once per row per render of the review list.
const SHORT_DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

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
  /**
   * File the row under a budget AND remember the pairing as a rule.
   *
   * This is now the only category action. The separate `onCreateRule` prop is
   * gone — teaching used to be an opt-in second button that was easy to miss,
   * so the app kept re-asking about merchants the user had already sorted
   * several times.
   */
  onChangeCategory?: (tx: Transaction, targetBudgetId: string) => Promise<void> | void;
  /** Rules already taught for this row's vendor, offered first in the picker. */
  existingRules?: ExistingRule[];
  /** Every rule the user has taught, for the rename typeahead. */
  knownRules?: ExistingRule[];
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
  existingRules,
  knownRules,
  onFiled,
}) => {
  const budgetName = tx.budget_id ? budgets.find((b) => b.id === tx.budget_id)?.name || null : null;

  // ── Triage classification (how this row was categorized) ──
  // Exact: a deterministic vendor-override rule matches the vendor now.
  // AI: no rule, but the pipeline assigned a category with a confidence score.
  // Unmatched: no rule, no confidence → needs a manual category.
  const overrideMatch = matchResult?.match && matchResult.state !== 'none' ? matchResult.match : null;
  // tx.confidence still decides exact/ai/unmatched here; it just isn't rendered.
  const matchKind = classifyMatch({
    hasOverrideMatch: !!overrideMatch,
    confidence: tx.confidence,
    hasBudget: !!budgetName,
  });

  // ── Completion animation + file state ──
  const [filing, setFiling] = useState<string | null>(null);
  const fileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (fileTimerRef.current != null) clearTimeout(fileTimerRef.current);
  }, []);

  const fileWith = useCallback(
    (label: string, run: () => Promise<void> | void) => {
      if (filing) return;
      // Fires with the animation, not with the DB write — the tap should feel
      // acknowledged immediately, and the write is 620ms later.
      hapticTap();
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
  // `pickerMode` is gone: there is only one category action now, and it always
  // teaches. See the note on secondaryActions.
  const [showActions, setShowActions] = useState(false);

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
    hapticWarn();
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

  // Emerald is reserved for "a rule you wrote matched this". It used to also
  // cover high-confidence AI, which meant the one distinction worth seeing at a
  // glance — did this come from your own rule, or from a guess? — was carried
  // by a 3px checkmark and a percentage.
  //
  // The percentage is gone too. tx.confidence is still stored and still drives
  // classifyMatch; it just isn't shown, because nobody triages differently at
  // 80% than at 65%. The word "Guessed" carries the whole actionable meaning.
  const renderMatchBadge = () => {
    if (matchKind === 'exact') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
          {budgetName || 'Known vendor'}
        </span>
      );
    }
    if (matchKind === 'ai') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-full">
          <span className="opacity-60">Guessed</span>
          {budgetName && <span>{budgetName}</span>}
        </span>
      );
    }
    return (
      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 rounded-full">
        Needs category
      </span>
    );
  };

  const canAccept = matchKind !== 'unmatched' && !!budgetName;

  const openPicker = useCallback(() => {
    setShowCategoryPicker(true);
  }, []);

  // Everything except the primary action lives in the sheet, so each option gets
  // a full-width target and a label that says what it actually does.
  const secondaryActions = useMemo<RowAction[]>(() => {
    // ONE category action, not two.
    //
    // There used to be "Change category" (file this one) and "Always use this
    // category" (also save a rule). That made teaching a separate, easily
    // missed step, and left the app repeatedly asking about a merchant the
    // user had already categorised several times.
    //
    // Now every category choice teaches, and the undo on the resulting toast
    // is what makes a one-off correction safe. The second action is gone.
    const items: RowAction[] = [
      {
        label: canAccept ? 'Change category' : 'Choose a category',
        hint: `File this and remember ${tx.vendor} next time`,
        onSelect: () => openPicker(),
      },
    ];
    if (onVendorRenamed) {
      items.push({
        label: 'Rename vendor',
        hint: 'Tidy up how this shows in your history',
        onSelect: () => setIsEditingVendor(true),
      });
    }
    if (onMarkNotTransaction) {
      items.push({
        label: 'Not a transaction',
        hint: 'Remove it and stop capturing ones like it',
        tone: 'danger',
        onSelect: () => setNotAModalOpen(true),
      });
    }
    return items;
  }, [canAccept, matchKind, onMarkNotTransaction, onVendorRenamed, openPicker, tx.vendor]);

  // Rendered at row level rather than inside the text column, so the buttons
  // align to the card's edge instead of hanging off the vendor name.
  const renderMatchActions = () => (
    <div className="flex items-center gap-2 mt-3">
      {canAccept ? (
        <button
          type="button"
          onClick={() => fileWith(`Filed to ${budgetName}`, () => onAccept?.(tx))}
          className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 text-[13px] font-bold rounded-2xl bg-emerald-500 text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-600 active:scale-[0.98] transition-all"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
          Accept
        </button>
      ) : (
        <button
          type="button"
          onClick={() => openPicker()}
          className="flex-1 inline-flex items-center justify-center min-h-[44px] px-4 text-[13px] font-bold rounded-2xl bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 shadow-sm hover:opacity-90 active:scale-[0.98] transition-all"
        >
          Categorize
        </button>
      )}

      <button
        type="button"
        onClick={() => setShowActions(true)}
        aria-label={`More actions for ${tx.vendor}`}
        className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] transition-all"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>
    </div>
  );

  // Completion state: brief success card shown while the parent removes the row.
  // Same radius, padding and border weight as the row it replaces, so filing a
  // transaction doesn't make the list jump.
  if (filing) {
    return (
      <div className="w-full p-4 rounded-[2rem] border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 shadow-sm flex items-center gap-3 animate-in fade-in slide-in-from-right-2 duration-300">
        <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 animate-in zoom-in-50 duration-300">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-emerald-700 dark:text-emerald-300 tracking-tight truncate">{tx.vendor}</p>
          <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">{filing}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* One neutral surface matching TransactionItem, with a left accent bar
          carrying the state. The old version tinted the whole row and gave the
          softDup and isForReview branches identical amber classes — two
          different meanings rendering the same way. */}
      <div
        className={`w-full p-4 rounded-[2rem] border border-l-4 shadow-sm ring-1 ring-inset ring-white/10 dark:ring-white/[0.03] backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 border-slate-200/40 dark:border-slate-700/40 transition-colors duration-200 ${
          softDup
            ? 'border-l-amber-400 dark:border-l-amber-500'
            : isForReview
            ? 'border-l-amber-300 dark:border-l-amber-600'
            : matchKind === 'unmatched'
            ? 'border-l-slate-300 dark:border-l-slate-600'
            : 'border-l-emerald-400 dark:border-l-emerald-500'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start space-x-3 min-w-0 flex-1">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              matchKind === 'unmatched' ? 'bg-slate-100 dark:bg-slate-800/60' : 'bg-emerald-100 dark:bg-emerald-900/30'
            }`}>
              {budgetName ? (
                <span className="text-emerald-600 dark:text-emerald-400 w-4 h-4">{getBudgetIcon(budgetName)}</span>
              ) : (
                <svg className={`w-4 h-4 ${matchKind === 'unmatched' ? 'text-slate-400' : 'text-emerald-600 dark:text-emerald-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  {matchKind === 'unmatched'
                    ? <><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></>
                    : <polyline points="20 6 9 17 4 12" />}
                </svg>
              )}
            </div>
            <div className="text-left min-w-0 flex-1">
              {isEditingVendor ? (
                <InlineVendorEdit
                  value={tx.vendor}
                  knownRules={knownRules}
                  editing={true}
                  isSaving={isSavingVendor}
                  onStartEdit={() => setIsEditingVendor(true)}
                  onCancel={() => setIsEditingVendor(false)}
                  onSave={handleSaveVendor}
                />
              ) : (
                <p className="text-[14px] font-bold text-slate-600 dark:text-slate-100 tracking-tight truncate">
                  {tx.vendor}
                </p>
              )}
              {/* Exactly two items, never wrapping, so every row is the same
                  height. The soft-dup badge and "Needs a look" used to share
                  this line and pushed it to two or three lines on a narrow
                  phone; they get their own line below. */}
              <div className="flex items-center gap-1.5 mt-1 min-w-0">
                {renderMatchBadge()}
                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 shrink-0">
                  {SHORT_DATE_FMT.format(parseLocalDate(tx.date))}
                </span>
              </div>
            </div>
          </div>
          <div className="shrink-0 flex items-start gap-1">
            <div className="text-right">
              {/* The amount is what you scan when triaging, so it matches the
                  Dashboard row's weight. It used to be 14px and the only
                  font-mono in any transaction row in the app. */}
              <span className={`text-lg font-black tracking-tighter ${tx.amount < 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-50'}`}>
                {tx.amount < 0 ? '+' : ''}{formatCurrency(Math.abs(tx.amount))}
              </span>
              {tx.amount < 0 && (
                <p className="text-[11px] font-semibold tracking-wide text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {tx.is_income ? 'Income' : 'Refund'}
                </p>
              )}
            </div>
            {onTransactionTap && (
              <button
                type="button"
                onClick={() => onTransactionTap(tx)}
                aria-label={`Open details for ${tx.vendor}, ${formatCurrency(tx.amount)}`}
                className="inline-flex items-center justify-center min-h-[40px] min-w-[36px] -mr-1 rounded-xl text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Attention line — only rendered when there's something to say, so a
            clean row stays two lines tall. */}
        {(softDup || isForReview) && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {softDup && (
              <SoftDuplicateBadge
                tx={tx}
                similar={softDup}
                onDismiss={handleDismissSoftDup}
                onDeleteSimilar={handleDeleteSimilar}
                isDeleting={deletingSimilar}
              />
            )}
            {isForReview && !softDup && (
              <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 tracking-wide">
                Needs a look
              </span>
            )}
          </div>
        )}

        {renderMatchActions()}

        {/* Shown for every row with source text, exact matches included. It used
            to be hidden on exact matches — which is precisely when you want it,
            because that's a rule of yours firing on something it shouldn't. */}
        <RawNotificationExpander rawNotification={tx.raw_notification} />
      </div>

      {showActions && (
        <RowActionSheet
          title={tx.vendor}
          actions={secondaryActions}
          onClose={() => setShowActions(false)}
        />
      )}

      {showCategoryPicker && (
        <CategoryPickerSheet
          vendor={tx.vendor}
          budgets={budgets}
          existingRules={existingRules}
          onClose={() => setShowCategoryPicker(false)}
          onPick={(budgetId) => {
            const target = budgets.find((b) => b.id === budgetId);
            // Always the teaching path now. onChangeCategory files this row
            // AND records the rule; the toast names what was learned so the
            // undo is unambiguous about what it will take back.
            fileWith(
              `Learned ${tx.vendor} → ${target?.name ?? ''}`,
              () => onChangeCategory?.(tx, budgetId),
            );
          }}
        />
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

      {/* Portalled for the same reason the sheets are: this renders from inside
          the Review page's `relative z-10` <main>, so z-50 lost to the z-40
          bottom bar. */}
      {backfillToast && (
        <Portal>
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[130] px-4 py-2 rounded-full bg-emerald-500 text-white text-[11px] font-bold shadow-lg animate-in fade-in slide-in-from-bottom-2">
            {backfillToast}
          </div>
        </Portal>
      )}
    </>
  );
};

// Memoized: this row re-rendered on every parent state change (filedIds,
// isRefreshing, expandedSections, monitoredBanks, ...), re-running the budget
// lookup, classifyMatch and the full badge/action tree each time. Its props
// are stable now that the card's defaults and handlers keep their identities.
export default memo(AIEnteredRow);