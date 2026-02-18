import React, {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { AppState, Transaction, BudgetCategory } from '../types';
import TransactionForm from './TransactionForm';
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
  onApprovePendingTransaction?: (
    pendingId: string,
    categoryId: string,
    preferredName?: string,
  ) => void | Promise<void>;
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
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(
    new Set(),
  );
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
    console.log(
      '[Dashboard] Subscribe tapped — Google Play Billing integration pending',
    );
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
    shouldAnimateBottomBarRef.current = false;
  }, []);

  // Lock body scroll when overlays are open
  useEffect(() => {
    const shouldLock = showSettings || isAddingTx || !!selectedTx;
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

  /**
   * ✅ KEY FIX:
   * Supabase gives us:
   *  - category_id (points to categories.id)
   *
   * Your budgets (state.budgets) most likely look like user_budgets:
   *  - id            (budget row id)
   *  - category_id   (same categories.id as transactions.category_id)
   *
   * The UI groups by tx.budget_id === budget.id.
   *
   * So here we:
   *  1) Build a map: category_id -> budget_id
   *  2) For each transaction, set budget_id using that map.
   *  3) Normalize amount, date, and userName.
   */
  const normalizedTransactions: Transaction[] = useMemo(() => {
    // 1) Build category_id -> budget_id map from state.budgets
    const categoryToBudgetId = new Map<string, string>();
    (state.budgets || []).forEach((b: any) => {
      const catId =
        b.category_id ??
        b.categoryId ??
        (typeof b.category === 'object' ? b.category?.id : undefined);

      if (catId && b.id) {
        categoryToBudgetId.set(String(catId), String(b.id));
      }
    });

    const list = (state.transactions || []).map((tx: any) => {
      // Normalize amount to a number
      const rawAmount = tx.amount;
      const amountNum =
        typeof rawAmount === 'number'
          ? rawAmount
          : rawAmount == null
          ? 0
          : Number(rawAmount);

      // Normalize date to plain 'YYYY-MM-DD' string
      let dateStr: string;
      if (typeof tx.date === 'string') {
        dateStr = tx.date.slice(0, 10); // handles '2026-02-16' and '2026-02-16T...'
      } else if (tx.date instanceof Date) {
        dateStr = tx.date.toISOString().slice(0, 10);
      } else {
        dateStr = '';
      }

      // Get category id from transaction
      const rawCategoryId =
        tx.category_id ??
        tx.categoryId ??
        (typeof tx.category === 'object' ? tx.category?.id : undefined);

      // Look up matching budget id from map
      const budgetIdFromCategory =
        rawCategoryId != null
          ? categoryToBudgetId.get(String(rawCategoryId))
          : undefined;

      return {
        ...tx,
        date: dateStr,
        // Prefer any existing budget_id, otherwise map category -> budget id.
        budget_id:
          tx.budget_id ??
          budgetIdFromCategory ??
          null,
        userName: tx.userName ?? tx.user_name,
        amount: Number.isFinite(amountNum) ? amountNum : 0,
      };
    });

    if (typeof window !== 'undefined') {
      console.log('[Dashboard] normalizedTransactions count:', list.length);
      console.log('[Dashboard] first 3 transactions:', list.slice(0, 3));
    }

    return list as Transaction[];
  }, [state.transactions, state.budgets]);

  // Filter out hidden budget categories
  const hiddenCategories: string[] = state.settings.hiddenCategories || [];
  const visibleBudgets = useMemo(
    () => state.budgets.filter(b => !hiddenCategories.includes(b.id)),
    [state.budgets, hiddenCategories],
  );

  // All transactions, optionally filtered by search query (SEARCH should span all months)
  const filteredTransactions = useMemo(() => {
    let list = normalizedTransactions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) => t.vendor.toLowerCase().includes(q));
    }
    return list;
  }, [normalizedTransactions, searchQuery]);

  // Build vendor history for autocomplete (most recent transaction per vendor)
  const vendorHistory = useMemo(() => {
    const vendorMap = new Map<
      string,
      { vendor: string; budget_id: string; date: string }
    >();
    const sorted = [...normalizedTransactions].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    for (const tx of sorted) {
      const key = tx.vendor.toLowerCase();
      if (!vendorMap.has(key)) {
        vendorMap.set(key, {
          vendor: tx.vendor,
          budget_id: (tx as any).budget_id || '',
          date: tx.date,
        });
      }
    }
    return Array.from(vendorMap.values());
  }, [normalizedTransactions]);

  // Helper: extract "YYYY-MM" from a date string without timezone conversion.
  const txYearMonth = (dateStr: string) => dateStr.slice(0, 7); // "YYYY-MM"

  // Track current month (updates if app stays open across a month boundary)
  const [currentYearMonth, setCurrentYearMonth] = useState(getCurrentYearMonth);

  useEffect(() => {
    const checkMonth = () => {
      setCurrentYearMonth((prev) => {
        const newYearMonth = getCurrentYearMonth();
        return prev !== newYearMonth ? newYearMonth : prev;
      });
    };

    checkMonth();
    const interval = setInterval(checkMonth, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  /**
   * HOME: THIS MONTH ONLY (but ALL vendors)
   */
  const currentMonthTransactionsAll = useMemo(() => {
    const list = normalizedTransactions.filter(
      (tx) => txYearMonth(tx.date) === currentYearMonth,
    );

    if (typeof window !== 'undefined') {
      console.log('[Dashboard] currentYearMonth:', currentYearMonth);
      console.log(
        '[Dashboard] currentMonthTransactionsAll count:',
        list.length,
      );
    }

    return list;
  }, [normalizedTransactions, currentYearMonth]);

  /**
   * SEARCH: show matches across past/current/future
   */
  const currentMonthTransactions = useMemo(
    () =>
      filteredTransactions.filter(
        (tx) => txYearMonth(tx.date) === currentYearMonth,
      ),
    [filteredTransactions, currentYearMonth],
  );

  const pastTransactions = useMemo(
    () =>
      filteredTransactions.filter(
        (tx) => txYearMonth(tx.date) < currentYearMonth,
      ),
    [filteredTransactions, currentYearMonth],
  );

  const futureTransactions = useMemo(
    () =>
      filteredTransactions.filter(
        (tx) => txYearMonth(tx.date) > currentYearMonth,
      ),
    [filteredTransactions, currentYearMonth],
  );

  // Generate projected transactions from recurring entries (display-only, not saved to DB)
  const projectedTransactions = useMemo(
    () => generateProjectedTransactions(normalizedTransactions),
    [normalizedTransactions],
  );

  // Projected transactions falling in the current month
  const projectedCurrentMonth = useMemo(
    () =>
      projectedTransactions.filter(
        (tx) => txYearMonth(tx.date) === currentYearMonth,
      ),
    [projectedTransactions, currentYearMonth],
  );

  // Current month + projected (for display in budget sections)
  const currentMonthWithProjected = useMemo(
    () => [...currentMonthTransactionsAll, ...projectedCurrentMonth],
    [currentMonthTransactionsAll, projectedCurrentMonth],
  );

  // Total income
  const totalIncome = useMemo(
    () => state.user?.monthlyIncome || 0,
    [state.user?.monthlyIncome],
  );

  // Remaining money (this month only, spent vs projected)
  const remainingMoney = useMemo(() => {
    const allCurrentMonth = [
      ...currentMonthTransactionsAll,
      ...projectedCurrentMonth,
    ];

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
        (tx: any) => tx.budget_id === b.id,
      );

      const spent = bTxs.reduce((acc, tx) => {
        if (tx.is_projected) return acc;
        return acc + (tx.budget_id === b.id ? tx.amount : 0);
      }, 0);

      if (spent > b.totalLimit) totalOverspend += spent - b.totalLimit;
    });

    return totalOverspend;
  }, [visibleBudgets, currentMonthTransactionsAll, state.settings.useLeisureAsBuffer]);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedBudgets);
    if (next.has(id)) next.delete(id);
    else {
      next.clear();
      next.add(id);
    }
    setExpandedBudgets(next);
  };

  const handleGoHome = () => {
    setExpandedBudgets(new Set());
    setSearchQuery('');
    setTimeout(() => {
      const containerEl = scrollContainerRef.current;
      if (containerEl) containerEl.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  const updateSettings = (key: keyof AppState['settings'], value: any) => {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
    }));

    if (key === 'theme') saveTheme(value as 'light' | 'dark');
  };

  const updateUserIncome = (income: number) => saveUserIncome(income);

  const handleConnectPartner = () => {
    if (!partnerLinkEmail.includes('@')) return;
    setState((prev) => ({
      ...prev,
      user: prev.user
        ? { ...prev.user, budgetingSolo: false, partnerEmail: partnerLinkEmail }
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

  // 🔔 Notification alerts
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
      const txMonth = tx.date.slice(0, 7);
      const current = getCurrentYearMonth();
      if (txMonth === current) setToastMessage('Transaction logged!');
      else if (txMonth > current)
        setToastMessage(
          'Future transaction logged! Use search bar at the top to see it.',
        );
      else
        setToastMessage(
          'Past transaction logged! Use search bar at the top to see it.',
        );
    },
    [onAddTransaction],
  );

  const handleVendorOverrideUpdated = useCallback(
    (vendor: string, info: string) => {
      if (info === 'vendor_name_changed') {
        setToastMessage(
          `Covault will automatically use this vendor name for this vendor going forward.`,
        );
      } else {
        setToastMessage(
          `Covault will automatically use this budget category for ${vendor} going forward.`,
        );
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
          allTransactions={normalizedTransactions}
          onTransactionTap={(tx) => setSelectedTx(tx)}
          budgets={visibleBudgets}
          userId={state.user?.id}
          onRefreshNotifications={onRefreshNotifications}
          onReloadTransactions={onReloadTransactions}
          onClearEntered={() => {
            setState((prev) => ({
              ...prev,
              transactions: prev.transactions.filter(
                (tx) => (tx as any).label !== 'AI',
              ),
            }));
          }}
        />
      ) : (
        <PageShell showGlow={!isFocusMode}>
          {/* DEBUG OVERLAY — shows how many transactions the dashboard sees */}
          <div
            style={{
              position: 'fixed',
              top: 80,
              right: 8,
              zIndex: 9999,
              background: 'rgba(15, 23, 42, 0.9)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: 8,
              fontSize: 10,
              fontFamily: 'system-ui',
            }}
          >
            tx: {normalizedTransactions.length} | month: {currentYearMonth}
          </div>

          {/* Header */}
          <header
            className="px-6 pt-safe-top pb-0 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          >
            <DashboardHeader onOpenSettings={() => setShowSettings(true)} />
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
                  transactions={normalizedTransactions}
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
                allTransactions={normalizedTransactions}
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
              transactions={normalizedTransactions}
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
              onClose={() => setIsAddingTx(false)}
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
          onClose={() => setSelectedTx(null)}
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
