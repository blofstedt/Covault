import { log } from '../lib/log';
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppState, Transaction } from '../types';
import type { Toast } from '../types';

import PageShell from './ui/PageShell';
import FrameMeterOverlay from './dashboard_components/FrameMeterOverlay';
import {
  useFrameMeter,
  isFrameMeterEnabled,
  setFrameMeterEnabled,
} from '../lib/hooks/useFrameMeter';

// d3 is only needed for the chart, so it loads as its own chunk rather than
// as part of the entry bundle.
const BudgetFlowChart = React.lazy(() => import('./dashboard_components/BudgetFlowChart'));
import TransactionParsing from './TransactionParsing';
import TransactionActionModal from './TransactionActionModal';
import TransactionForm from './TransactionForm';
import PremiumGate from './PremiumGate';
import { useVendorOverrides } from './transaction_parsing/useVendorOverrides';

import DashboardBalanceSection from './dashboard_components/DashboardBalanceSection';
import DashboardBudgetSectionsList from './dashboard_components/DashboardBudgetSectionsList';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import DashboardSettingsModal from './dashboard_components/DashboardSettingsModal';
import SearchResults from './dashboard_components/SearchResults';

import useNormalizedTransactions from './dashboard_components/useNormalizedTransactions';
import useDashboardTotals from './dashboard_components/useDashboardTotals';
import { getLocalMonthKey } from '../lib/dateUtils';
import { useCurrentDay } from '../lib/hooks/useCurrentDay';
import { isInMonth } from '../lib/transactionOrdering';
import { checkAndTriggerAppNotifications } from '../lib/appNotifications';
import { supabase } from '../lib/supabase';
import { resolveBudgetIdFromRow } from '../lib/hooks/transactionMappers';
import { useNotificationRoute } from '../lib/hooks/useNotificationRoute';
import { buildWidgetSnapshot } from '../lib/widgetSnapshot';
import { pushWidgetSnapshot, type WidgetVendorRule } from '../lib/covaultNotification';
import { countAwaitingReview } from '../lib/reviewQueue';

// Map from app-state setting keys to DB column names.
const SETTING_DB_KEYS: Record<string, string> = {
  rolloverEnabled: 'rollover_enabled',
  useLeisureAsBuffer: 'leisure_buffer_enabled',
  showSavingsInsight: 'show_savings_insight',
  app_notifications_enabled: 'app_notifications_enabled',
  smart_notifications_enabled: 'smart_notifications_enabled',
  auto_accept_known_vendors: 'auto_accept_known_vendors',
  haptics_enabled: 'haptics_enabled',
};

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
  onSignOut: () => Promise<void>;
  saveBudgetLimit: (categoryId: string, newLimit: number) => Promise<void>;
  saveUserIncome: (income: number) => Promise<void>;
  saveTheme: (theme: 'light' | 'dark') => Promise<void>;
  saveBudgetVisibility: (categoryId: string, visible: boolean) => Promise<void>;
  saveSettingToDb: (dbKey: string, value: boolean | string | number) => Promise<void>;
  onLinkPartner: (partnerEmail: string) => Promise<void>;
  onUnlinkPartner: () => Promise<void>;
  onRefreshNotifications?: () => Promise<void>;
  onReloadTransactions?: (userId: string) => Promise<void>;
  /** Raise a transient toast (used for the Undo after filing a captured row). */
  onToast?: (toast: Toast) => void;
}

