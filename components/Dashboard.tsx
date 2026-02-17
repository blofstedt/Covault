import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';
import BudgetSection from './BudgetSection';
import TransactionForm from './TransactionForm';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import TransactionActionModal from './TransactionActionModal';
import TransactionParsing from './TransactionParsing';
import PremiumGate from './PremiumGate';
import SubscribeModal from './SubscribeModal';
import PageShell from './ui/PageShell';

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
import { generateProjectedTransactions } from '../lib/projectedTransactions';
import { hasPremiumAccess, shouldShowUpgradePrompt } from '../lib/entitlement';

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
  onApprovePendingTransaction?: (pendingId: string, categoryId: string, preferredName?: string) => void | Promise<void>;
  onRejectPendingTransaction?: (pendingId: string) => void;
  onClearFilteredNotifications?: (ids: string[]) => Promise<void>;
  onClearApprovedTransactions?: (ids: string[]) => Promise<void>;
  onRefreshNotifications?: () => Promise<void>;
  onReloadPendingTransactions?: (userId: string) => Promise<void>;
  onReloadTransactions?: (userId: string) => Promise<void>;
  saveBudgetLimit: (categoryId: string, newLimit: number) => void;
  saveUserIncome: (income: number) => void;
  saveTheme: (theme: 'light' | 'dark') => void;
  saveBudgetVisibility: (categoryId: string, visible: boolean) => void;
  isLoadingData: boolean;
  secondsUntilNextScan?: number | null;
  initialShowParsing?: boolean;
}

