import React, { useState, useCallback, useEffect, useMemo } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import { Transaction, BudgetCategory } from '../types';

import ActiveBanksCard from './transaction_parsing/ActiveBanksCard';
import AITransactionsEnteredCard from './transaction_parsing/AITransactionsEnteredCard';
import AITransactionsRejectedCard from './transaction_parsing/AITransactionsRejectedCard';
import type { AIRejectedTransaction } from './transaction_parsing/AITransactionsRejectedCard';
import SetupInfoCard from './transaction_parsing/SetupInfoCard';
import ClearConfirmModal from './transaction_parsing/ClearConfirmModal';
import PageShell from './ui/PageShell';

import { supabase } from '../lib/supabase';
import { covaultNotification } from '../lib/covaultNotification';
import { KNOWN_BANKING_APPS } from '../lib/bankingApps';

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
  isTutorialMode?: boolean;
  showDemoData?: boolean;
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
  isTutorialMode = false,
  showDemoData = false,
  onRefreshNotifications,
  onReloadTransactions,
  onClearEntered,
}) => {
  // ── State for rejected notifications ──
  const [rejectedNotifications, setRejectedNotifications] = useState<AIRejectedTransaction[]>([]);

  // ── Clear modal state ──
  const [clearTarget, setClearTarget] = useState<'entered' | 'rejected' | null>(null);

  // ── Refresh spinner state ──
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Monitored banking apps for ActiveBanksCard ──
  const [monitoredBanks, setMonitoredBanks] = useState<Map<string, string>>(new Map());

  const loadMonitoredBanks = useCallback(async () => {
    if (!covaultNotification) return;
    try {
      const { apps: packageNames } = await covaultNotification.getMonitoredApps();
      const bankMap = new Map<string, string>();
      for (const pkg of packageNames) {
        if (pkg in KNOWN_BANKING_APPS) {
          bankMap.set(pkg, KNOWN_BANKING_APPS[pkg]);
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

  // ── AI-entered transactions (label === 'AI') ──
  const aiTransactions = useMemo(
    () => allTransactions.filter((tx) => tx.label === 'AI'),
    [allTransactions],
  );

  // ── Load rejected notifications from pending_transactions ──
  const loadRejectedNotifications = useCallback(async () => {
    if (!userId) return;

    const { data, error } = await supabase
      .from('pending_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'rejected')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[TransactionParsing] Error loading rejected:', error);
      return;
    }

    if (data) {
      const rejected: AIRejectedTransaction[] = data.map((pt: any) => ({
        id: pt.id,
        vendor: pt.extracted_vendor || undefined,
        amount: pt.extracted_amount || undefined,
        reason: pt.rejection_reason || 'Rejected by AI',
        bankName: pt.app_name || undefined,
        timestamp: pt.created_at,
      }));
      setRejectedNotifications(rejected);
    }
  }, [userId]);

  // Load on mount
  useEffect(() => {
    loadRejectedNotifications();
  }, [loadRejectedNotifications]);

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
          await loadRejectedNotifications();
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
  }, [enabled, onRefreshNotifications, onReloadTransactions, userId, loadRejectedNotifications]);

  // Refresh data on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadRejectedNotifications();
        loadMonitoredBanks();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadRejectedNotifications, loadMonitoredBanks]);

  // ── Clear handlers ──
  const handleClearEntered = useCallback(async () => {
    if (!userId) return;
    const aiIds = aiTransactions.map((tx) => tx.id);
    if (aiIds.length === 0) return;
    const { error } = await supabase.from('transactions').delete().in('id', aiIds);
    if (error) {
      console.error('[TransactionParsing] Error clearing entered:', error);
      return;
    }
    onClearEntered?.();
  }, [userId, aiTransactions, onClearEntered]);

  const handleClearRejected = useCallback(async () => {
    if (!userId) return;
    const rejectedIds = rejectedNotifications.map((r) => r.id);
    // Always clear local state so the UI updates immediately
    setRejectedNotifications([]);
    if (rejectedIds.length === 0) return;
    const { error } = await supabase.from('pending_transactions').delete().in('id', rejectedIds);
    if (error) {
      console.error('[TransactionParsing] Error clearing rejected:', error);
    }
  }, [userId, rejectedNotifications]);

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
      await loadRejectedNotifications();
      if (onReloadTransactions && userId) {
        await onReloadTransactions(userId);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      await loadRejectedNotifications();
      if (onReloadTransactions && userId) {
        await onReloadTransactions(userId);
      }
    } finally {
      setIsRefreshing(false);
      loadMonitoredBanks();
    }
  }, [isRefreshing, onRefreshNotifications, onReloadTransactions, userId, loadRejectedNotifications, loadMonitoredBanks]);

  return (
    <PageShell>
      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-2 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <div className="flex items-center justify-center">
          <h1 className="text-xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            Transaction Parsing
          </h1>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col p-4 pb-24 overflow-y-auto relative z-10">
        <div className="max-w-2xl mx-auto w-full space-y-4">
          {enabled || isTutorialMode ? (
            <>
              <ActiveBanksCard
                activeBanks={monitoredBanks}
                showDemoData={showDemoData}
              />

              <AITransactionsEnteredCard
                aiTransactions={aiTransactions}
                budgets={budgets}
                showDemoData={showDemoData}
                onTransactionTap={onTransactionTap}
                onClear={() => setClearTarget('entered')}
                onRefresh={handleRefresh}
                isRefreshing={isRefreshing}
              />

              <AITransactionsRejectedCard
                rejectedTransactions={rejectedNotifications}
                showDemoData={showDemoData}
                onClear={() => setClearTarget('rejected')}
              />
            </>
          ) : (
            <SetupInfoCard enabled={enabled} onToggle={onToggle} />
          )}
        </div>
      </main>

      <DashboardBottomBar
        onGoHome={onGoHome}
        onAddTransaction={onAddTransaction}
        onOpenParsing={onBack}
        activeView="parsing"
      />

      {/* Clear confirmation modal */}
      {clearTarget && (
        <ClearConfirmModal
          cardName={clearTarget === 'entered' ? 'Transactions Entered' : 'Transactions Rejected'}
          onConfirm={async () => {
            if (clearTarget === 'entered') {
              await handleClearEntered();
            } else {
              await handleClearRejected();
            }
            setClearTarget(null);
          }}
          onCancel={() => setClearTarget(null)}
        />
      )}
    </PageShell>
  );
};

export default TransactionParsing;
