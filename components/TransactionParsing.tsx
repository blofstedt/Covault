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
  onApprovePending?: (pendingId: string, categoryId: string) => void | Promise<void>;
  onRejectPending?: (pendingId: string) => void;
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
  onRefreshNotifications,
  onReloadPendingTransactions,
  userId,
  isTutorialMode = false,
  showDemoData = false,
}) => {
  // ── UI-only state ──
  const [expandedPendingId, setExpandedPendingId] = useState<string | null>(null);
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null);
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

  return (
    <div className="flex-1 flex flex-col h-screen relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
      {/* Background glow */}
      <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700 animate-nest">
        <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/25 dark:bg-emerald-500/35"></div>
        <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/20 dark:bg-green-400/30"></div>
      </div>

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
              />

              <IgnoredNotificationsCard
                keywordIgnoredNotifications={categories.keywordIgnoredNotifications}
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
        pendingCount={categories.toReviewCount + categories.capturedCount}
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
    </div>
  );
};

export default TransactionParsing;
