import React, { useState, useCallback, useEffect } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import { BudgetCategory, Transaction } from '../types';

import NotificationToggleCard from './transaction_parsing/NotificationToggleCard';
import VendorCategoryRulesCard from './transaction_parsing/VendorCategoryRulesCard';
import ApprovedTransactionsCard from './transaction_parsing/ApprovedTransactionsCard';
import RejectedTransactionsCard from './transaction_parsing/RejectedTransactionsCard';
import SetupInfoCard from './transaction_parsing/SetupInfoCard';
import ConfirmModal from './ui/ConfirmModal';
import PageShell from './ui/PageShell';

import { useVendorOverrides } from './transaction_parsing/useVendorOverrides';
import { useTransactionCategories } from './transaction_parsing/useTransactionCategories';

interface TransactionParsingProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onBack: () => void;
  onAddTransaction: () => void;
  onGoHome: () => void;
  autoDetectedTransactions?: Transaction[];
  onTransactionTap?: (tx: Transaction) => void;
  pendingTransactions?: import('../types').PendingTransaction[];
  budgets?: BudgetCategory[];
  onClearApprovedTransactions?: (ids: string[]) => Promise<void>;
  onRefreshNotifications?: () => Promise<void>;
  onReloadPendingTransactions?: (userId: string) => Promise<void>;
  userId?: string;
  isTutorialMode?: boolean;
  showDemoData?: boolean;
}

/** Delay before reloading pending transactions after a scan, to allow the notification pipeline to finish processing. */
const SCAN_PROCESSING_DELAY_MS = 2000;

const TransactionParsing: React.FC<TransactionParsingProps> = ({
  enabled,
  onToggle,
  onBack,
  onAddTransaction,
  onGoHome,
  autoDetectedTransactions = [],
  onTransactionTap,
  pendingTransactions = [],
  budgets = [],
  onClearApprovedTransactions,
  onRefreshNotifications,
  onReloadPendingTransactions,
  userId,
  isTutorialMode = false,
  showDemoData = false,
}) => {
  // ── UI-only state ──
  const [clearConfirm, setClearConfirm] = useState<'approved' | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // ── Vendor overrides (CRUD + state) ──
  const vendorOverridesHook = useVendorOverrides({ userId, budgets });

  // ── Derived/computed transaction categories ──
  const categories = useTransactionCategories({
    pendingTransactions,
    autoDetectedTransactions,
    vendorOverrides: vendorOverridesHook.vendorOverrides,
    budgets,
  });

  // Load data on mount and refresh on visibility change
  useEffect(() => {
    vendorOverridesHook.loadVendorOverrides();
  }, [vendorOverridesHook.loadVendorOverrides]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        vendorOverridesHook.loadVendorOverrides();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [vendorOverridesHook.loadVendorOverrides]);

  // ── Handle manual scan for transactions ──
  const handleScanForTransactions = useCallback(async () => {
    setIsScanning(true);
    try {
      if (onRefreshNotifications) {
        await onRefreshNotifications();
      }
      await new Promise((resolve) => setTimeout(resolve, SCAN_PROCESSING_DELAY_MS));
      if (onReloadPendingTransactions && userId) {
        await onReloadPendingTransactions(userId);
      }
      await vendorOverridesHook.loadVendorOverrides();
    } catch (err) {
      console.error('[TransactionParsing] Error scanning for transactions:', err);
    } finally {
      setIsScanning(false);
    }
  }, [onRefreshNotifications, onReloadPendingTransactions, userId, vendorOverridesHook.loadVendorOverrides]);

  // ── Handle clear confirmation ──
  const handleClearConfirm = useCallback(async () => {
    try {
      if (clearConfirm === 'approved' && onClearApprovedTransactions) {
        const ids = categories.approvedTransactions.map((tx) => tx.id);
        await onClearApprovedTransactions(ids);
      }
    } finally {
      setClearConfirm(null);
    }
  }, [clearConfirm, onClearApprovedTransactions, categories.approvedTransactions]);

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
              <NotificationToggleCard enabled={enabled} onToggle={onToggle} />

              <VendorCategoryRulesCard
                allVendors={categories.allVendors}
                vendorOverrideByName={categories.vendorOverrideByName}
                categoryNameById={categories.categoryNameById}
                expandedVendorCategory={vendorOverridesHook.expandedVendorCategory}
                budgets={budgets}
                showDemoData={showDemoData}
                onSetExpandedVendorCategory={vendorOverridesHook.setExpandedVendorCategory}
                onToggleAutoAccept={vendorOverridesHook.handleToggleAutoAccept}
                onSetVendorCategory={vendorOverridesHook.handleSetVendorCategory}
                onDeleteVendorOverride={vendorOverridesHook.handleDeleteVendorOverride}
              />

              <ApprovedTransactionsCard
                approvedTransactions={categories.approvedTransactions}
                vendorOverrideByName={categories.vendorOverrideByName}
                showDemoData={showDemoData}
                onTransactionTap={onTransactionTap}
                onClear={onClearApprovedTransactions ? () => setClearConfirm('approved') : undefined}
              />

              <RejectedTransactionsCard
                rejectedTransactions={categories.rejectedTransactions}
              />

              {/* Scan for Transactions button */}
              <button
                onClick={handleScanForTransactions}
                disabled={isScanning}
                className="w-full py-2.5 text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/40 transition-all active:scale-[0.98] hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50"
              >
                {isScanning ? 'Scanning…' : 'Scan for Transactions'}
              </button>
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

      {/* Clear Confirmation Modal */}
      {clearConfirm && (
        <ConfirmModal
          title="Clear Approved Transactions?"
          message="This will clear approved transactions from this list. They will remain in your budget."
          confirmLabel="Clear"
          cancelLabel="Cancel"
          variant="danger"
          icon={
            <svg className="w-6 h-6 text-rose-500 dark:text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
            </svg>
          }
          onConfirm={handleClearConfirm}
          onCancel={() => setClearConfirm(null)}
        />
      )}
    </PageShell>
  );
};

export default TransactionParsing;
