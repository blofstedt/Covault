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
import SmartCardDeck from './dashboard_components/SmartCardDeck';

import useNormalizedTransactions from './dashboard_components/useNormalizedTransactions';
import useDashboardTotals from './dashboard_components/useDashboardTotals';
import { getNeedsReviewCount, getReviewQueueChangedEventName } from '../lib/localNotificationMemory';
import { collectSmartCards } from '../lib/smartCards';
import { supabase } from '../lib/supabase';
import { resolveBudgetIdFromRow } from '../lib/hooks/transactionMappers';
import { getLocalMonthKey } from '../lib/dateUtils';

interface VendorHistoryItem {
  vendor: string;
  budget_id: string;
}

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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [remoteVendorHistory, setRemoteVendorHistory] = useState<VendorHistoryItem[]>([]);
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());
  const hasExpandedBudget = expandedBudgets.size > 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const budgetRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const normalizedTransactions = useNormalizedTransactions(state.transactions, state.budgets);

  const { currentMonthTransactions, projectedTransactions, remainingMoney } = useDashboardTotals(
    normalizedTransactions,
    state.user?.monthlyIncome || 0,
  );

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Totals for savings goal bar
  const totalSpent = useMemo(
    () => currentMonthTransactions.reduce((s, t) => s + Math.abs(t.amount), 0),
    [currentMonthTransactions],
  );
  const totalProjected = useMemo(
    () =>
      projectedTransactions
        .filter((t) => typeof t.date === 'string' && t.date.slice(0, 7) === monthKey)
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    [projectedTransactions, monthKey],
  );

  const currentMonthBudgetTransactions = useMemo(() => {
    const currentMonthProjected = projectedTransactions.filter(
      (t) => typeof t.date === 'string' && getLocalMonthKey(t.date) === monthKey,
    );

    return [...currentMonthTransactions, ...currentMonthProjected];
  }, [currentMonthTransactions, projectedTransactions, monthKey]);

  const chartTransactions = useMemo(() => {
    const existingIds = new Set(normalizedTransactions.map((t) => t.id));
    const currentMonthProjected = projectedTransactions.filter(
      (t) => typeof t.date === 'string' && getLocalMonthKey(t.date) === monthKey && !existingIds.has(t.id),
    );

    return [...normalizedTransactions, ...currentMonthProjected];
  }, [normalizedTransactions, projectedTransactions, monthKey]);

  // ── Smart Card Deck ─────────────────────────────────────────────
  const [showSmartCards, setShowSmartCards] = useState(false);
  const smartCardsShownRef = useRef(false);

  const smartCards = useMemo(
    () =>
      collectSmartCards(
        state.budgets,
        normalizedTransactions,
        currentMonthBudgetTransactions,
        state.user?.id,
        state.user?.partnerName,
      ),
    [state.budgets, normalizedTransactions, currentMonthBudgetTransactions, state.user?.id, state.user?.partnerName],
  );

  // Show the deck automatically once on mount if there are cards & setting is on
  useEffect(() => {
    if (
      !smartCardsShownRef.current &&
      state.settings.smart_cards_enabled &&
      smartCards.length > 0
    ) {
      smartCardsShownRef.current = true;
      setShowSmartCards(true);
    }
  }, [smartCards.length, state.settings.smart_cards_enabled]);

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
    () => normalizedTransactions.filter((t) => typeof t.date === 'string' && getLocalMonthKey(t.date) < monthKey),
    [normalizedTransactions, monthKey],
  );

  const futureTransactions = useMemo(
    () => normalizedTransactions.filter((t) => typeof t.date === 'string' && getLocalMonthKey(t.date) > monthKey),
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

  const vendorHistory = useMemo<VendorHistoryItem[]>(() => {
    const activeUserId = state.user?.id;
    const activeUserName = (state.user?.name || '').trim().toLowerCase();
    const latestByVendor = new Map<string, { vendor: string; budget_id: string; sortKey: number }>();

    normalizedTransactions.forEach((tx) => {
      const belongsToUser = activeUserId
        ? tx.user_id === activeUserId
        : (tx.userName || '').trim().toLowerCase() === activeUserName;
      const vendorName = (tx.vendor || '').trim();
      if (!belongsToUser || !vendorName || !tx.budget_id) return;

      const timestamp = new Date(tx.date || tx.created_at || 0).getTime();
      const normalizedVendor = vendorName.toLowerCase();
      const existing = latestByVendor.get(normalizedVendor);

      if (!existing || timestamp >= existing.sortKey) {
        latestByVendor.set(normalizedVendor, {
          vendor: vendorName,
          budget_id: tx.budget_id,
          sortKey: Number.isFinite(timestamp) ? timestamp : 0,
        });
      }
    });

    remoteVendorHistory.forEach((item) => {
      if (!item.vendor || !item.budget_id) return;
      const normalizedVendor = item.vendor.toLowerCase();
      const existing = latestByVendor.get(normalizedVendor);
      if (!existing) {
        latestByVendor.set(normalizedVendor, {
          vendor: item.vendor,
          budget_id: item.budget_id,
          sortKey: 0,
        });
      }
    });

    return Array.from(latestByVendor.values())
      .sort((a, b) => b.sortKey - a.sortKey)
      .map(({ vendor, budget_id }) => ({ vendor, budget_id }));
  }, [normalizedTransactions, remoteVendorHistory, state.user?.id, state.user?.name]);

  useEffect(() => {
    const userId = state.user?.id;
    if (!userId) {
      setRemoteVendorHistory([]);
      return;
    }

    let cancelled = false;

    const loadVendorHistory = async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('vendor, budget, budget_id, category_id, date, created_at, user_id')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(250);

      if (cancelled || error || !data) return;

      const byVendor = new Map<string, VendorHistoryItem>();
      for (const row of data) {
        const vendor = String(row.vendor || '').trim();
        if (!vendor) continue;

        const budgetId = resolveBudgetIdFromRow(row);
        if (!budgetId) continue;

        const key = vendor.toLowerCase();
        if (!byVendor.has(key)) {
          byVendor.set(key, { vendor, budget_id: budgetId });
        }
      }

      setRemoteVendorHistory(Array.from(byVendor.values()));
    };

    loadVendorHistory();

    return () => {
      cancelled = true;
    };
  }, [state.user?.id]);

  useEffect(() => {
    if (!isSearchOpen && !searchQuery.trim()) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const searchField = document.getElementById('search-field');
      const searchResults = document.getElementById('search-results-panel');

      if (searchField?.contains(target) || searchResults?.contains(target)) {
        return;
      }

      setSearchQuery('');
      setIsSearchOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isSearchOpen, searchQuery]);


  if (showParsing) {
    return (
      <>
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
          onAddTransaction={() => setShowTransactionForm(true)}
          allTransactions={normalizedTransactions}
          onTransactionTap={setSelectedTx}
          budgets={state.budgets}
          userId={state.user?.id}
          onRefreshNotifications={onRefreshNotifications}
          onReloadTransactions={onReloadTransactions}
        />

        {selectedTx && (
          <TransactionActionModal
            transaction={selectedTx}
            budgets={state.budgets}
            currentUserName={state.user?.name || ''}
            isSharedAccount={!state.user?.budgetingSolo}
            vendorHistory={vendorHistory}
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
            vendorHistory={vendorHistory}
          />
        )}
      </>
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
          isSearchOpen={isSearchOpen}
          onSearchQueryChange={(value) => {
            setSearchQuery(value);
            if (value.trim()) setIsSearchOpen(true);
          }}
          onSearchOpenChange={setIsSearchOpen}
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
            <div
              className={`transition-all duration-500 ease-in-out ${
                hasExpandedBudget
                  ? 'max-h-0 opacity-0 -translate-y-2 pointer-events-none mb-0 overflow-hidden'
                  : 'max-h-[520px] opacity-100 translate-y-0 mb-2 overflow-visible'
              }`}
              aria-hidden={hasExpandedBudget}
            >
              <PremiumGate hasPremium={true}>
                <BudgetFlowChart
                  budgets={state.budgets}
                  transactions={chartTransactions}
                  monthlyIncome={state.user?.monthlyIncome || 0}
                  theme={state.settings.theme}
                />
              </PremiumGate>
            </div>

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
          onImportComplete={() => {
            if (state.user?.id && onReloadTransactions) {
              onReloadTransactions(state.user.id);
            }
          }}
        />
      )}

      {selectedTx && (
        <TransactionActionModal
          transaction={selectedTx}
          budgets={state.budgets}
          currentUserName={state.user?.name || ''}
          isSharedAccount={!state.user?.budgetingSolo}
          vendorHistory={vendorHistory}
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
          vendorHistory={vendorHistory}
        />
      )}

      {showSmartCards && smartCards.length > 0 && (
        <SmartCardDeck
          cards={smartCards}
          onDismiss={() => {}}
          onAllDismissed={() => setShowSmartCards(false)}
          userId={state.user?.id}
        />
      )}
    </>
  );
};

export default Dashboard;