// Helper: get the current year-month string
const getCurrentYearMonth = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

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
  onClearFilteredNotifications,
  onClearApprovedTransactions,
  onRefreshNotifications,
  onReloadPendingTransactions,
  onReloadTransactions,
  saveBudgetLimit,
  saveUserIncome,
  saveTheme,
  saveBudgetVisibility,
  isLoadingData,
  secondsUntilNextScan,
  initialShowParsing = false,
}) => {
  const [isAddingTx, setIsAddingTx] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showParsing, setShowParsing] = useState(initialShowParsing);
  const [isLinkingPartner, setIsLinkingPartner] = useState(false);
  const [partnerLinkEmail, setPartnerLinkEmail] = useState('');
  const shouldAnimateBottomBarRef = useRef(true);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Premium access check (single source of truth)
  const hasPremium = hasPremiumAccess(state.user);

  const handleSubscribe = () => {
    // TODO: Integrate Google Play Billing flow here.
    // For now, open a placeholder or log the intent.
    console.log('[Dashboard] Subscribe tapped — Google Play Billing integration pending');
    setShowSubscribeModal(false);
  };

  // Show "Upgrade now!" modal on every app open when the trial has expired
  useEffect(() => {
    if (shouldShowUpgradePrompt(state.user)) {
      setShowSubscribeModal(true);
    }
  }, [state.user]);

  // Scroll refs shared with child components
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const bodyOverflowRef = useRef<string | null>(null);

  // Track initial mount for animation purposes
  useEffect(() => {
    // After the first render, disable animation for subsequent renders
    shouldAnimateBottomBarRef.current = false;
  }, []);

  // Lock body scroll when overlays are open
  useEffect(() => {
    const shouldLock =
      showSettings || isAddingTx || !!selectedTx;
    if (shouldLock) {
      if (bodyOverflowRef.current === null) {
        bodyOverflowRef.current = document.body.style.overflow || '';
      }
      document.body.style.overflow = 'hidden';
    } else if (bodyOverflowRef.current !== null) {
      document.body.style.overflow = bodyOverflowRef.current;
      bodyOverflowRef.current = null;
    }
  }, [showSettings, isAddingTx, selectedTx]);

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
  const hiddenCategories: string[] = state.settings.hiddenCategories || [];
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
    const vendorMap = new Map<string, { vendor: string; budget_id: string; date: string }>();
    const sorted = [...state.transactions].sort((a, b) => {
      return b.date.localeCompare(a.date);
    });
    for (const tx of sorted) {
      const key = tx.vendor.toLowerCase();
      if (!vendorMap.has(key)) {
        vendorMap.set(key, {
          vendor: tx.vendor,
          budget_id: tx.budget_id || '',
          date: tx.date,
        });
      }
    }
    return Array.from(vendorMap.values());
  }, [state.transactions]);

  // Helper: extract "YYYY-MM" from a date string without timezone conversion.
  // Transaction dates originate as date-only values (e.g. "2025-02-11") and are
  // stored as ISO strings ("2025-02-11T00:00:00.000Z"). Parsing them through the
  // Date constructor and calling getMonth()/getUTCMonth() can shift the calendar
  // month depending on the user's timezone. Extracting directly from the string
  // avoids this.
  const txYearMonth = (dateStr: string) => dateStr.slice(0, 7); // "YYYY-MM"

  // State to track the current month for transaction filtering
  // This ensures that if the app is left open across a month boundary,
  // the current month will update and transactions will be filtered correctly
  const [currentYearMonth, setCurrentYearMonth] = useState(getCurrentYearMonth);

  // Set up an interval to check if the month has changed
  // Only update state when the month actually changes to avoid unnecessary re-renders
  useEffect(() => {
    const checkMonth = () => {
      setCurrentYearMonth((prev) => {
        const newYearMonth = getCurrentYearMonth();
        // Only update if the month actually changed
        return prev !== newYearMonth ? newYearMonth : prev;
      });
    };

    // Check immediately on mount in case the month changed since initialization
    checkMonth();

    // Check every minute to catch month changes promptly
    // This is still inexpensive as it only updates state when the month actually changes
    const interval = setInterval(checkMonth, 60 * 1000);

    return () => clearInterval(interval);
  }, []); // Empty dependency array - the interval should run continuously

  // Unfiltered current month transactions (used for balance calculation)
  const currentMonthTransactionsAll = useMemo(
    () =>
      state.transactions.filter((tx) => txYearMonth(tx.date) === currentYearMonth),
    [state.transactions, currentYearMonth],
  );

  // Search-filtered current month transactions (used for display only)
  const currentMonthTransactions = useMemo(
    () =>
      filteredTransactions.filter((tx) => txYearMonth(tx.date) === currentYearMonth),
    [filteredTransactions, currentYearMonth],
  );

  const pastTransactions = useMemo(
    () =>
      state.transactions.filter((tx) => txYearMonth(tx.date) < currentYearMonth),
    [state.transactions, currentYearMonth],
  );

  const futureTransactions = useMemo(
    () =>
      state.transactions.filter((tx) => txYearMonth(tx.date) > currentYearMonth),
    [state.transactions, currentYearMonth],
  );

  // Generate projected transactions from recurring entries (display-only, not saved to DB)
  const projectedTransactions = useMemo(
    () => generateProjectedTransactions(state.transactions),
    [state.transactions],
  );

  // Projected transactions falling in the current month
  const projectedCurrentMonth = useMemo(
    () =>
      projectedTransactions.filter((tx) => txYearMonth(tx.date) === currentYearMonth),
    [projectedTransactions, currentYearMonth],
  );

  // Current month transactions augmented with projected entries (for display in budget sections)
  // Note: futureTransactions are intentionally excluded — they belong to future months
  // and should not affect current month budget calculations or display.
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
          tx.budget_id === b.id,
      );

      // Only count actual spent amounts, not projected transactions
      const spent = bTxs.reduce((acc, tx) => {
        if (tx.is_projected) return acc;
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
        app_notifications_enabled: state.settings.app_notifications_enabled,
      },
    });
  }, [
    state.user?.id,
    state.budgets,
    currentMonthTransactionsAll,
    totalIncome,
    remainingMoney,
    state.settings.app_notifications_enabled,
  ]);

  // Auto-dismiss toast after 3 seconds
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Wrap onAddTransaction to show a confirmation toast based on the transaction date
  const handleAddTransactionWithToast = useCallback(
    (tx: Transaction) => {
      onAddTransaction(tx);
      const txMonth = tx.date.slice(0, 7); // "YYYY-MM"
      const current = getCurrentYearMonth();
      if (txMonth === current) {
        setToastMessage('Transaction logged!');
      } else if (txMonth > current) {
        setToastMessage('Future transaction logged! Use search bar at the top to see it.');
      } else {
        setToastMessage('Past transaction logged! Use search bar at the top to see it.');
      }
    },
    [onAddTransaction],
  );

  // Handle vendor override update from AI transaction editing (fires on save only)
  const handleVendorOverrideUpdated = useCallback(
    (vendor: string, info: string) => {
      if (info === 'vendor_name_changed') {
        setToastMessage(`Covault will automatically use this vendor name for this vendor going forward.`);
      } else {
        setToastMessage(`Covault will automatically use this budget category for ${vendor} going forward.`);
      }
    },
    [],
  );

  // If showing parsing view without premium (and not in tutorial), show subscribe modal
  if (showParsing && !hasPremium) {
    return (
      <SubscribeModal
        onClose={() => setShowParsing(false)}
        onSubscribe={() => {
          setShowParsing(false);
          handleSubscribe();
        }}
      />
    );
  }

  return (
    <>
    {showParsing ? (
      <TransactionParsing
        enabled={state.settings.notificationsEnabled || false}
        onToggle={(v: boolean) => updateSettings('notificationsEnabled', v)}
        onBack={() => setShowParsing(false)}
        onAddTransaction={() => setIsAddingTx(true)}
        onGoHome={() => {
          setShowParsing(false);
          handleGoHome();
        }}
        allTransactions={state.transactions}
        onTransactionTap={(tx) => setSelectedTx(tx)}
        budgets={visibleBudgets}
        userId={state.user?.id}
        onRefreshNotifications={onRefreshNotifications}
        onReloadTransactions={onReloadTransactions}
        onClearEntered={() => {
          setState(prev => ({
            ...prev,
            transactions: prev.transactions.filter(tx => tx.label !== 'AI'),
          }));
        }}
      />
    ) : (
    <PageShell showGlow={!isFocusMode}>

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
        {!isFocusMode && !isLoadingData && (
          <DashboardBalanceSection
            isSharedAccount={isSharedAccount}
            remainingMoney={remainingMoney}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
          />
        )}

        {!isFocusMode && !searchQuery && (
          <PremiumGate hasPremium={hasPremium} onSubscribe={handleSubscribe}>
            <BudgetFlowChart
              budgets={visibleBudgets}
              transactions={state.transactions}
              theme={state.settings.theme as 'light' | 'dark'}
            />
          </PremiumGate>
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
          <DashboardBudgetSectionsList
            budgets={state.budgets}
            transactions={currentMonthWithProjected}
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
        activeView="home"
        shouldAnimate={shouldAnimateBottomBarRef.current}
      />

      {showSettings && (
        <DashboardSettingsModal
          isSharedAccount={isSharedAccount}
          settings={state.settings}
          user={state.user}
          isLinkingPartner={isLinkingPartner}
          partnerLinkEmail={partnerLinkEmail}
          budgets={state.budgets}
          transactions={state.transactions}
          onChangePartnerLinkEmail={setPartnerLinkEmail}
          onClose={() => {
            setShowSettings(false);
            setIsLinkingPartner(false);
          }}
          onUpdateSettings={updateSettings}
          onUpdateUserIncome={updateUserIncome}
          onConnectPartner={handleConnectPartner}
          onDisconnectPartner={handleDisconnectPartner}
          onToggleLinkingPartner={setIsLinkingPartner}
          onSignOut={onSignOut}
          onSaveBudgetLimit={saveBudgetLimit}
          saveBudgetVisibility={saveBudgetVisibility}
          hasPremium={hasPremium}
          onSubscribe={handleSubscribe}
        />
      )}

      {isAddingTx && (
        <TransactionForm
          onClose={() => {
            setIsAddingTx(false);
          }}
          onSave={handleAddTransactionWithToast}
          budgets={visibleBudgets}
          userId={state.user?.id || '1'}
          userName={state.user?.name || 'User'}
          isSharedAccount={isSharedAccount}
          vendorHistory={vendorHistory}
        />
      )}

      {showSubscribeModal && (
        <SubscribeModal
          onClose={() => setShowSubscribeModal(false)}
          onSubscribe={() => {
            setShowSubscribeModal(false);
            handleSubscribe();
          }}
        />
      )}

      {toastMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-emerald-600 text-white px-6 py-3 rounded-2xl shadow-xl shadow-emerald-500/20 text-xs font-black uppercase tracking-widest text-center max-w-xs">
            {toastMessage}
          </div>
        </div>
      )}
    </PageShell>
    )}

      {selectedTx && (
        <TransactionActionModal
          transaction={selectedTx}
          budgets={state.budgets}
          currentUserName={state.user?.name || 'User'}
          isSharedAccount={isSharedAccount}
          onClose={() => {
            setSelectedTx(null);
          }}
          onEdit={(updatedTx) => {
            onUpdateTransaction(updatedTx);
            setSelectedTx(null);
          }}
          onDelete={() => {
            onDeleteTransaction(selectedTx.id);
            setSelectedTx(null);
          }}
          onVendorOverrideUpdated={handleVendorOverrideUpdated}
        />
      )}

    </>
  );
};

export default Dashboard;
