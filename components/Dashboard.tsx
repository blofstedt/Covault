import React, { useState, useMemo, useRef, useEffect } from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';

import PageShell from './ui/PageShell';
import TransactionParsing from './TransactionParsing';
import TransactionActionModal from './TransactionActionModal';
import TransactionForm from './TransactionForm';
import PremiumGate from './PremiumGate';

import DashboardHeader from './dashboard_components/DashboardHeader';
import DashboardBalanceSection from './dashboard_components/DashboardBalanceSection';
import DashboardBudgetSectionsList from './dashboard_components/DashboardBudgetSectionsList';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import BudgetFlowChart from './dashboard_components/BudgetFlowChart';
import DashboardSettingsModal from './dashboard_components/DashboardSettingsModal';
import SearchResults from './dashboard_components/SearchResults';

import useNormalizedTransactions from './dashboard_components/useNormalizedTransactions';
import useDashboardTotals from './dashboard_components/useDashboardTotals';
import { getNeedsReviewCount, getReviewQueueChangedEventName } from '../lib/localNotificationMemory';

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onAddTransaction: (t: Transaction) => void;
  onUpdateTransaction: (t: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onUpdateBudget: (b: BudgetCategory) => void;
  onSignOut: () => Promise<void>;
  saveBudgetLimit: (categoryId: string, newLimit: number) => Promise<void>;
  saveUserIncome: (income: number) => Promise<void>;
  saveTheme: (theme: 'light' | 'dark') => Promise<void>;
  saveBudgetVisibility: (categoryId: string, visible: boolean) => Promise<void>;
  onLinkPartner: (partnerEmail: string) => Promise<void>;
  onUnlinkPartner: () => Promise<void>;
  onRefreshNotifications?: () => Promise<void>;
  onReloadTransactions?: (userId: string) => Promise<void>;
}

