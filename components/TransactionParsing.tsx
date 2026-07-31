import { log } from '../lib/log';
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import { Transaction, BudgetCategory } from '../types';
import type { Toast } from '../types';

import ActiveBanksCard from './transaction_parsing/ActiveBanksCard';
import AITransactionsEnteredCard from './transaction_parsing/AITransactionsEnteredCard';
import SetupInfoCard from './transaction_parsing/SetupInfoCard';
import ClearConfirmModal from './transaction_parsing/ClearConfirmModal';
import PageShell from './ui/PageShell';
import LearnedRulesCard from './transaction_parsing/LearnedRulesCard';
import { useNotificationRules } from './transaction_parsing/useNotificationRules';
import type { NotATxRuleType } from './transaction_parsing/NotATransactionModal';

import { covaultNotification } from '../lib/covaultNotification';
import { restFetch } from '../lib/apiHelpers';
import { loadBankingAppsFromDB } from '../lib/bankingApps';
import { getNeedsReviewIdSet, getReviewQueueChangedEventName } from '../lib/localNotificationMemory';
import { buildFilePayload, buildUndoPayload } from '../lib/caughtTransactionOps';
import { selectAwaitingReview, countHiddenRefunds } from '../lib/reviewQueue';

/** Delay (ms) after scanning to allow notification processing before reloading data */
const SCAN_PROCESSING_DELAY_MS = 2000;

interface TransactionParsingProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onBack: () => void;
  onAddTransaction: () => void;
  onGoHome: () => void;
  allTransactions?: Transaction[];
  onTransactionTap?: (tx: Transaction) => void;
  budgets?: BudgetCategory[];
  userId?: string;
  onRefreshNotifications?: () => Promise<void>;
  onReloadTransactions?: (userId: string) => Promise<void>;
  onClearEntered?: () => void;
  /** Delete a transaction by ID. Used by the soft-dup badge to remove the
   *  similar older transaction when the user confirms a duplicate. */
  onDeleteTransaction?: (id: string) => void;
  /** Update a transaction (full record, persisted). Used by the inline
   *  vendor rename in the Caught Transactions list. The handler also
   *  writes the vendor correction to the overrides table. */
  onUpdateTransaction?: (tx: Transaction) => void;
  /** Currently-loaded vendor overrides, used by the Learned Rules card. */
  vendorOverrides?: import('./transaction_parsing/useVendorOverrides').VendorOverride[];
  /** Delete a vendor override. */
  onDeleteVendorOverride?: (overrideId: string) => void;
  /** Persist and update local state for a vendor category rule. */
  onSetVendorCategory: (vendorName: string, categoryId: string) => void | Promise<void>;
  /** Persist and update local state for a vendor display name. */
  onSetProperName: (vendorName: string, properName: string) => void | Promise<void>;
  /** Raise a transient toast — used for the Undo offered after filing a row. */
  onToast?: (toast: Toast) => void;
}

