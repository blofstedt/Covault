import { log } from '../lib/log';
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import { Transaction, BudgetCategory } from '../types';

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
}) => {
  // ── Clear modal state ──
  const [clearTarget, setClearTarget] = useState<'entered' | null>(null);
  // All sections always expanded per user request
  const [expandedSections, setExpandedSections] = useState({
    activeBanks: true,
    caughtTransactions: true,
    learnedRules: true,
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

  // ── AI-entered transactions (label === 'Automatic', not yet cleared) ──
  const aiTransactions = useMemo(
    () => allTransactions.filter((tx) => tx.label === 'Automatic' && !tx.caught_cleared),
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
          body: JSON.stringify({ caught_cleared: true, ...extra }),
        });
      } catch (err) {
        log.warn('[TransactionParsing] file caught transaction failed:', err);
      }
      if (userId) await onReloadTransactions?.(userId);
    },
    [userId, onReloadTransactions],
  );

  // Accept: keep the current mapping, just file the row.
  const handleAcceptCaught = useCallback(
    (tx: Transaction) => fileCaughtTransaction(tx.id),
    [fileCaughtTransaction],
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
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (onRefreshNotifications) {
        await onRefreshNotifications();
      }
      // scanActiveNotifications resolves immediately while notification
      // events are processed asynchronously through the AI pipeline.
      // Reload after a short delay to pick up fast-processing results,
      // then again after a longer delay for slower AI extractions.
      await new Promise(resolve => setTimeout(resolve, 1500));
      if (onReloadTransactions && userId) {
        await onReloadTransactions(userId);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (onReloadTransactions && userId) {
        await onReloadTransactions(userId);
      }
    } finally {
      setIsRefreshing(false);
      loadMonitoredBanks();
    }
  }, [isRefreshing, onRefreshNotifications, onReloadTransactions, userId, loadMonitoredBanks]);

  return (
    <PageShell>
      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-2 shrink-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <div className="flex items-center justify-center">
          <h1 className="text-xl font-bold text-slate-500 dark:text-slate-100 tracking-tight">
            Transaction Parsing
          </h1>
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
          cardName="Caught Transactions"
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