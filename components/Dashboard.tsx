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

  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * FIXED NORMALIZATION
   */
  const normalizedTransactions = useNormalizedTransactions(
    state.transactions,
    state.budgets
  );

  /**
   * SAFE TOTAL CALCULATIONS
   */
  const {
    currentMonthTransactions,
    projectedTransactions,
    remainingMoney,
  } = useDashboardTotals(
    normalizedTransactions,
    state.user?.monthlyIncome || 0
  );

  /**
   * SEARCH FILTER
   */
  const filteredTransactions = useMemo(() => {

    if (!searchQuery) return normalizedTransactions;

    const q = searchQuery.toLowerCase();

    return normalizedTransactions.filter(
      t => t.vendor?.toLowerCase().includes(q)
    );

  }, [normalizedTransactions, searchQuery]);


  /**
   * PARSING SCREEN
   */
  if (showParsing) {

    return (
      <TransactionParsing
        enabled={state.settings.notificationsEnabled}
        onToggle={(enabled) =>
          setState(prev => ({
            ...prev,
            settings: {
              ...prev.settings,
              notificationsEnabled: enabled
            }
          }))
        }
        onBack={() => setShowParsing(false)}
        allTransactions={normalizedTransactions}
        budgets={state.budgets}
        userId={state.user?.id}
      />
    );

  }

  /**
   * MAIN DASHBOARD
   */
  return (
    <>
      <PageShell showGlow>

        <DashboardHeader />

        <DashboardBalanceSection
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
          scrollContainerRef={scrollRef}
          onTransactionTap={setSelectedTx}
          onUpdateBudget={onUpdateBudget}
        />

        <DashboardBottomBar
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
