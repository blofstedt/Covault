import React, { useState, useCallback, useEffect, useMemo } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import { Transaction, BudgetCategory } from '../types';

import ActiveBanksCard from './transaction_parsing/ActiveBanksCard';
import AITransactionsEnteredCard from './transaction_parsing/AITransactionsEnteredCard';
import SetupInfoCard from './transaction_parsing/SetupInfoCard';
import ClearConfirmModal from './transaction_parsing/ClearConfirmModal';
import PageShell from './ui/PageShell';

import { supabase } from '../lib/supabase';
import { covaultNotification } from '../lib/covaultNotification';
import { loadBankingAppsFromDB } from '../lib/bankingApps';
import { getNeedsReviewCount, getNeedsReviewIdSet, getReviewQueueChangedEventName } from '../lib/localNotificationMemory';

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
}) => {
  // ── Clear modal state ──
  const [clearTarget, setClearTarget] = useState<'entered' | null>(null);

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
      console.warn('[TransactionParsing] Error loading monitored banks:', e);
    }
  }, []);

  // Load monitored banks on mount and when notifications are enabled
  useEffect(() => {
    if (enabled) {
      loadMonitoredBanks();
    }
  }, [enabled, loadMonitoredBanks]);


  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [needsReviewIds, setNeedsReviewIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refreshReviewQueue = () => {
      setNeedsReviewCount(getNeedsReviewCount());
      setNeedsReviewIds(getNeedsReviewIdSet());
    };
    refreshReviewQueue();
    const eventName = getReviewQueueChangedEventName();
    window.addEventListener(eventName, refreshReviewQueue);
    return () => window.removeEventListener(eventName, refreshReviewQueue);
  }, []);

  // ── AI-entered transactions (label === 'AI') ──
  const aiTransactions = useMemo(
    () => allTransactions.filter((tx) => tx.label === 'Automatic' && !tx.caught_cleared),
    [allTransactions],
  );

  // When notifications are enabled, trigger a scan and reload data
  // after a short delay so newly processed notifications appear.
  const prevEnabled = React.useRef(enabled);
  const reloadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const wasEnabled = prevEnabled.current;
    prevEnabled.current = enabled;

    if (!wasEnabled && enabled) {
      // Notifications were just enabled — refresh after scan has time to process
      (async () => {
        if (onRefreshNotifications) {
          await onRefreshNotifications();
        }
        reloadTimeoutRef.current = setTimeout(async () => {
          if (onReloadTransactions && userId) {
            await onReloadTransactions(userId);
          }
        }, SCAN_PROCESSING_DELAY_MS);
      })();
    }

    return () => {
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
    const { error } = await supabase
      .from('transactions')
      .update({ caught_cleared: true })
      .in('id', aiIds);
    if (error) {
      console.error('[TransactionParsing] Error clearing entered:', error);
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
        className="px-6 pt-safe-top pb-2 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <div className="flex items-center justify-center">
          <h1 className="text-xl font-bold text-slate-500 dark:text-slate-100 tracking-tight">
            Transaction Parsing
          </h1>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 min-h-0 flex flex-col p-4 overflow-hidden relative z-10">
        <div className="max-w-2xl mx-auto w-full flex-1 min-h-0 flex flex-col gap-4">
          {enabled ? (
            <>
              <div className="shrink-0">
                <ActiveBanksCard
                  activeBanks={monitoredBanks}
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
              />
            </>
          ) : (
            <SetupInfoCard enabled={enabled} onToggle={onToggle} />
          )}
        </div>
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