const Dashboard: React.FC<Props> = ({
  state,
  setState,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onUpdateBudget,
  onSignOut,
  saveBudgetLimit,
  saveUserIncome,
  saveTheme,
  saveBudgetVisibility,
  onLinkPartner,
  onUnlinkPartner,
  onRefreshNotifications,
  onReloadTransactions,
}) => {
  const [showParsing, setShowParsing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isLinkingPartner, setIsLinkingPartner] = useState(false);
  const [partnerLinkEmail, setPartnerLinkEmail] = useState('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const normalizedTransactions = useNormalizedTransactions(state.transactions, state.budgets);

  const { currentMonthTransactions, projectedTransactions, remainingMoney } = useDashboardTotals(
    normalizedTransactions,
    state.user?.monthlyIncome || 0,
  );

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const currentMonthBudgetTransactions = useMemo(() => {
    const currentMonthProjected = projectedTransactions.filter(
      (t) => t.date?.slice(0, 7) === monthKey,
    );

    return [...currentMonthTransactions, ...currentMonthProjected];
  }, [currentMonthTransactions, projectedTransactions, monthKey]);

  const chartTransactions = useMemo(() => {
    const existingIds = new Set(normalizedTransactions.map((t) => t.id));
    const currentMonthProjected = projectedTransactions.filter(
      (t) => t.date?.slice(0, 7) === monthKey && !existingIds.has(t.id),
    );

    return [...normalizedTransactions, ...currentMonthProjected];
  }, [normalizedTransactions, projectedTransactions, monthKey]);


  const [needsReviewCount, setNeedsReviewCount] = useState(0);

  useEffect(() => {
    const refresh = () => setNeedsReviewCount(getNeedsReviewCount());
    refresh();
    const eventName = getReviewQueueChangedEventName();
    window.addEventListener(eventName, refresh);
    return () => window.removeEventListener(eventName, refresh);
  }, []);

  const filteredTransactions = useMemo(() => {
    if (!searchQuery) return normalizedTransactions;
    const q = searchQuery.toLowerCase();
    return normalizedTransactions.filter(t => t.vendor?.toLowerCase().includes(q));
  }, [normalizedTransactions, searchQuery]);


  const pastTransactions = useMemo(
    () => normalizedTransactions.filter((t) => t.date?.slice(0, 7) < monthKey),
    [normalizedTransactions, monthKey],
  );

  const futureTransactions = useMemo(
    () => normalizedTransactions.filter((t) => t.date?.slice(0, 7) > monthKey),
    [normalizedTransactions, monthKey],
  );

  const toggleExpand = (id: string) => {
    setExpandedBudgets(prev => {
      if (prev.has(id)) {
        return new Set();
      }
      return new Set([id]);
    });
  };

  const handleUpdateSettings = (key: string, value: any) => {
    setState(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        [key]: value,
      },
    }));

    if (key === 'theme' && (value === 'light' || value === 'dark')) {
      saveTheme(value).catch((e) => console.error('[Dashboard] saveTheme failed:', e));
    }
  };

  if (showParsing) {
    return (
      <TransactionParsing
        enabled={state.settings.notificationsEnabled}
        onToggle={(enabled) =>
          setState(prev => ({
            ...prev,
            settings: {
              ...prev.settings,
              notificationsEnabled: enabled,
            },
          }))
        }
        onBack={() => setShowParsing(false)}
        onGoHome={() => setShowParsing(false)}
        onAddTransaction={onAddTransaction}
        allTransactions={normalizedTransactions}
        onTransactionTap={setSelectedTx}
        budgets={state.budgets}
        userId={state.user?.id}
        onRefreshNotifications={onRefreshNotifications}
        onReloadTransactions={onReloadTransactions}
      />
    );
  }

  return (
    <>
      <PageShell showGlow>
        <DashboardHeader onOpenSettings={() => setShowSettings(true)} />

        <DashboardBalanceSection
          isSharedAccount={!state.user?.budgetingSolo}
          remainingMoney={remainingMoney}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
        />

        {searchQuery.trim() ? (
          <SearchResults
            searchQuery={searchQuery}
            currentMonthTransactions={currentMonthTransactions}
            pastTransactions={pastTransactions}
            futureTransactions={futureTransactions}
            allTransactions={normalizedTransactions}
            currentUserName={state.user?.name || ''}
            isSharedAccount={!state.user?.budgetingSolo}
            budgets={state.budgets}
            onTransactionTap={setSelectedTx}
          />
        ) : (
          <>
            <PremiumGate hasPremium={true}>
              <BudgetFlowChart
                budgets={state.budgets}
                transactions={chartTransactions}
                monthlyIncome={state.user?.monthlyIncome || 0}
                theme={state.settings.theme}
              />
            </PremiumGate>

            <DashboardBudgetSectionsList
              budgets={state.budgets}
              transactions={currentMonthBudgetTransactions}
              expandedBudgets={expandedBudgets}
              isFocusMode={false}
              focusedBudgetId={null}
              leisureAdjustments={0}
              settings={state.settings}
              currentUserName={state.user?.name || ''}
              isSharedAccount={!state.user?.budgetingSolo}
              scrollContainerRef={scrollRef}
              budgetRefs={budgetRefs}
              onToggleExpand={toggleExpand}
              onTransactionTap={setSelectedTx}
              onUpdateBudget={onUpdateBudget}
            />
          </>
        )}

        <DashboardBottomBar
          onGoHome={() => setShowParsing(false)}
          onAddTransaction={() => setShowTransactionForm(true)}
          onOpenParsing={() => setShowParsing(true)}
          activeView="home"
          pendingCount={needsReviewCount}
        />
      </PageShell>

      {showSettings && (
        <DashboardSettingsModal
          isSharedAccount={!state.user?.budgetingSolo}
          settings={state.settings}
          user={state.user}
          isLinkingPartner={isLinkingPartner}
          partnerLinkEmail={partnerLinkEmail}
          budgets={state.budgets}
          transactions={normalizedTransactions}
          onChangePartnerLinkEmail={setPartnerLinkEmail}
          onClose={() => setShowSettings(false)}
          onUpdateSettings={handleUpdateSettings}
          onUpdateUserIncome={(income) => saveUserIncome(income)}
          onConnectPartner={() => onLinkPartner(partnerLinkEmail)}
          onDisconnectPartner={onUnlinkPartner}
          onToggleLinkingPartner={setIsLinkingPartner}
          onSignOut={onSignOut}
          onSaveBudgetLimit={saveBudgetLimit}
          saveBudgetVisibility={saveBudgetVisibility}
          hasPremium={true}
          onSubscribe={() => {}}
        />
      )}

      {selectedTx && (
        <TransactionActionModal
          transaction={selectedTx}
          budgets={state.budgets}
          currentUserName={state.user?.name || ''}
          isSharedAccount={!state.user?.budgetingSolo}
          onClose={() => setSelectedTx(null)}
          onEdit={onUpdateTransaction}
          onDelete={() => onDeleteTransaction(selectedTx.id)}
        />
      )}

      {showTransactionForm && state.user?.id && (
        <TransactionForm
          onClose={() => setShowTransactionForm(false)}
          onSave={(tx) => {
            onAddTransaction(tx);
            setShowTransactionForm(false);
          }}
          budgets={state.budgets}
          userId={state.user.id}
          userName={state.user?.name || ''}
          isSharedAccount={!state.user?.budgetingSolo}
        />
      )}
    </>
  );
};

export default Dashboard;
