import React, { useState, useMemo, useEffect, useRef } from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import Tutorial from './Tutorial';
import TransactionActionModal from './TransactionActionModal';
import TransactionParsing from './TransactionParsing';

// New dashboard components
import DashboardHeader from './dashboard_components/DashboardHeader';
import DashboardBalanceSection from './dashboard_components/DashboardBalanceSection';
import DashboardTransactionList from './dashboard_components/DashboardTransactionList';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import DashboardSettingsModal from './dashboard_components/DashboardSettingsModal';
import SearchResults from './dashboard_components/SearchResults';
import CategoryBarChart from './dashboard_components/CategoryBarChart';

// Notifications helper
import { checkAndTriggerAppNotifications } from '../lib/appNotifications';
import { generateProjectedTransactions } from '../lib/projectedTransactions';

interface DashboardProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onSignOut: () => void;
  onUpdateBudget: (b: BudgetCategory) => void;
  onAddTransaction: (t: Transaction) => void;
  onUpdateTransaction: (t: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onLinkPartner?: (email: string) => void;
  onUnlinkPartner?: () => void;
  onGenerateLinkCode?: () => Promise<string | null>;
  onJoinWithCode?: (code: string) => void;
  onApprovePendingTransaction?: (pendingId: string, categoryId: string) => void;
  onRejectPendingTransaction?: (pendingId: string) => void;
  onRefreshNotifications?: () => Promise<void>;
  saveBudgetLimit: (categoryId: string, newLimit: number) => void;
  saveUserIncome: (income: number) => void;
  saveTheme: (theme: 'light' | 'dark') => void;
  saveBudgetVisibility: (categoryId: string, visible: boolean) => void;
  isLoadingData: boolean;
  // Dev mode section overrides
  devShowSettings?: boolean;
  devShowTutorial?: boolean;
  devShowAddTx?: boolean;
  onDevResetShowSettings?: () => void;
  onDevResetShowTutorial?: () => void;
  onDevResetShowAddTx?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({
  state,
  setState,
  onSignOut,
  onUpdateBudget,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onLinkPartner,
  onUnlinkPartner,
  onGenerateLinkCode,
  onJoinWithCode,
  onApprovePendingTransaction,
  onRejectPendingTransaction,
  onRefreshNotifications,
  saveBudgetLimit,
  saveUserIncome,
  saveTheme,
  saveBudgetVisibility,
  isLoadingData,
  devShowSettings,
  devShowTutorial,
  devShowAddTx,
  onDevResetShowSettings,
  onDevResetShowTutorial,
  onDevResetShowAddTx,
}) => {
  const [isAddingTx, setIsAddingTx] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showParsing, setShowParsing] = useState(false);
  const [isLinkingPartner, setIsLinkingPartner] = useState(false);
  const [partnerLinkEmail, setPartnerLinkEmail] = useState('');
  const [showTutorial, setShowTutorial] = useState(!state.settings.hasSeenTutorial);
  const [tutorialStep, setTutorialStep] = useState(0);
  const shouldAnimateBottomBarRef = useRef(true);
  const [tutorialPlaceholderTx, setTutorialPlaceholderTx] = useState(false);
  const [tutorialShowTxModal, setTutorialShowTxModal] = useState(false);
  const [tutorialFormOpen, setTutorialFormOpen] = useState(false);
  const [demoSplitTrigger, setDemoSplitTrigger] = useState(0);

  // Scroll refs shared with child components
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const bodyOverflowRef = useRef<string | null>(null);

  // Dev mode: respond to external section navigation
  useEffect(() => {
    if (devShowSettings) setShowSettings(true);
  }, [devShowSettings]);
  useEffect(() => {
    if (devShowTutorial) setShowTutorial(true);
  }, [devShowTutorial]);
  useEffect(() => {
    if (devShowAddTx) setIsAddingTx(true);
  }, [devShowAddTx]);

  // Track initial mount for animation purposes
  useEffect(() => {
    // After the first render, disable animation for subsequent renders
    shouldAnimateBottomBarRef.current = false;
  }, []);

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

  // Filter out hidden budget categories
  const hiddenCategories: string[] = (state.settings as any).hiddenCategories || [];
  const visibleBudgets = useMemo(
    () => state.budgets.filter(b => !hiddenCategories.includes(b.id)),
    [state.budgets, hiddenCategories],
  );

  // All transactions, optionally filtered by search query
  const filteredTransactions = useMemo(() => {
    let list = state.transactions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) => t.vendor.toLowerCase().includes(q));
    }
    return list;
  }, [state.transactions, searchQuery]);

  // Build vendor history for autocomplete (most recent transaction per vendor)
  const vendorHistory = useMemo(() => {
    const vendorMap = new Map<string, { vendor: string; budget_id: string; splits?: { budget_id: string; amount: number }[]; date: string }>();
    const sorted = [...state.transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    for (const tx of sorted) {
      const key = tx.vendor.toLowerCase();
      if (!vendorMap.has(key)) {
        vendorMap.set(key, {
          vendor: tx.vendor,
          budget_id: tx.budget_id || '',
          splits: tx.splits,
          date: tx.date,
        });
      }
    }
    return Array.from(vendorMap.values());
  }, [state.transactions]);

  // Helper to identify the current month - memoized to prevent recalculation
  const { currentYear, currentMonth } = useMemo(() => {
    const now = new Date();
    return {
      currentYear: now.getUTCFullYear(),
      currentMonth: now.getUTCMonth(), // 0-based
    };
  }, []); // Empty dependency array - only calculate once per component mount

  // Unfiltered current month transactions (used for balance calculation)
  const currentMonthTransactionsAll = useMemo(
    () =>
      state.transactions.filter((tx) => {
        const d = new Date(tx.date);
        return d.getUTCFullYear() === currentYear && d.getUTCMonth() === currentMonth;
      }),
    [state.transactions, currentYear, currentMonth],
  );

  // Search-filtered current month transactions (used for display only)
  const currentMonthTransactions = useMemo(
    () =>
      filteredTransactions.filter((tx) => {
        const d = new Date(tx.date);
        // Use UTC methods to avoid timezone shift issues with ISO date strings
        return d.getUTCFullYear() === currentYear && d.getUTCMonth() === currentMonth;
      }),
    [filteredTransactions, currentYear, currentMonth],
  );

  const pastTransactions = useMemo(
    () =>
      state.transactions.filter((tx) => {
        const d = new Date(tx.date);
        return (
          d.getUTCFullYear() < currentYear ||
          (d.getUTCFullYear() === currentYear && d.getUTCMonth() < currentMonth)
        );
      }),
    [state.transactions, currentYear, currentMonth],
  );

  const futureTransactions = useMemo(
    () =>
      state.transactions.filter((tx) => {
        const d = new Date(tx.date);
        return (
          d.getUTCFullYear() > currentYear ||
          (d.getUTCFullYear() === currentYear && d.getUTCMonth() > currentMonth)
        );
      }),
    [state.transactions, currentYear, currentMonth],
  );

  // Generate projected transactions from recurring entries (display-only, not saved to DB)
  const projectedTransactions = useMemo(
    () => generateProjectedTransactions(state.transactions),
    [state.transactions],
  );

  // Projected transactions falling in the current month
  const projectedCurrentMonth = useMemo(
    () =>
      projectedTransactions.filter((tx) => {
        const d = new Date(tx.date);
        return d.getUTCFullYear() === currentYear && d.getUTCMonth() === currentMonth;
      }),
    [projectedTransactions, currentYear, currentMonth],
  );

  // Current month transactions augmented with projected entries (for display in budget sections)
  const currentMonthWithProjected = useMemo(
    () => [...currentMonthTransactionsAll, ...projectedCurrentMonth],
    [currentMonthTransactionsAll, projectedCurrentMonth],
  );

  // Total income (currently just user's income, partner to be added later)
  const totalIncome = useMemo(() => {
    const userIncome = state.user?.monthlyIncome || 0;
    return userIncome;
  }, [state.user?.monthlyIncome]);

  // Remaining money (this month only, spent vs projected) — always uses unfiltered transactions
  const remainingMoney = useMemo(() => {
    const allCurrentMonth = [...currentMonthTransactionsAll, ...projectedCurrentMonth];

    const totalSpent = allCurrentMonth.reduce(
      (acc, tx) => acc + (tx.is_projected ? 0 : tx.amount),
      0,
    );

    const totalProjected = allCurrentMonth.reduce(
      (acc, tx) => acc + (tx.is_projected ? tx.amount : 0),
      0,
    );

    return totalIncome - (totalSpent + totalProjected);
  }, [totalIncome, currentMonthTransactionsAll, projectedCurrentMonth]);

  const leisureAdjustments = useMemo(() => {
    if (!state.settings.useLeisureAsBuffer) return 0;

    let totalOverspend = 0;
    visibleBudgets.forEach((b) => {
      if (b.name.toLowerCase().includes('leisure')) return;

      const bTxs = currentMonthTransactionsAll.filter(
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
  }, [visibleBudgets, currentMonthTransactionsAll, state.settings.useLeisureAsBuffer]);

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
    
    // Save theme to database when it changes
    if (key === 'theme') {
      saveTheme(value as 'light' | 'dark');
    }
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

  // Auto-detected transactions (from bank notification listener)
  const autoDetectedTransactions = useMemo(
    () => state.transactions.filter((tx) => tx.label === 'Auto-Added'),
    [state.transactions],
  );

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    setShowSettings(false);
    // Clean up any tutorial state
    setTutorialPlaceholderTx(false);
    setTutorialShowTxModal(false);
    setTutorialFormOpen(false);
    setExpandedBudgets(new Set());
    setIsAddingTx(false);
    setSelectedTx(null);
    updateSettings('hasSeenTutorial', true);
    onDevResetShowTutorial?.();
  };

  const handleTutorialStepChange = (step: number) => {
    setTutorialStep(step);
    // Steps 12 ("Monthly Income") through 24 ("Sign Out") target elements inside the settings modal
    if (step >= 12 && step <= 24) {
      setShowSettings(true);
    } else {
      setShowSettings(false);
    }
  };

  // Tutorial callback: expand/collapse a budget
  const handleTutorialExpandBudget = (budgetId: string | null) => {
    if (budgetId) {
      setExpandedBudgets(new Set([budgetId]));
    } else {
      setExpandedBudgets(new Set());
    }
  };

  // Tutorial callback: show/hide placeholder transaction
  const handleTutorialShowPlaceholder = (show: boolean) => {
    setTutorialPlaceholderTx(show);
  };

  // Build a tutorial placeholder transaction object
  const buildTutorialPlaceholder = (): Transaction | null => {
    if (state.budgets.length === 0) return null;
    return {
      id: '__tutorial_placeholder__',
      vendor: 'Example Store',
      amount: 24.99,
      date: new Date().toISOString(),
      budget_id: state.budgets[0].id,
      user_id: state.user?.id || '1',
      userName: state.user?.name || 'You',
      is_projected: false,
      label: 'Manual' as any,
      created_at: new Date().toISOString(),
    };
  };

  // Tutorial callback: show/hide transaction modal for demo
  const handleTutorialShowTxModal = (show: boolean) => {
    setTutorialShowTxModal(show);
    if (show) {
      setSelectedTx(buildTutorialPlaceholder());
    } else {
      setSelectedTx(null);
    }
  };

  // Tutorial callback: open/close the transaction form
  const handleTutorialOpenForm = (open: boolean) => {
    setTutorialFormOpen(open);
    setIsAddingTx(open);
  };

  // Tutorial callback: trigger split demo animation
  const handleTutorialDemoSplit = () => {
    setDemoSplitTrigger(prev => prev + 1);
  };

  // Build placeholder transaction for display in expanded budget during tutorial
  const tutorialPlaceholderTransaction: Transaction | null = tutorialPlaceholderTx
    ? buildTutorialPlaceholder()
    : null;

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
      transactions: currentMonthTransactionsAll,
      totalIncome,
      remainingMoney,
      settings: {
        app_notifications_enabled: (state.settings as any).app_notifications_enabled,
        notification_rules: (state.settings as any).notification_rules || [],
      },
    });
  }, [
    state.user?.id,
    state.budgets,
    currentMonthTransactionsAll,
    totalIncome,
    remainingMoney,
    (state.settings as any).app_notifications_enabled,
  ]);

  // If showing parsing view, render that instead of the main dashboard
  if (showParsing) {
    return (
      <div className="flex-1 flex flex-col h-screen relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
        <TransactionParsing
          enabled={state.settings.notificationsEnabled || false}
          onToggle={(v: boolean) => updateSettings('notificationsEnabled', v)}
          onBack={() => setShowParsing(false)}
          onAddTransaction={() => setIsAddingTx(true)}
          onGoHome={() => {
            setShowParsing(false);
            handleGoHome();
          }}
          autoDetectedTransactions={autoDetectedTransactions}
          onTransactionTap={(tx) => setSelectedTx(tx)}
          onDeleteTransaction={onDeleteTransaction}
          pendingTransactions={state.pendingTransactions || []}
          rejectedTransactions={state.rejectedTransactions || []}
          budgets={visibleBudgets}
          onApprovePending={onApprovePendingTransaction}
          onRejectPending={onRejectPendingTransaction}
          onRefreshNotifications={onRefreshNotifications}
        />

        {isAddingTx && (
          <TransactionForm
            onClose={() => {
              setIsAddingTx(false);
              onDevResetShowAddTx?.();
            }}
            onSave={onAddTransaction}
            budgets={visibleBudgets}
            userId={state.user?.id || '1'}
            userName={state.user?.name || 'User'}
            isSharedAccount={isSharedAccount}
            vendorHistory={vendorHistory}
          />
        )}

        {selectedTx && (
          <TransactionActionModal
            transaction={selectedTx}
            budgets={visibleBudgets}
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
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
      {/* Background glow */}
      <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700 animate-nest">
        <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/25 dark:bg-emerald-500/35"></div>
        <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/20 dark:bg-green-400/30"></div>
      </div>

      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-0 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <DashboardHeader
          onOpenSettings={() => setShowSettings(true)}
        />
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col p-3 pb-2 pt-0 overflow-hidden relative z-10">
        {!isLoadingData && (
          <DashboardBalanceSection
            isSharedAccount={isSharedAccount}
            remainingMoney={remainingMoney}
          />
        )}

        {!searchQuery && (
          <CategoryBarChart
            budgets={visibleBudgets}
            transactions={state.transactions}
            projectedTransactions={projectedCurrentMonth}
            totalIncome={totalIncome}
            isTutorialMode={showTutorial}
            theme={state.settings.theme as 'light' | 'dark'}
          />
        )}

        {searchQuery ? (
          <SearchResults
            searchQuery={searchQuery}
            currentMonthTransactions={currentMonthTransactions}
            pastTransactions={pastTransactions}
            futureTransactions={futureTransactions}
            allTransactions={state.transactions}
            currentUserName={state.user?.name || ''}
            isSharedAccount={isSharedAccount}
            budgets={state.budgets}
            onTransactionTap={(tx) => setSelectedTx(tx)}
          />
        ) : (
          <DashboardTransactionList
            currentMonthTransactions={
              tutorialPlaceholderTransaction
                ? [...currentMonthWithProjected, tutorialPlaceholderTransaction]
                : currentMonthWithProjected
            }
            pastTransactions={pastTransactions}
            futureTransactions={futureTransactions}
            budgets={visibleBudgets}
            currentUserName={state.user?.name || ''}
            isSharedAccount={isSharedAccount}
            onTransactionTap={(tx) => setSelectedTx(tx)}
            scrollContainerRef={scrollContainerRef}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        )}
      </main>

      <DashboardBottomBar
        onGoHome={handleGoHome}
        onAddTransaction={() => setIsAddingTx(true)}
        onOpenParsing={() => setShowParsing(true)}
        activeView="home"
        shouldAnimate={shouldAnimateBottomBarRef.current}
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
          transactions={state.transactions}
          onChangePartnerLinkEmail={setPartnerLinkEmail}
          onClose={() => {
            setShowSettings(false);
            setIsLinkingPartner(false);
            onDevResetShowSettings?.();
          }}
          onRunTutorial={handleRunTutorialFromSettings}
          onUpdateSettings={updateSettings}
          onUpdateUserIncome={updateUserIncome}
          onConnectPartner={handleConnectPartner}
          onDisconnectPartner={handleDisconnectPartner}
          onToggleLinkingPartner={setIsLinkingPartner}
          onSignOut={onSignOut}
          onSaveBudgetLimit={saveBudgetLimit}
          saveBudgetVisibility={saveBudgetVisibility}
        />
      )}

      {isAddingTx && (
        <TransactionForm
          onClose={() => {
            setIsAddingTx(false);
            setTutorialFormOpen(false);
            onDevResetShowAddTx?.();
          }}
          onSave={tutorialFormOpen ? (_tx: Transaction) => { /* no-op: saves disabled during tutorial */ } : onAddTransaction}
          budgets={visibleBudgets}
          userId={state.user?.id || '1'}
          userName={state.user?.name || 'User'}
          isSharedAccount={isSharedAccount}
          isTutorialMode={tutorialFormOpen && showTutorial}
          vendorHistory={vendorHistory}
          demoSplitTrigger={demoSplitTrigger}
        />
      )}

      {selectedTx && (
        <TransactionActionModal
          transaction={selectedTx}
          budgets={visibleBudgets}
          currentUserName={state.user?.name || 'User'}
          isSharedAccount={isSharedAccount}
          onClose={() => {
            setSelectedTx(null);
            setTutorialShowTxModal(false);
          }}
          onEdit={(updatedTx) => {
            if (selectedTx.id === '__tutorial_placeholder__') {
              setSelectedTx(null);
              return;
            }
            onUpdateTransaction(updatedTx);
            setSelectedTx(null);
          }}
          onDelete={() => {
            if (selectedTx.id === '__tutorial_placeholder__') {
              setSelectedTx(null);
              return;
            }
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
          onExpandBudget={handleTutorialExpandBudget}
          onShowPlaceholderTransaction={handleTutorialShowPlaceholder}
          onShowTransactionModal={handleTutorialShowTxModal}
          onOpenTransactionForm={handleTutorialOpenForm}
          onDemoSplit={handleTutorialDemoSplit}
          firstBudgetId={state.budgets.length > 0 ? state.budgets[0].id : undefined}
        />
      )}
    </div>
  );
};

export default Dashboard;
