import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';
import BudgetSection from './BudgetSection';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import Tutorial from './Tutorial';
import TransactionActionModal from './TransactionActionModal';
import TransactionParsing from './TransactionParsing';

// New dashboard components
import DashboardHeader from './dashboard_components/DashboardHeader';
import DashboardBalanceSection from './dashboard_components/DashboardBalanceSection';
import DashboardBudgetSectionsList from './dashboard_components/DashboardBudgetSectionsList';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import DashboardSettingsModal from './dashboard_components/DashboardSettingsModal';
import SearchResults from './dashboard_components/SearchResults';
import BudgetFlowChart from './dashboard_components/BudgetFlowChart';

// Notifications helper
import { checkAndTriggerAppNotifications } from '../lib/appNotifications';

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
  saveBudgetLimit: (categoryId: string, newLimit: number) => void;
  saveUserIncome: (income: number) => void;
  isLoadingData: boolean;
}

const Dashboard: React.FC<DashboardProps> = ({
  state,
  setState,
  onSignOut,
  onUpdateBudget,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  saveBudgetLimit,
  saveUserIncome,
  isLoadingData,
}) => {
  const [isAddingTx, setIsAddingTx] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showParsing, setShowParsing] = useState(false);
  const [parsingEnabled, setParsingEnabled] = useState(false);
  const [isLinkingPartner, setIsLinkingPartner] = useState(false);
  const [partnerLinkEmail, setPartnerLinkEmail] = useState('');
  const [showTutorial, setShowTutorial] = useState(!state.settings.hasSeenTutorial);
  const [tutorialStep, setTutorialStep] = useState(0);

  // Scroll refs shared with child components
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const bodyOverflowRef = useRef<string | null>(null);

  // Lock body scroll when overlays are open
  useEffect(() => {
    const shouldLock =
      showSettings || isAddingTx || !!selectedTx || showTutorial;
    if (shouldLock) {
      if (bodyOverflowRef.current === null) {
        bodyOverflowRef.current = document.body.style.overflow || '';
      }
      document.body.style.overflow = 'hidden';
    } else if (bodyOverflowRef.current !== null) {
      document.body.style.overflow = bodyOverflowRef.current;
      bodyOverflowRef.current = null;
    }
  }, [showSettings, isAddingTx, selectedTx, showTutorial]);

  useEffect(() => {
    return () => {
      if (bodyOverflowRef.current !== null) {
        document.body.style.overflow = bodyOverflowRef.current;
        bodyOverflowRef.current = null;
      }
    };
  }, []);

  const isSharedAccount = !state.user?.budgetingSolo;

  // All transactions, optionally filtered by search query
  const filteredTransactions = useMemo(() => {
    let list = state.transactions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) => t.vendor.toLowerCase().includes(q));
    }
    return list;
  }, [state.transactions, searchQuery]);

  // Helper to identify the current month - memoized to prevent recalculation
  const { currentYear, currentMonth } = useMemo(() => {
    const now = new Date();
    return {
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth(), // 0-based
    };
  }, []); // Empty dependency array - only calculate once per component mount

  const currentMonthTransactions = useMemo(
    () =>
      filteredTransactions.filter((tx) => {
        const d = new Date(tx.date);
        return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
      }),
    [filteredTransactions, currentYear, currentMonth],
  );

  const pastTransactions = useMemo(
    () =>
      state.transactions.filter((tx) => {
        const d = new Date(tx.date);
        return (
          d.getFullYear() < currentYear ||
          (d.getFullYear() === currentYear && d.getMonth() < currentMonth)
        );
      }),
    [state.transactions, currentYear, currentMonth],
  );

  const futureTransactions = useMemo(
    () =>
      state.transactions.filter((tx) => {
        const d = new Date(tx.date);
        return (
          d.getFullYear() > currentYear ||
          (d.getFullYear() === currentYear && d.getMonth() > currentMonth)
        );
      }),
    [state.transactions, currentYear, currentMonth],
  );

  // Total income (currently just user's income, partner to be added later)
  const totalIncome = useMemo(() => {
    const userIncome = state.user?.monthlyIncome || 0;
    return userIncome;
  }, [state.user?.monthlyIncome]);

  // Remaining money (this month only, spent vs projected)
  const remainingMoney = useMemo(() => {
    const totalSpent = currentMonthTransactions.reduce(
      (acc, tx) => acc + (tx.is_projected ? 0 : tx.amount),
      0,
    );

    const totalProjected = currentMonthTransactions.reduce(
      (acc, tx) => acc + (tx.is_projected ? tx.amount : 0),
      0,
    );

    return totalIncome - (totalSpent + totalProjected);
  }, [totalIncome, currentMonthTransactions]);

  const leisureAdjustments = useMemo(() => {
    if (!state.settings.useLeisureAsBuffer) return 0;

    let totalOverspend = 0;
    state.budgets.forEach((b) => {
      if (b.name.toLowerCase().includes('leisure')) return;

      const bTxs = currentMonthTransactions.filter(
        (tx) =>
          tx.budget_id === b.id ||
          tx.splits?.some((s) => s.budget_id === b.id),
      );

      // Only count actual spent amounts, not projected transactions
      const spent = bTxs.reduce((acc, tx) => {
        if (tx.is_projected) return acc;
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
  }, [state.budgets, currentMonthTransactions, state.settings.useLeisureAsBuffer]);

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

  const handleGoHome = () => {
    // Collapse all budgets and scroll to top
    setExpandedBudgets(new Set());
    setSearchQuery('');
    setTimeout(() => {
      const containerEl = scrollContainerRef.current;
      if (containerEl) {
        containerEl.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 50);
  };

  const updateSettings = (key: keyof AppState['settings'], value: any) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
    }));
  };

  const updateUserIncome = (income: number) => {
    // Update local state (optimistic update handled in saveUserIncome)
    // Call the save function which will also update the state
    saveUserIncome(income);
  };

  const handleConnectPartner = () => {
    if (!partnerLinkEmail.includes('@')) return;
    setState((prev) => ({
      ...prev,
      user: prev.user
        ? {
            ...prev.user,
            budgetingSolo: false,
            partnerEmail: partnerLinkEmail,
          }
        : null,
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
            partnerName: undefined,
          }
        : null,
    }));
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
    if (step >= 6 && step <= 13) {
      setShowSettings(true);
    } else {
      setShowSettings(false);
    }
  };

  const handleRunTutorialFromSettings = () => {
    setShowSettings(false);
    setShowTutorial(true);
  };

  // 🔔 Notification alerts: budgets + remaining money
  useEffect(() => {
    if (!state.user?.id) return;

    checkAndTriggerAppNotifications({
      userId: state.user.id,
      budgets: state.budgets,
      transactions: currentMonthTransactions,
      totalIncome,
      remainingMoney,
      settings: {
        app_notifications_enabled: (state.settings as any).app_notifications_enabled,
      },
    });
  }, [
    state.user?.id,
    state.budgets,
    currentMonthTransactions,
    totalIncome,
    remainingMoney,
    (state.settings as any).app_notifications_enabled,
  ]);

  // If showing parsing view, render that instead of the main dashboard
  if (showParsing) {
    return (
      <TransactionParsing
        enabled={parsingEnabled}
        onToggle={setParsingEnabled}
        onBack={() => setShowParsing(false)}
        onAddTransaction={() => setIsAddingTx(true)}
        onGoHome={() => {
          setShowParsing(false);
          handleGoHome();
        }}
      />
    );
  }

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
      <main className="flex-1 flex flex-col p-3 pb-24 overflow-hidden relative z-10">
        {!isFocusMode && !isLoadingData && (
          <DashboardBalanceSection
            isSharedAccount={isSharedAccount}
            remainingMoney={remainingMoney}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        )}

        {!isFocusMode && !searchQuery && (
          <BudgetFlowChart
            budgets={state.budgets}
            transactions={state.transactions}
          />
        )}

        {searchQuery ? (
          <SearchResults
            searchQuery={searchQuery}
            currentMonthTransactions={currentMonthTransactions}
            pastTransactions={pastTransactions}
            futureTransactions={futureTransactions}
            currentUserName={state.user?.name || ''}
            isSharedAccount={isSharedAccount}
            budgets={state.budgets}
            onTransactionTap={(tx) => setSelectedTx(tx)}
          />
        ) : (
          <DashboardBudgetSectionsList
            budgets={state.budgets}
            transactions={currentMonthTransactions}
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
            onTransactionTap={(tx) => setSelectedTx(tx)}
            onUpdateBudget={onUpdateBudget}
          />
        )}
      </main>

      <DashboardBottomBar
        onGoHome={handleGoHome}
        onAddTransaction={() => setIsAddingTx(true)}
        onOpenParsing={() => setShowParsing(true)}
      />

      {showSettings && (
        <DashboardSettingsModal
          isSharedAccount={isSharedAccount}
          settings={state.settings as any}
          user={state.user}
          showTutorial={showTutorial}
          isLinkingPartner={isLinkingPartner}
          partnerLinkEmail={partnerLinkEmail}
          budgets={state.budgets}
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
          onSaveBudgetLimit={saveBudgetLimit}
        />
      )}

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

      {selectedTx && (
        <TransactionActionModal
          transaction={selectedTx}
          budgets={state.budgets}
          currentUserName={state.user?.name || 'User'}
          isSharedAccount={isSharedAccount}
          onClose={() => setSelectedTx(null)}
          onEdit={(updatedTx) => {
            onUpdateTransaction(updatedTx);
            setSelectedTx(null);
          }}
          onDelete={() => {
            onDeleteTransaction(selectedTx.id);
            setSelectedTx(null);
          }}
        />
      )}

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
