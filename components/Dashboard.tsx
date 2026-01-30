import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';
import BudgetSection from './BudgetSection';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import Tutorial from './Tutorial';

// New dashboard components
import DashboardHeader from './dashboard_components/DashboardHeader';
import DashboardBalanceSection from './dashboard_components/DashboardBalanceSection';
import DashboardBudgetSectionsList from './dashboard_components/DashboardBudgetSectionsList';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import DashboardSettingsModal from './dashboard_components/DashboardSettingsModal';

// Re-exported so any existing imports of getBudgetIcon from Dashboard still work
export { getBudgetIcon } from './dashboard_components/getBudgetIcon';

interface DashboardProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onSignOut: () => void;
  onUpdateBudget: (b: BudgetCategory) => void;
  onAddTransaction: (t: Transaction) => void;
  onUpdateTransaction: (t: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({
  state,
  setState,
  onSignOut,
  onUpdateBudget,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction
}) => {
  const [isAddingTx, setIsAddingTx] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null);
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isLinkingPartner, setIsLinkingPartner] = useState(false);
  const [partnerLinkEmail, setPartnerLinkEmail] = useState('');
  const [showTutorial, setShowTutorial] = useState(!state.settings.hasSeenTutorial);
  const [tutorialStep, setTutorialStep] = useState(0);

  // Scroll refs shared with child components
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Lock body scroll when overlays are open
  useEffect(() => {
    const shouldLock =
      showSettings || isAddingTx || !!editingTx || !!deletingTxId || showTutorial;
    document.body.style.overflow = shouldLock ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [showSettings, isAddingTx, editingTx, deletingTxId, showTutorial]);

  const isSharedAccount = !state.user?.budgetingSolo;

  const filteredTransactions = useMemo(() => {
    let list = state.transactions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) => t.vendor.toLowerCase().includes(q));
    }
    return list;
  }, [state.transactions, searchQuery]);

  // Total income (currently just user's income, partner to be added later)
  const totalIncome = useMemo(() => {
    const userIncome = state.user?.monthlyIncome || 0;
    // TODO: When partner data is fetched, add partner's income here
    return userIncome;
  }, [state.user?.monthlyIncome]);

  const remainingMoney = useMemo(() => {
    const totalSpent = filteredTransactions.reduce(
      (acc, tx) => acc + (tx.is_projected ? 0 : tx.amount),
      0
    );
    const totalProjected = filteredTransactions.reduce(
      (acc, tx) => acc + (tx.is_projected ? tx.amount : 0),
      0
    );
    return totalIncome - (totalSpent + totalProjected);
  }, [totalIncome, filteredTransactions]);

  const leisureAdjustments = useMemo(() => {
    if (!state.settings.useLeisureAsBuffer) return 0;

    let totalOverspend = 0;
    state.budgets.forEach((b) => {
      if (b.name.toLowerCase().includes('leisure')) return;

      const bTxs = filteredTransactions.filter(
        (t) =>
          t.budget_id === b.id ||
          t.splits?.some((s) => s.budget_id === b.id)
      );

      const spent = bTxs.reduce((acc, tx) => {
        if (tx.splits) {
          const s = tx.splits.find((sp) => sp.budget_id === b.id);
          return acc + (s?.amount || 0);
        }
        return acc + (tx.budget_id === b.id ? tx.amount : 0);
      }, 0);

      if (spent > b.totalLimit) {
        totalOverspend += spent - b.totalLimit;
      }
    });

    return totalOverspend;
  }, [state.budgets, filteredTransactions, state.settings.useLeisureAsBuffer]);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedBudgets);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.clear();
      next.add(id);
    }
    setExpandedBudgets(next);
  };

  const jumpToBudget = (id: string) => {
    const isCurrentlyFocused = expandedBudgets.has(id) && expandedBudgets.size === 1;
    if (isCurrentlyFocused) {
      setExpandedBudgets(new Set());
    } else {
      setExpandedBudgets(new Set([id]));
      setTimeout(() => {
        const containerEl = scrollContainerRef.current;
        if (containerEl) {
          containerEl.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 50);
    }
  };

  const updateSettings = (key: keyof AppState['settings'], value: any) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, [key]: value }
    }));
  };

  const updateUserIncome = (income: number) => {
    setState((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, monthlyIncome: income } : null
    }));
  };

  const handleConnectPartner = () => {
    if (!partnerLinkEmail.includes('@')) return;
    setState((prev) => ({
      ...prev,
      user: prev.user
        ? {
            ...prev.user,
            budgetingSolo: false,
            partnerEmail: partnerLinkEmail
          }
        : null
    }));
    setIsLinkingPartner(false);
    setPartnerLinkEmail('');
  };

  const handleDisconnectPartner = () => {
    setState((prev) => ({
      ...prev,
      user: prev.user
        ? {
            ...prev.user,
            budgetingSolo: true,
            partnerId: undefined,
            partnerEmail: undefined,
            partnerName: undefined
          }
        : null
    }));
  };

  const handleUpdateTransaction = (updatedTx: Transaction) => {
    onUpdateTransaction(updatedTx);
    setEditingTx(null);
  };

  const isFocusMode = expandedBudgets.size === 1;
  const focusedBudgetId = isFocusMode ? Array.from(expandedBudgets)[0] : null;

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    setShowSettings(false);
    updateSettings('hasSeenTutorial', true);
  };

  const handleTutorialStepChange = (step: number) => {
    setTutorialStep(step);
    // Steps 0-4 are Dashboard highlights, 5-12 are Settings highlights
    if (step >= 5 && step <= 12) {
      setShowSettings(true);
    } else {
      setShowSettings(false);
    }
  };

  const handleRunTutorialFromSettings = () => {
    setShowSettings(false);
    setShowTutorial(true);
  };

  return (
    <div className="flex-1 flex flex-col h-screen relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
      {/* Background glow (only when not in focus mode) */}
      {!isFocusMode && (
        <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700 animate-nest">
          <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/25 dark:bg-emerald-500/35"></div>
          <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/20 dark:bg-green-400/30"></div>
        </div>
      )}

      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-4 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.5rem)' }}
      >
        <DashboardHeader onOpenSettings={() => setShowSettings(true)} />
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col p-4 pb-28 overflow-hidden relative z-10">
        {/* Remaining balance + search (hidden in focus mode) */}
        {!isFocusMode && (
          <DashboardBalanceSection
            isSharedAccount={isSharedAccount}
            remainingMoney={remainingMoney}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        )}

        {/* Budget sections list */}
        <DashboardBudgetSectionsList
          budgets={state.budgets}
          transactions={filteredTransactions}
          expandedBudgets={expandedBudgets}
          isFocusMode={isFocusMode}
          focusedBudgetId={focusedBudgetId}
          leisureAdjustments={leisureAdjustments}
          settings={state.settings}
          currentUserName={state.user?.name || ''}
          isSharedAccount={isSharedAccount}
          scrollContainerRef={scrollContainerRef}
          budgetRefs={budgetRefs}
          onToggleExpand={toggleExpand}
          onDeleteRequest={(id) => setDeletingTxId(id)}
          onEditTransaction={(tx) => setEditingTx(tx)}
          onUpdateBudget={onUpdateBudget}
        />
      </main>

      {/* Bottom bar with budget shortcuts + add transaction */}
      <DashboardBottomBar
        budgets={state.budgets}
        expandedBudgets={expandedBudgets}
        onJumpToBudget={jumpToBudget}
        onAddTransaction={() => setIsAddingTx(true)}
      />

      {/* Settings modal */}
      {showSettings && (
        <DashboardSettingsModal
          isSharedAccount={isSharedAccount}
          settings={state.settings}
          user={state.user}
          showTutorial={showTutorial}
          isLinkingPartner={isLinkingPartner}
          partnerLinkEmail={partnerLinkEmail}
          onChangePartnerLinkEmail={setPartnerLinkEmail}
          onClose={() => {
            setShowSettings(false);
            setIsLinkingPartner(false);
          }}
          onRunTutorial={handleRunTutorialFromSettings}
          onUpdateSettings={updateSettings}
          onUpdateUserIncome={updateUserIncome}
          onConnectPartner={handleConnectPartner}
          onDisconnectPartner={handleDisconnectPartner}
          onToggleLinkingPartner={setIsLinkingPartner}
          onSignOut={onSignOut}
        />
      )}

      {/* Add transaction modal */}
      {isAddingTx && (
        <TransactionForm
          onClose={() => setIsAddingTx(false)}
          onSave={onAddTransaction}
          budgets={state.budgets}
          userId={state.user?.id || '1'}
          userName={state.user?.name || 'User'}
          isSharedAccount={isSharedAccount}
        />
      )}

      {/* Edit transaction modal */}
      {editingTx && (
        <TransactionForm
          onClose={() => setEditingTx(null)}
          onSave={handleUpdateTransaction}
          budgets={state.budgets}
          userId={state.user?.id || '1'}
          userName={state.user?.name || 'User'}
          initialTransaction={editingTx}
          isSharedAccount={isSharedAccount}
        />
      )}

      {/* Confirm delete modal */}
      {deletingTxId && (
        <ConfirmDeleteModal
          onClose={() => setDeletingTxId(null)}
          onConfirm={() => {
            onDeleteTransaction(deletingTxId);
            setDeletingTxId(null);
          }}
        />
      )}

      {/* Tutorial overlay */}
      {showTutorial && (
        <Tutorial
          isShared={isSharedAccount}
          onComplete={handleTutorialComplete}
          onStepChange={handleTutorialStepChange}
        />
      )}
    </div>
  );
};

export default Dashboard;