const TransactionParsing: React.FC<TransactionParsingProps> = ({
  enabled,
  onToggle,
  onBack,
  onAddTransaction,
  onGoHome,
  allTransactions = [],
  onTransactionTap,
  budgets = [],
  userId,
  onRefreshNotifications,
  onReloadTransactions,
  onClearEntered,
  onDeleteTransaction,
  onUpdateTransaction,
  vendorOverrides = [],
  onDeleteVendorOverride,
  onSetVendorCategory,
  onSetProperName,
  onToast,
}) => {
  // ── Clear modal state ──
  const [clearTarget, setClearTarget] = useState<'entered' | null>(null);
  // All sections always expanded per user request
  // Only the review queue starts open. The other two are reference/settings
  // content and previously pushed the actual task below the fold.
  const [expandedSections, setExpandedSections] = useState({
    activeBanks: false,
    caughtTransactions: true,
    learnedRules: false,
  });

  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }, []);


  // ── Refresh spinner state ──
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Monitored banking apps for ActiveBanksCard ──
  const [monitoredBanks, setMonitoredBanks] = useState<Map<string, string>>(new Map());

  const loadMonitoredBanks = useCallback(async () => {
    if (!covaultNotification) return;
    try {
      const knownBankingApps = await loadBankingAppsFromDB();
      const { apps: packageNames } = await covaultNotification.getMonitoredApps();
      const bankMap = new Map<string, string>();
      for (const pkg of packageNames) {
        if (pkg in knownBankingApps) {
          bankMap.set(pkg, knownBankingApps[pkg]);
        }
      }
      setMonitoredBanks(bankMap);
    } catch (e) {
      log.warn('[TransactionParsing] Error loading monitored banks:', e);
    }
  }, []);

  // Load monitored banks on mount and when notifications are enabled
  useEffect(() => {
    if (enabled) {
      loadMonitoredBanks();
    }
  }, [enabled, loadMonitoredBanks]);


  // needsReviewIds is the live source of truth for the review queue; any
  // count is derived from it at the point of use.
  const [needsReviewIds, setNeedsReviewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refreshReviewQueue = () => {
      setNeedsReviewIds(getNeedsReviewIdSet());
    };
    refreshReviewQueue();
    const eventName = getReviewQueueChangedEventName();
    window.addEventListener(eventName, refreshReviewQueue);
    return () => window.removeEventListener(eventName, refreshReviewQueue);
  }, []);

  // ── Captures still awaiting review ──
  // Shared definition (lib/reviewQueue.ts) so the card, the bottom-bar badge
  // and the home-screen widget cannot disagree. They used to: this filter kept
  // refunds, while the card rendered them out, so a captured refund made the
  // badge read one higher than the list it pointed at.
  const aiTransactions = useMemo(
    () => selectAwaitingReview(allTransactions),
    [allTransactions],
  );
  // Surfaced in the card's subtitle so filtered-out refunds are explained
  // rather than looking like captures that went missing.
  const hiddenRefundCount = useMemo(
    () => countHiddenRefunds(allTransactions),
    [allTransactions],
  );

  // ── Notification rules hook (skip patterns the user has trained) ──
  const {
    rules: notificationRules,
    create: createNotificationRule,
    remove: removeNotificationRule,
  } = useNotificationRules({ userId });

  // ── Inline vendor rename ──
  // Persists via the existing onUpdateTransaction path. The handler in
  // useTransactionOps already writes the vendor correction to the
  // overrides table (with match_type='exact' for inline renames; the
  // user can later change match_type via the VendorCategoryRulesCard).
  const handleVendorRenamed = useCallback(
    async (tx: Transaction, newVendor: string) => {
      if (!onUpdateTransaction) return;
      const updated: Transaction = { ...tx, vendor: newVendor };
      onUpdateTransaction(updated);
    },
    [onUpdateTransaction],
  );

  // ── "Not a transaction" flow ──
  // Creates a notification_rule (so future matches are skipped) and
  // deletes the row. Both ops are independent; if one fails the other
  // still runs and we log a warning.
  const handleMarkNotTransaction = useCallback(
    async (tx: Transaction, ruleType: NotATxRuleType) => {
      if (!userId) return;
      if (tx.raw_notification && tx.raw_notification.trim()) {
        try {
          await createNotificationRule({
            pattern: tx.raw_notification.trim(),
            pattern_type: ruleType,
          });
        } catch (err) {
          log.warn('[TransactionParsing] failed to create skip rule:', err);
        }
      }
      if (onDeleteTransaction) {
        await onDeleteTransaction(tx.id);
      }
    },
    [userId, createNotificationRule, onDeleteTransaction],
  );

  // ── Caught-transaction triage (Accept / Change / Create rule) ──
  // Files a caught transaction: sets caught_cleared (so it leaves the "Caught
  // Transactions" queue) plus any budget change, then reloads from the DB.
  const fileCaughtTransaction = useCallback(
    async (txId: string, extra: Record<string, unknown> = {}) => {
      try {
        await restFetch(`/transactions?id=eq.${txId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(buildFilePayload(extra)),
        });
      } catch (err) {
        log.warn('[TransactionParsing] file caught transaction failed:', err);
      }
      if (userId) await onReloadTransactions?.(userId);
    },
    [userId, onReloadTransactions],
  );

  // Un-file rows: the exact inverse of fileCaughtTransaction. `budget` is
  // restored explicitly rather than left alone, because Accept can be reached
  // from a path that also moved the row (Change category), and an Undo that
  // brings the row back under the wrong budget is worse than no Undo.
  const restoreCaughtTransactions = useCallback(
    async (rows: Array<{ id: string; budget: string | null }>) => {
      await Promise.all(
        rows.map(async ({ id, budget }) => {
          try {
            await restFetch(`/transactions?id=eq.${id}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify(buildUndoPayload(budget)),
            });
          } catch (err) {
            log.warn('[TransactionParsing] undo file failed:', err);
          }
        }),
      );
      if (userId) await onReloadTransactions?.(userId);
    },
    [userId, onReloadTransactions],
  );

  /** The row's category name as it stands right now, for restoring on Undo. */
  const budgetNameOf = useCallback(
    (tx: Transaction) => budgets.find((b) => b.id === tx.budget_id)?.name ?? null,
    [budgets],
  );

  // Accept: keep the current mapping, just file the row.
  const handleAcceptCaught = useCallback(
    async (tx: Transaction) => {
      const previousBudget = budgetNameOf(tx);
      await fileCaughtTransaction(tx.id);
      onToast?.({
        message: `Filed ${tx.vendor}`,
        tone: 'info',
        action: {
          label: 'Undo',
          run: () => { void restoreCaughtTransactions([{ id: tx.id, budget: previousBudget }]); },
        },
      });
    },
    [fileCaughtTransaction, budgetNameOf, onToast, restoreCaughtTransactions],
  );

  // Bulk accept: same as above for every row the card offered, undone together.
  const handleAcceptMany = useCallback(
    async (txs: Transaction[]) => {
      if (txs.length === 0) return;
      // Snapshot before filing — after the reload these rows are gone from state.
      const snapshot = txs.map((tx) => ({ id: tx.id, budget: budgetNameOf(tx) }));
      const idList = txs.map((tx) => `"${tx.id.replace(/"/g, '')}"`).join(',');
      try {
        await restFetch(`/transactions?id=in.(${idList})`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(buildFilePayload()),
        });
      } catch (err) {
        log.warn('[TransactionParsing] bulk accept failed:', err);
      }
      if (userId) await onReloadTransactions?.(userId);
      onToast?.({
        message: `Filed ${txs.length} transactions`,
        tone: 'info',
        action: {
          label: 'Undo',
          run: () => { void restoreCaughtTransactions(snapshot); },
        },
      });
    },
    [budgetNameOf, userId, onReloadTransactions, onToast, restoreCaughtTransactions],
  );

  // Change: move the row to a different budget, then file.
  const handleChangeCaughtCategory = useCallback(
    (tx: Transaction, budgetId: string) => {
      const name = budgets.find((b) => b.id === budgetId)?.name;
      return fileCaughtTransaction(tx.id, name ? { budget: name } : {});
    },
    [fileCaughtTransaction, budgets],
  );

  // Create rule: persist a vendor→budget override (future captures auto-match),
  // set this row's budget to match, then file.
  const handleCreateRuleForCaught = useCallback(
    async (tx: Transaction, budgetId: string) => {
      const name = budgets.find((b) => b.id === budgetId)?.name;
      try {
        await onSetVendorCategory(tx.vendor, budgetId);
      } catch (err) {
        log.warn('[TransactionParsing] create rule failed:', err);
      }
      await fileCaughtTransaction(tx.id, name ? { budget: name } : {});
    },
    [fileCaughtTransaction, budgets, onSetVendorCategory],
  );

  // Default no-op for vendor override deletion when not provided
  const handleDeleteVendorOverride = useCallback(
    (overrideId: string) => {
      if (onDeleteVendorOverride) {
        onDeleteVendorOverride(overrideId);
      } else {
        log.warn('[TransactionParsing] onDeleteVendorOverride not provided; cannot delete', overrideId);
      }
    },
    [onDeleteVendorOverride],
  );

  const categoryNameById = useMemo(
    () => new Map<string, string>(budgets.map((b) => [b.id, b.name])),
    [budgets],
  );

  // Local state for the expanded vendor (managed here so the card stays presentational)
  const [expandedVendorCategory, setExpandedVendorCategory] = useState<string | null>(null);

  const handleSetVendorCategory = useCallback(
    async (vendorName: string, categoryId: string) => {
      await onSetVendorCategory(vendorName, categoryId);
      setExpandedVendorCategory(null);
    },
    [onSetVendorCategory],
  );

  const handleSetProperName = useCallback(
    async (vendorName: string, properName: string) => {
      await onSetProperName(vendorName, properName);
    },
    [onSetProperName],
  );

  // When notifications are enabled, trigger a scan and reload data
  // after a short delay so newly processed notifications appear.
  const prevEnabled = React.useRef(enabled);
  const reloadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanCancelledRef = React.useRef(false);
  useEffect(() => {
    const wasEnabled = prevEnabled.current;
    prevEnabled.current = enabled;
    scanCancelledRef.current = false;

    if (!wasEnabled && enabled) {
      // Notifications were just enabled — refresh after scan has time to process
      (async () => {
        try {
          if (onRefreshNotifications) {
            await onRefreshNotifications();
          }
          if (scanCancelledRef.current) return;
          reloadTimeoutRef.current = setTimeout(async () => {
            if (scanCancelledRef.current) return;
            if (onReloadTransactions && userId) {
              await onReloadTransactions(userId);
            }
          }, SCAN_PROCESSING_DELAY_MS);
        } catch (e) {
          log.error('[TransactionParsing] refresh after enable failed:', e);
        }
      })();
    }

    return () => {
      scanCancelledRef.current = true;
      if (reloadTimeoutRef.current != null) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, [enabled, onRefreshNotifications, onReloadTransactions, userId]);

  // Refresh monitored banks on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadMonitoredBanks();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadMonitoredBanks]);

  // ── Clear handlers ──
  const handleClearEntered = useCallback(async () => {
    if (!userId) return;
    const aiIds = aiTransactions.map((tx) => tx.id);
    if (aiIds.length === 0) return;
    try {
      const idList = aiIds.map(id => `"${id.replace(/"/g, '')}"`).join(',');
      const res = await restFetch(`/transactions?id=in.(${idList})`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ caught_cleared: true }),
      });
      if (!res.ok) {
        log.error('[TransactionParsing] Error clearing entered:', res.status);
        return;
      }
    } catch (err) {
      log.error('[TransactionParsing] Error clearing entered:', err);
      return;
    }
    onClearEntered?.();
    await onReloadTransactions?.(userId);
  }, [userId, aiTransactions, onClearEntered, onReloadTransactions]);

  // ── Refresh handler ──
  const followUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (followUpTimerRef.current != null) clearTimeout(followUpTimerRef.current);
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (onRefreshNotifications) {
        await onRefreshNotifications();
      }
      // scanActiveNotifications resolves immediately while notification events
      // are still moving through the AI pipeline, so show whatever has landed
      // right away rather than holding the spinner on a fixed timer.
      if (onReloadTransactions && userId) {
        await onReloadTransactions(userId);
      }
    } finally {
      setIsRefreshing(false);
      loadMonitoredBanks();
      // Slower AI extractions land after the scan resolves. Pick them up in the
      // background — the spinner is already gone, the list just fills in.
      if (onReloadTransactions && userId) {
        followUpTimerRef.current = setTimeout(() => {
          followUpTimerRef.current = null;
          void onReloadTransactions(userId);
        }, 2500);
      }
    }
  }, [isRefreshing, onRefreshNotifications, onReloadTransactions, userId, loadMonitoredBanks]);

  return (
    <PageShell>
      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-2 shrink-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-500 dark:text-slate-100 tracking-tight">
              Review
            </h1>
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-0.5 truncate">
              {enabled
                ? 'Transactions Covault caught from your bank alerts'
                : 'Turn on capture to log transactions automatically'}
            </p>
          </div>
          {enabled && (
            <button
              type="button"
              onClick={() => onToggle(false)}
              className="shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 active:scale-95 transition-all"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Capture on
            </button>
          )}
        </div>
      </header>

      {/* Main content — single flex container (no extra wrapper) */}
      <main
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-4 pb-0 max-w-2xl mx-auto w-full relative z-10"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {enabled ? (
          <>
            <div className="shrink-0 mb-4">
              <ActiveBanksCard
                activeBanks={monitoredBanks}
                isExpanded={expandedSections.activeBanks}
                onToggleExpanded={() => toggleSection('activeBanks')}
              />
            </div>

            <AITransactionsEnteredCard
              aiTransactions={aiTransactions}
              budgets={budgets}
              onTransactionTap={onTransactionTap}
              onClear={() => setClearTarget('entered')}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
              refundCount={hiddenRefundCount}
              needsReviewIds={needsReviewIds}
              onDeleteTransaction={onDeleteTransaction}
              onVendorRenamed={handleVendorRenamed}
              onMarkNotTransaction={handleMarkNotTransaction}
              userId={userId}
              isExpanded={expandedSections.caughtTransactions}
              onToggleExpanded={() => toggleSection('caughtTransactions')}
              vendorOverrides={vendorOverrides}
              onAccept={handleAcceptCaught}
              onChangeCategory={handleChangeCaughtCategory}
              onCreateRule={handleCreateRuleForCaught}
              onAcceptMany={handleAcceptMany}
            />

            <div className="shrink-0 mt-4">
              <LearnedRulesCard
                vendorOverrides={vendorOverrides}
                categoryNameById={categoryNameById}
                budgets={budgets}
                allTransactions={allTransactions}
                rules={notificationRules}
                onRemoveRule={removeNotificationRule}
                onDeleteVendorOverride={handleDeleteVendorOverride}
                onSetVendorCategory={handleSetVendorCategory}
                onSetProperName={handleSetProperName}
                onSetExpandedVendorCategory={setExpandedVendorCategory}
                expandedVendorCategory={expandedVendorCategory}
                isExpanded={expandedSections.learnedRules}
                onToggleExpanded={() => toggleSection('learnedRules')}
              />
            </div>
          </>
        ) : (
          <SetupInfoCard enabled={enabled} onToggle={onToggle} />
        )}
      </main>

      <div
        aria-hidden="true"
        className="shrink-0"
        style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
      />

      <DashboardBottomBar
        onGoHome={onGoHome}
        onAddTransaction={onAddTransaction}
        onOpenParsing={onBack}
        activeView="parsing"
        pendingCount={aiTransactions.length}
      />

      {/* Clear confirmation modal */}
      {clearTarget && (
        <ClearConfirmModal
          count={aiTransactions.length}
          onConfirm={async () => {
            await handleClearEntered();
            setClearTarget(null);
          }}
          onCancel={() => setClearTarget(null)}
        />
      )}
    </PageShell>
  );
};

export default TransactionParsing;