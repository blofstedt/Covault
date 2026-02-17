import React, { useState, useCallback, useEffect, useMemo } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import { Transaction, BudgetCategory } from '../types';

import NotificationToggleCard from './transaction_parsing/NotificationToggleCard';
import ActiveBanksCard from './transaction_parsing/ActiveBanksCard';
import AITransactionsEnteredCard from './transaction_parsing/AITransactionsEnteredCard';
import AITransactionsRejectedCard from './transaction_parsing/AITransactionsRejectedCard';
import type { AIRejectedTransaction } from './transaction_parsing/AITransactionsRejectedCard';
import SetupInfoCard from './transaction_parsing/SetupInfoCard';
import PageShell from './ui/PageShell';

import { supabase } from '../lib/supabase';

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
}) => {
  // ── State for rejected notifications ──
  const [rejectedNotifications, setRejectedNotifications] = useState<AIRejectedTransaction[]>([]);

  // ── AI-entered transactions (label === 'AI') ──
  const aiTransactions = useMemo(
    () => allTransactions.filter((tx) => tx.label === 'AI'),
    [allTransactions],
  );

  // ── Active banks: derive from AI transactions + notification rules ──
  const [activeBanks, setActiveBanks] = useState<Map<string, string>>(new Map());

  // Load active banks from notification_rules table
  useEffect(() => {
    const loadActiveBanks = async () => {
      if (!userId) return;

      const { data, error } = await supabase
        .from('notification_rules')
        .select('bank_app_id, bank_name')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) {
        console.error('[TransactionParsing] Error loading active banks:', error);
        return;
      }

      const banks = new Map<string, string>();
      if (data) {
        for (const rule of data) {
          if (rule.bank_app_id && rule.bank_name) {
            banks.set(rule.bank_app_id, rule.bank_name);
          }
        }
      }

      // Also derive banks from AI transactions that may not have rules
      for (const tx of aiTransactions) {
        if (tx.notification_rule_id && tx.raw_notification) {
          // These fields are only on the client side, skip
        }
      }

      setActiveBanks(banks);
    };

    loadActiveBanks();
  }, [userId, aiTransactions]);

  // Load rejected notifications from pending_transactions
  useEffect(() => {
    const loadRejected = async () => {
      if (!userId) return;

      const { data, error } = await supabase
        .from('pending_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('needs_review', false)
        .eq('approved', false)
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
          reason: pt.rejection_reason || pt.validation_reasons || 'Rejected by AI',
          bankName: pt.app_name || undefined,
          timestamp: pt.created_at,
        }));
        setRejectedNotifications(rejected);
      }
    };

    loadRejected();
  }, [userId]);

  // Refresh data on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && userId) {
        // Refresh rejected list
        supabase
          .from('pending_transactions')
          .select('*')
          .eq('user_id', userId)
          .eq('needs_review', false)
          .eq('approved', false)
          .order('created_at', { ascending: false })
          .limit(50)
          .then(({ data }) => {
            if (data) {
              setRejectedNotifications(data.map((pt: any) => ({
                id: pt.id,
                vendor: pt.extracted_vendor || undefined,
                amount: pt.extracted_amount || undefined,
                reason: pt.rejection_reason || pt.validation_reasons || 'Rejected by AI',
                bankName: pt.app_name || undefined,
                timestamp: pt.created_at,
              })));
            }
          });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [userId]);

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

              <ActiveBanksCard
                activeBanks={activeBanks}
                showDemoData={showDemoData}
              />

              <AITransactionsEnteredCard
                aiTransactions={aiTransactions}
                budgets={budgets}
                showDemoData={showDemoData}
                onTransactionTap={onTransactionTap}
              />

              <AITransactionsRejectedCard
                rejectedTransactions={rejectedNotifications}
                showDemoData={showDemoData}
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
    </PageShell>
  );
};

export default TransactionParsing;