const Dashboard: React.FC<Props> = ({
  state,
  setState,
  onAddTransaction,
  onUpdateTransaction,
  onDeleteTransaction,
  onSignOut,
  saveBudgetLimit,
  saveUserIncome,
  saveTheme,
  saveBudgetVisibility,
  saveSettingToDb,
  onLinkPartner,
  onUnlinkPartner,
  onRefreshNotifications,
  onReloadTransactions,
  onToast,
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

  const scrollRef = useRef<HTMLDivElement>(null);

  // Animation diagnostics. Off unless the user turns it on; when off,
  // useFrameMeter never schedules a rAF loop and the overlay never renders.
  const [frameMeterOn, setFrameMeterOn] = useState<boolean>(() => isFrameMeterEnabled());
  const [frameReading, armFrameMeter] = useFrameMeter(frameMeterOn);

  // A capture notification says "tap to review", so land the user there. Any
  // open modal is dismissed first, otherwise the Review page opens behind it
  // and the tap looks like it did nothing.
  useNotificationRoute(
    useCallback(() => {
      setShowSettings(false);
      setSelectedTx(null);
      setShowTransactionForm(false);
      setShowParsing(true);
    }, []),
  );

  const normalizedTransactions = useNormalizedTransactions(state.transactions, state.budgets);

  // ── Vendor overrides (for the <VendorCategoryRulesCard> + <LearnedRulesCard>) ──
  const {
    vendorOverrides,
    handleDeleteVendorOverride,
    handleSetVendorCategory,
    handleSetProperName,
  } = useVendorOverrides({ userId: state.user?.id, budgets: state.budgets });

  // Single source of truth for "now": ticks over at local midnight and on
  // resume, so every month-scoped derivation below moves together.
  const todayIso = useCurrentDay();
  const monthKey = todayIso.slice(0, 7);

  const { currentMonthTransactions, projectedTransactions, remainingMoney, isIncomeLoaded } = useDashboardTotals(
    normalizedTransactions,
    state.user?.monthlyIncome || 0,
    todayIso,
  );

  // ── Home-screen widget ──
  // The widget runs in the native process with no Supabase session, so it can
  // only draw what we hand it. Push a fresh snapshot whenever the figures it
  // shows change — which covers app open, a reload after capture, a category
  // correction, and a theme switch.
  //
  // The vendor rules ride along so the native notification listener can
  // categorise a purchase captured while the app is closed and nudge the donut
  // without waiting for the next launch.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const snapshot = buildWidgetSnapshot({
      budgets: state.budgets,
      currentMonthTransactions,
      remaining: remainingMoney,
      income: state.user?.monthlyIncome || 0,
      theme: state.settings.theme ?? null,
      // Same selector the Review list and the bottom-bar badge use, so the
      // widget's pill can't disagree with either.
      pendingReview: countAwaitingReview(state.transactions),
    });
    const rules: WidgetVendorRule[] = vendorOverrides.map((vo) => ({
      matchKey: vo.match_key || vo.proper_name,
      matchType: vo.match_type || 'exact',
      // category_id holds the category *name* in this table (see SETUP.md).
      category: vo.category_name || vo.category_id,
    }));
    void pushWidgetSnapshot(snapshot, rules, state.settings.auto_accept_known_vendors === true);
  }, [
    state.budgets,
    currentMonthTransactions,
    remainingMoney,
    state.user?.monthlyIncome,
    state.settings.theme,
    vendorOverrides,
    state.transactions,
    state.settings.auto_accept_known_vendors,
  ]);

  // The vials show the current month and nothing else. Both halves of that
  // list — real transactions and projected occurrences — are filtered here
  // against the SAME month key, derived from the same `todayIso` that
  // useDashboardTotals uses.
  //
  // They used to come from two different clocks: the real half was filtered
  // inside useDashboardTotals against a month key recomputed during render,
  // the projected half against a `monthKey` held in state that only advanced
  // on resume. Any disagreement between the two put last month's rows in this
  // month's list — which is exactly what a Jul 31 entry sitting in an August
  // vial looks like.
  const currentMonthBudgetTransactions = useMemo(() => {
    const inCurrentMonth = (t: Transaction) => isInMonth(t, monthKey);

    return [
      ...currentMonthTransactions.filter(inCurrentMonth),
      ...projectedTransactions.filter(inCurrentMonth),
    ];
  }, [currentMonthTransactions, projectedTransactions, monthKey]);

  const chartTransactions = useMemo(() => {
    const existingIds = new Set(normalizedTransactions.map((t) => t.id));
    const currentMonthProjected = projectedTransactions.filter(
      (t) => typeof t.date === 'string' && getLocalMonthKey(t.date) === monthKey && !existingIds.has(t.id),
    );

    return [...normalizedTransactions, ...currentMonthProjected];
  }, [normalizedTransactions, projectedTransactions, monthKey]);

  // Stable key: changes only when a budget limit is added/removed/modified.
  // Prevents the notification effect from re-running on every array re-creation.
  const budgetLimitKey = useMemo(
    () => state.budgets.map(b => `${b.id}:${b.totalLimit}`).join(','),
    [state.budgets],
  );

  // Fire push notifications for budget overruns / low balance whenever the
  // transaction data changes. appNotifications.ts dedupes via localStorage so
  // the same alert won't fire more than once per budget per month.
  useEffect(() => {
    if (!state.user?.id || !state.budgets.length) return;
    checkAndTriggerAppNotifications({
      userId: state.user.id,
      budgets: state.budgets,
      transactions: currentMonthBudgetTransactions,
      remainingMoney,
      settings: {
        app_notifications_enabled: state.settings.app_notifications_enabled,
        smart_notifications_enabled: state.settings.smart_notifications_enabled,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.user?.id,
    budgetLimitKey,
    remainingMoney,
    state.settings.smart_notifications_enabled,
    state.settings.app_notifications_enabled,
  ]);

  // Badge count: number of AI-caught transactions not yet cleared.
  // Derived directly from app state so it automatically decreases when
  // a transaction is deleted (optimistic removal) or cleared (reload).
  const aiTransactionsCount = useMemo(
    () => state.transactions.filter(tx => tx.label === 'Automatic' && !tx.caught_cleared).length,
    [state.transactions],
  );

  // Single pass: the two filters below walked the whole list separately and
  // each called getLocalMonthKey (which allocates a Date) per transaction.
  const { pastTransactions, futureTransactions } = useMemo(() => {
    const past: Transaction[] = [];
    const future: Transaction[] = [];
    for (const t of normalizedTransactions) {
      if (typeof t.date !== 'string') continue;
      const key = getLocalMonthKey(t.date);
      if (key < monthKey) past.push(t);
      else if (key > monthKey) future.push(t);
    }
    return { pastTransactions: past, futureTransactions: future };
  }, [normalizedTransactions, monthKey]);

  const toggleExpand = useCallback((id: string) => {
    // Arm the frame meter on the same interaction that starts the animation,
    // so it measures the expand and not idle time. Inert unless the user has
    // switched the meter on in settings.
    armFrameMeter();
    setExpandedBudgets(prev => (prev.has(id) ? new Set() : new Set([id])));
  }, [armFrameMeter]);

  const handleUpdateSettings = (key: string, value: any) => {
    setState(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        [key]: value,
      },
    }));

    if (key === 'theme' && (value === 'light' || value === 'dark')) {
      saveTheme(value).catch((e) => log.error('[Dashboard] saveTheme failed:', e));
    } else if (SETTING_DB_KEYS[key] !== undefined) {
      saveSettingToDb(SETTING_DB_KEYS[key], value).catch(
        (e) => log.error(`[Dashboard] saveSettingToDb(${key}) failed:`, e),
      );
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
        .select('vendor, budget, date, created_at, user_id')
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
          onDeleteTransaction={onDeleteTransaction}
          onUpdateTransaction={onUpdateTransaction}
          userId={state.user?.id}
          onRefreshNotifications={onRefreshNotifications}
          onReloadTransactions={onReloadTransactions}
          onToast={onToast}
          vendorOverrides={vendorOverrides}
          onDeleteVendorOverride={handleDeleteVendorOverride}
          onSetVendorCategory={handleSetVendorCategory}
          onSetProperName={handleSetProperName}
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
      <PageShell>
        {/* Balance + settings cog + search: combined in one section */}
        <DashboardBalanceSection
          isSharedAccount={!state.user?.budgetingSolo}
          remainingMoney={remainingMoney}
          monthlyIncome={state.user?.monthlyIncome || 0}
          isIncomeLoaded={isIncomeLoaded}
          searchQuery={searchQuery}
          isSearchOpen={isSearchOpen}
          onSearchQueryChange={(value) => {
            setSearchQuery(value);
            if (value.trim()) setIsSearchOpen(true);
          }}
          onSearchOpenChange={setIsSearchOpen}
          onOpenSettings={() => setShowSettings(true)}
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
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden lg:px-6">
            {/* Chart: full width on desktop */}
            <div
              className="transition-all duration-500 ease-in-out overflow-hidden shrink-0 max-h-[300px] opacity-100 translate-y-0 mb-2 lg:max-h-none lg:mb-3"
              aria-hidden={false}
            >
              <PremiumGate hasPremium={true}>
                <React.Suspense fallback={<div className="h-full w-full" />}>
                <BudgetFlowChart
                  budgets={state.budgets}
                  transactions={chartTransactions}
                  monthlyIncome={state.user?.monthlyIncome || 0}
                  theme={state.settings.theme}
                  highlightedBudgetId={expandedBudgets.size > 0 ? Array.from(expandedBudgets)[0] : null}
                />
                </React.Suspense>
              </PremiumGate>
            </div>

            {/* Budget bars: vertical list on mobile, 2-col grid on desktop */}
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
              onToggleExpand={toggleExpand}
              onTransactionTap={setSelectedTx}
            />
          </div>
        )}

        <div
          aria-hidden="true"
          // Match the fixed bottom bar's height (including the device safe-area
          // inset) so the last budget vial never slides underneath it, plus a
          // small 8px gap so the spacing matches the `gap-2` between vials.
          className="shrink-0 h-[calc(env(safe-area-inset-bottom,0px)+5rem+0.5rem)]"
        />

        <DashboardBottomBar
          onGoHome={() => setShowParsing(false)}
          onAddTransaction={() => setShowTransactionForm(true)}
          onOpenParsing={() => setShowParsing(true)}
          activeView="home"
          pendingCount={aiTransactionsCount}
        />

        {frameMeterOn && <FrameMeterOverlay reading={frameReading} />}
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
          frameMeterEnabled={frameMeterOn}
          onToggleFrameMeter={(v: boolean) => {
            // localStorage, deliberately NOT a settings column. Per CLAUDE.md a
            // missing DB column fails silently and is indistinguishable from
            // success — the last property a diagnostic should have.
            setFrameMeterEnabled(v);
            setFrameMeterOn(v);
          }}
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
    </>
  );
};

export default Dashboard;
