import React, { useState, useCallback, useEffect } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import RegexSetupModal from './RegexSetupModal';
import { PendingTransaction, BudgetCategory, Transaction } from '../types';

import NotificationToggleCard from './transaction_parsing/NotificationToggleCard';
import ParsingRulesCard from './transaction_parsing/ParsingRulesCard';
import VendorCategoryRulesCard from './transaction_parsing/VendorCategoryRulesCard';
import IgnoredNotificationsCard from './transaction_parsing/IgnoredNotificationsCard';
import CapturedNotificationsCard from './transaction_parsing/CapturedNotificationsCard';
import ToBeReviewedCard from './transaction_parsing/ToBeReviewedCard';
import ApprovedTransactionsCard from './transaction_parsing/ApprovedTransactionsCard';
import RejectedTransactionsCard from './transaction_parsing/RejectedTransactionsCard';
import SetupInfoCard from './transaction_parsing/SetupInfoCard';
import RejectConfirmModal from './transaction_parsing/RejectConfirmModal';
import ConfirmModal from './ui/ConfirmModal';
import PageShell from './ui/PageShell';

import { useParsingRules } from './transaction_parsing/useParsingRules';
import { useVendorOverrides } from './transaction_parsing/useVendorOverrides';
import { useTransactionCategories } from './transaction_parsing/useTransactionCategories';

/** Delay before reloading pending transactions after a scan, to allow the notification pipeline to finish processing. */
const SCAN_PROCESSING_DELAY_MS = 2000;

