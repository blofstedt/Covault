import React, { useState, useMemo, useRef } from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';

import PageShell from './ui/PageShell';
import TransactionParsing from './TransactionParsing';
import TransactionActionModal from './TransactionActionModal';
import PremiumGate from './PremiumGate';

import DashboardHeader from './dashboard_components/DashboardHeader';
import DashboardBalanceSection from './dashboard_components/DashboardBalanceSection';
import DashboardBudgetSectionsList from './dashboard_components/DashboardBudgetSectionsList';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import BudgetFlowChart from './dashboard_components/BudgetFlowChart';

import useNormalizedTransactions from './dashboard_components/useNormalizedTransactions';
import useDashboardTotals from './dashboard_components/useDashboardTotals';

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onAddTransaction: (t: Transaction) => void;
  onUpdateTransaction: (t: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onUpdateBudget: (b: BudgetCategory) => void;
}

const Dashboard: React.FC<Props> = ({
  state,
  setState,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onUpdateBudget,
}) => {
  const [showParsing, setShowParsing] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const normalizedTransactions = useNormalizedTransactions(state.transactions, state.budgets);

  const { currentMonthTransactions, remainingMoney } = useDashboardTotals(
    normalizedTransactions,
    state.user?.monthlyIncome || 0,
  );

  const filteredTransactions = useMemo(() => {
    if (!searchQuery) return normalizedTransactions;
    const q = searchQuery.toLowerCase();
    return normalizedTransactions.filter(t => t.vendor?.toLowerCase().includes(q));
  }, [normalizedTransactions, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedBudgets(prev => {
      if (prev.has(id)) {
        return new Set();
      }
      return new Set([id]);
    });
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
        allTransactions={filteredTransactions}
        budgets={state.budgets}
        userId={state.user?.id}
      />
    );
  }

  return (
    <>
      <PageShell showGlow>
        <DashboardHeader onOpenSettings={() => {}} />

        <DashboardBalanceSection
          isSharedAccount={!state.user?.budgetingSolo}
          remainingMoney={remainingMoney}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
        />

        <PremiumGate hasPremium={true}>
          <BudgetFlowChart
            budgets={state.budgets}
            transactions={normalizedTransactions}
            theme={state.settings.theme}
          />
        </PremiumGate>

        <DashboardBudgetSectionsList
          budgets={state.budgets}
          transactions={currentMonthTransactions}
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

        <DashboardBottomBar
          onGoHome={() => setShowParsing(false)}
          onAddTransaction={() => {}}
          onOpenParsing={() => setShowParsing(true)}
          activeView="home"
        />
      </PageShell>

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
    </>
  );
};

export default Dashboard;