interface TransactionParsingProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onBack: () => void;
  onAddTransaction: () => void;
  onGoHome: () => void;
  autoDetectedTransactions?: Transaction[];
  onTransactionTap?: (tx: Transaction) => void;
  pendingTransactions?: PendingTransaction[];
  budgets?: BudgetCategory[];
  onApprovePending?: (pendingId: string, categoryId: string, preferredName?: string) => void | Promise<void>;
  onRejectPending?: (pendingId: string) => void;
  onClearFilteredNotifications?: (ids: string[]) => Promise<void>;
  onClearApprovedTransactions?: (ids: string[]) => Promise<void>;
  onRefreshNotifications?: () => Promise<void>;
  onReloadPendingTransactions?: (userId: string) => Promise<void>;
  userId?: string;
  isTutorialMode?: boolean;
  showDemoData?: boolean;
}

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
  onApprovePending,
  onRejectPending,
  onClearFilteredNotifications,
  onClearApprovedTransactions,
  onRefreshNotifications,
  onReloadPendingTransactions,
  userId,
  isTutorialMode = false,
  showDemoData = false,
}) => {
  // ── UI-only state ──
  const [expandedPendingId, setExpandedPendingId] = useState<string | null>(null);
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState<'filtered' | 'approved' | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // ── Vendor overrides (CRUD + state) ──
  const vendorOverridesHook = useVendorOverrides({ userId, budgets });

  // ── Parsing rules (CRUD + state) ──
  const parsingRulesHook = useParsingRules({
    userId,
    onReloadPendingTransactions,
    loadVendorOverrides: vendorOverridesHook.loadVendorOverrides,
  });

  // ── Derived/computed transaction categories ──
  const categories = useTransactionCategories({
    pendingTransactions,
    autoDetectedTransactions,
    vendorOverrides: vendorOverridesHook.vendorOverrides,
    budgets,
    savedRules: parsingRulesHook.savedRules,
  });

  // Load data on mount and refresh on visibility change
  useEffect(() => {
    vendorOverridesHook.loadVendorOverrides();
    parsingRulesHook.loadRules();
  }, [vendorOverridesHook.loadVendorOverrides, parsingRulesHook.loadRules]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        parsingRulesHook.loadRules();
        vendorOverridesHook.loadVendorOverrides();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [parsingRulesHook.loadRules, vendorOverridesHook.loadVendorOverrides]);

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
      await parsingRulesHook.loadRules();
      await vendorOverridesHook.loadVendorOverrides();
    } catch (err) {
      console.error('[TransactionParsing] Error scanning for transactions:', err);
    } finally {
      setIsScanning(false);
    }
  }, [onRefreshNotifications, onReloadPendingTransactions, userId, parsingRulesHook.loadRules, vendorOverridesHook.loadVendorOverrides]);

  // ── Handle clear confirmation ──
  const handleClearConfirm = useCallback(async () => {
    try {
      if (clearConfirm === 'filtered' && onClearFilteredNotifications) {
        const ids = categories.filteredOutNotifications.map((pt) => pt.id);
        await onClearFilteredNotifications(ids);
      } else if (clearConfirm === 'approved' && onClearApprovedTransactions) {
        const ids = categories.approvedTransactions.map((tx) => tx.id);
        await onClearApprovedTransactions(ids);
      }
    } finally {
      setClearConfirm(null);
    }
  }, [clearConfirm, onClearFilteredNotifications, onClearApprovedTransactions, categories.filteredOutNotifications, categories.approvedTransactions]);

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

              <ParsingRulesCard
                savedRules={parsingRulesHook.savedRules}
                rulesByBank={categories.rulesByBank}
                showDemoData={showDemoData}
                addingRuleForBank={parsingRulesHook.addingRuleForBank}
                newRuleType={parsingRulesHook.newRuleType}
                keywordEditRuleId={parsingRulesHook.keywordEditRuleId}
                onlyParseText={parsingRulesHook.onlyParseText}
                keywordMode={parsingRulesHook.keywordMode}
                savingKeywords={parsingRulesHook.savingKeywords}
                onStartAddRuleForBank={parsingRulesHook.handleStartAddRuleForBank}
                onSetAddingRuleForBank={parsingRulesHook.setAddingRuleForBank}
                onSetNewRuleType={parsingRulesHook.setNewRuleType}
                onConfirmNewRuleType={parsingRulesHook.handleConfirmNewRuleType}
                onEditRule={parsingRulesHook.handleEditRule}
                onOpenKeywordEdit={parsingRulesHook.handleOpenKeywordEdit}
                onSetKeywordEditRuleId={parsingRulesHook.setKeywordEditRuleId}
                onSetOnlyParseText={parsingRulesHook.setOnlyParseText}
                onSetKeywordMode={parsingRulesHook.setKeywordMode}
                onSaveKeywords={parsingRulesHook.handleSaveKeywords}
              />

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
                onSetProperName={vendorOverridesHook.handleSetProperName}
              />

              <IgnoredNotificationsCard
                filteredOutNotifications={categories.filteredOutNotifications}
                onClear={onClearFilteredNotifications ? () => setClearConfirm('filtered') : undefined}
              />

              <CapturedNotificationsCard
                capturedByBank={categories.capturedByBank}
                capturedCount={categories.capturedCount}
                onSetupNotification={parsingRulesHook.setSetupNotification}
              />

              <ToBeReviewedCard
                toReviewTransactions={categories.toReviewTransactions}
                toReviewCount={categories.toReviewCount}
                expandedPendingId={expandedPendingId}
                vendorOverrideByName={categories.vendorOverrideByName}
                categoryNameById={categories.categoryNameById}
                budgets={budgets}
                showDemoData={showDemoData}
                isScanning={isScanning}
                onSetExpandedPendingId={setExpandedPendingId}
                onApprovePending={onApprovePending}
                onRejectConfirm={setRejectConfirmId}
                onLoadVendorOverrides={vendorOverridesHook.loadVendorOverrides}
                onScanForTransactions={handleScanForTransactions}
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
        pendingCount={categories.toReviewCount}
      />

      {/* Regex Setup Modal */}
      {parsingRulesHook.setupNotification && (
        <RegexSetupModal
          notification={parsingRulesHook.setupNotification}
          onSave={parsingRulesHook.editingRuleId ? parsingRulesHook.handleSaveEditedRule : (parsingRulesHook.newRuleType ? parsingRulesHook.handleSaveNewTypedRule : parsingRulesHook.handleSaveRule)}
          onClose={() => {
            parsingRulesHook.setSetupNotification(null);
            parsingRulesHook.setEditingRuleId(null);
            parsingRulesHook.setNewRuleType('');
          }}
        />
      )}

      {/* Reject Confirmation Modal */}
      {rejectConfirmId && (
        <RejectConfirmModal
          rejectConfirmId={rejectConfirmId}
          onCancel={() => setRejectConfirmId(null)}
          onConfirm={(id) => {
            onRejectPending?.(id);
            setExpandedPendingId(null);
            setRejectConfirmId(null);
          }}
        />
      )}

      {/* Clear Confirmation Modal */}
      {clearConfirm && (
        <ConfirmModal
          title={clearConfirm === 'filtered' ? 'Clear Filtered Notifications?' : 'Clear Approved Transactions?'}
          message={
            clearConfirm === 'filtered'
              ? 'This will permanently remove all filtered notifications from this list.'
              : 'This will remove the auto-added label from all approved transactions. They will remain in your budget.'
          }
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
