import { log } from '../lib/log';
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppState, Transaction } from '../types';
import type { Toast } from '../types';

import PageShell from './ui/PageShell';

// d3 is only needed for the chart, so it loads as its own chunk rather than
// as part of the entry bundle.
const BudgetFlowChart = React.lazy(() => import('./dashboard_components/BudgetFlowChart'));
import TransactionParsing from './TransactionParsing';
import TransactionActionModal from './TransactionActionModal';
import TransactionForm from './TransactionForm';
import PremiumGate from './PremiumGate';
import { useVendorOverrides } from './transaction_parsing/useVendorOverrides';
import { refreshCommunityPack, setCommunityFlags, withdrawAllContributions } from '../lib/communityRules';

import DashboardBalanceSection from './dashboard_components/DashboardBalanceSection';
import DashboardBudgetSectionsList from './dashboard_components/DashboardBudgetSectionsList';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import DashboardSettingsModal from './dashboard_components/DashboardSettingsModal';
import MonthViewBanner from './dashboard_components/MonthViewBanner';
import SearchResults from './dashboard_components/SearchResults';

import useNormalizedTransactions from './dashboard_components/useNormalizedTransactions';
import useDashboardTotals from './dashboard_components/useDashboardTotals';
import { getLocalMonthKey } from '../lib/dateUtils';
import { useCurrentDay } from '../lib/hooks/useCurrentDay';
import { useMonthSelection } from '../lib/hooks/useMonthSelection';
import { balanceLabelForMonth, remainingForMonth } from '../lib/monthWindow';
import { isInMonth } from '../lib/transactionOrdering';
import { checkAndTriggerAppNotifications } from '../lib/appNotifications';
import { supabase } from '../lib/supabase';
import { resolveBudgetIdFromRow } from '../lib/hooks/transactionMappers';
import { useNotificationRoute } from '../lib/hooks/useNotificationRoute';
import { buildWidgetSnapshot } from '../lib/widgetSnapshot';
import { pushWidgetSnapshot, pushRecurringCharges, type WidgetVendorRule } from '../lib/covaultNotification';
import { countAwaitingReview } from '../lib/reviewQueue';
import { computeShieldBreakdown, type ShieldBreakdown } from '../lib/discretionaryShield';
import { collectRecurringCharges } from '../lib/recurringSchedule';
import { useAIModelOnDevice } from '../lib/hooks/useAIModelOnDevice';

// Map from app-state setting keys to DB column names.
// Stable identity: a fresh `{ total: 0, contributors: [] }` every render would
// defeat memo(BudgetSection) for the Leisure card on every keystroke elsewhere.
const NO_SHIELD: ShieldBreakdown = { total: 0, contributors: [] };

const SETTING_DB_KEYS: Record<string, string> = {
  rolloverEnabled: 'rollover_enabled',
  useLeisureAsBuffer: 'leisure_buffer_enabled',
  showSavingsInsight: 'show_savings_insight',
  app_notifications_enabled: 'app_notifications_enabled',
  smart_notifications_enabled: 'smart_notifications_enabled',
  auto_accept_known_vendors: 'auto_accept_known_vendors',
  haptics_enabled: 'haptics_enabled',
  community_rules_enabled: 'community_rules_enabled',
  community_rules_contribute: 'community_rules_contribute',
};

interface VendorHistoryItem {
  vendor: string;
  budget_id: string;
}

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  onAddTransaction: (t: Transaction) => void;
  onUpdateTransaction: (t: Transaction) => void | Promise<void>;
  onDeleteTransaction: (id: string) => void;
  onSignOut: () => Promise<void>;
  saveBudgetLimit: (categoryId: string, newLimit: number) => Promise<void>;
  saveUserIncome: (income: number) => Promise<void>;
  saveTheme: (theme: 'light' | 'dark') => Promise<void>;
  saveBudgetVisibility: (categoryId: string, visible: boolean) => Promise<void>;
  saveSettingToDb: (dbKey: string, value: boolean | string | number) => Promise<void>;
  onLinkPartner: (partnerEmail: string) => Promise<{ ok: boolean; message?: string }>;
  onUnlinkPartner: () => Promise<void>;
  onRefreshNotifications?: () => Promise<void>;
  onReloadTransactions?: (userId: string) => Promise<void>;
  /** Raise a transient toast (used for the Undo after filing a captured row). */
  onToast?: (toast: Toast) => void;
}

/**
 * The dashboard's "not capturing yet" line, dismissed for good.
 *
 * Device-local and not per-user: it is a nudge about this phone's Android
 * permissions, and re-raising it for the second person on a shared handset
 * would be nagging about something already done.
 */
const CAPTURE_NUDGE_KEY = 'covault_capture_nudge_dismissed_v1';

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
  // Set when the settings modal is opened with one section in mind, so the user
  // lands on it rather than at the top of a long modal.
  const [settingsTarget, setSettingsTarget] = useState<string | undefined>(undefined);
  // The "purchases aren't being captured yet" line, put away for good.
  const [captureNudgeDismissed, setCaptureNudgeDismissed] = useState(() => {
    try {
      return localStorage.getItem(CAPTURE_NUDGE_KEY) === '1';
    } catch {
      // Storage blocked: show it. A line the user can dismiss is a smaller
      // cost than a first user never finding capture at all.
      return false;
    }
  });

  // The reading model, kept on this phone rather than fetched mid-capture.
  // Held here rather than in the settings modal so the one download it needs
  // happens while the app is simply open, at a quiet moment on a connection
  // that is not metered — see useAIModelOnDevice.
  const aiModel = useAIModelOnDevice(true);
  const [isLinkingPartner, setIsLinkingPartner] = useState(false);
  const [partnerLinkEmail, setPartnerLinkEmail] = useState('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showTransactionForm, setShowTransactionForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [remoteVendorHistory, setRemoteVendorHistory] = useState<VendorHistoryItem[]>([]);
  const [expandedBudgets, setExpandedBudgets] = useState<Set<string>>(new Set());
  // Bumped each time Review is opened from a notification or the widget pill.
  // A counter rather than a boolean so two taps in a row both replay the
  // light — a flag already true is not a change and nothing would happen.
  const [reviewHighlightNonce, setReviewHighlightNonce] = useState(0);

  // Leaving Review puts the nonce back to "nobody sent me here". Without this
  // the counter stays raised for the rest of the session, and the next time
  // the user opens Review themselves the page would scroll and light up as
  // though a notification had sent them — an arrival they didn't make.
  const closeParsing = useCallback(() => {
    setShowParsing(false);
    setReviewHighlightNonce(0);
  }, []);

  // Single source of truth for "now": ticks over at local midnight and on
  // resume, so every month-scoped derivation below moves together.
  const todayIso = useCurrentDay();
  const monthKey = todayIso.slice(0, 7);

  // Which of the seven months on the chart's rail is on screen. `monthKey` is
  // always the month we are really in; `viewMonthKey` is the one being read.
  // Everything the user looks at follows the second; everything that leaves
  // this screen — the widget, the notifications — stays on the first.
  const {
    viewMonthKey,
    isCurrentMonth: isViewingCurrentMonth,
    relation: viewMonthRelation,
    selectMonth,
    resetToCurrentMonth,
  } = useMonthSelection(monthKey);

  /**
   * The home button, from either screen.
   *
   * It used to be `closeParsing` alone, which on the home screen sets two
   * pieces of state to the values they already hold — so React bailed out of
   * both and the button did nothing at all. Pressed with a budget open, with a
   * search half typed, or with a sheet up, it was dead.
   *
   * Home now means what it looks like it means: put the screen back to how it
   * looks when you arrive. The vial collapses on the same 320ms clock a tap on
   * its own header uses, so the gesture reads identically however it was
   * started.
   */
  const goHome = useCallback(() => {
    closeParsing();
    setExpandedBudgets(new Set());
    setSearchQuery('');
    setIsSearchOpen(false);
    setShowSettings(false);
    setSelectedTx(null);
    setShowTransactionForm(false);
    // Including the month being browsed: home is "put the screen back to how
    // it looks when you arrive", and it arrives on this month.
    resetToCurrentMonth();
  }, [closeParsing, resetToCurrentMonth]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // The widget hands over a budget by name, and the callback that receives it
  // is registered once. Reading budgets through a ref keeps that registration
  // stable — depending on `state.budgets` directly would tear down and
  // re-attach the native route listeners on every data load.
  const budgetsRef = useRef(state.budgets);
  useEffect(() => {
    budgetsRef.current = state.budgets;
  }, [state.budgets]);

  // A capture notification says "tap to review", so land the user there. Any
  // open modal is dismissed first, otherwise the Review page opens behind it
  // and the tap looks like it did nothing.
  useNotificationRoute(
    useCallback(() => {
      setShowSettings(false);
      setSelectedTx(null);
      setShowTransactionForm(false);
      setShowParsing(true);
      // Arriving here from outside means something specific is waiting. The
      // page alone doesn't say which rows those are once there is a mix of
      // filed and unfiled ones, so ask the list to run its light around them.
      setReviewHighlightNonce((n) => n + 1);
    }, []),
    // Tapping a category row on the home-screen widget lands on that budget,
    // open. Matched by name because that is all the widget has — it draws from
    // a snapshot of figures, not from budget rows, and has no ids in it.
    // Unknown names are ignored rather than opening something arbitrary: the
    // snapshot can outlive a renamed or deleted budget.
    useCallback((budgetName: string) => {
      setShowSettings(false);
      setSelectedTx(null);
      setShowTransactionForm(false);
      closeParsing();
      setExpandedBudgets((prev) => {
        const match = budgetsRef.current.find(
          (b) => b.name.trim().toLowerCase() === budgetName.trim().toLowerCase(),
        );
        return match ? new Set([match.id]) : prev;
      });
    }, [closeParsing]),
  );

  const normalizedTransactions = useNormalizedTransactions(state.transactions, state.budgets);

  // ── Vendor overrides (for the <VendorCategoryRulesCard> + <LearnedRulesCard>) ──
  const {
    vendorOverrides,
    partnerOverrides,
    handleDeleteVendorOverride,
    handleSetVendorCategory,
    handleSetProperName,
  } = useVendorOverrides({
    userId: state.user?.id,
    partnerId: state.user?.partnerId,
    budgets: state.budgets,
  });

  const {
    currentMonthTransactions,
    projectedTransactions,
    remainingMoney,
    effectiveIncome,
    isIncomeLoaded,
  } = useDashboardTotals(
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
    // The user's OWN rules, and deliberately nothing else. The native matcher
    // (android-custom/WidgetDeltaStore.java) carries its own auto-file
    // threshold and runs with the app closed — a borrowed rule pushed here
    // would file money with nobody watching, which is the one thing the shared
    // layers refuse to do. Borrowed rules become the user's own by being
    // accepted once in Review, and they arrive here on that same load.
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

  // ── The community pool: the two switches, mirrored where capture can see them ──
  //
  // The capture pipeline runs with the app closed and cannot read React state,
  // so both answers are mirrored to device storage whenever the settings row
  // loads or changes. A phone that has never seen the row falls back to the
  // safe defaults — receive, do not send.
  //
  // Turning contribution OFF withdraws everything already contributed, not just
  // future pairs. An opt-out that left the old contributions in the pool for
  // good would make the switch a lie.
  const contributedBefore = useRef<boolean | null>(null);
  useEffect(() => {
    const enabled = state.settings.community_rules_enabled !== false;
    const contribute = state.settings.community_rules_contribute === true;
    setCommunityFlags({ enabled, contribute });

    const was = contributedBefore.current;
    contributedBefore.current = contribute;
    if (was === true && !contribute) {
      void withdrawAllContributions(state.user?.id);
    }

    // Refresh the downloaded pack — at most daily, and never a per-purchase
    // lookup: a query at capture time would tell the server where this
    // household had just shopped, which is the one thing this layer must not
    // do. See lib/communityRules.ts.
    if (enabled) void refreshCommunityPack();
  }, [
    state.settings.community_rules_enabled,
    state.settings.community_rules_contribute,
    state.user?.id,
  ]);

  // ── Charges the listener should stay quiet about ──
  // A subscription is announced by the bank AND already on Covault's books, so
  // the capture notification tells the user about money they have accounted
  // for. The pipeline knows not to create a second row, but it only runs when
  // the app does — the notification is posted by the native listener the
  // instant the alert lands. Handing it the user's recurring charges is what
  // lets it decline to announce one.
  //
  // Read from the full transaction list rather than this month's: a monthly
  // template can sit in any month, and the point is to recognise the charge
  // whenever it arrives.
  //
  // Serialised into the effect's dependency so a write to native storage only
  // happens when the SET of subscriptions changes. The transaction list changes
  // on every capture and edit; the household's subscriptions change a few times
  // a year, and each push is a synchronous disk commit on the native side.
  const recurringChargesKey = useMemo(
    () =>
      JSON.stringify(
        collectRecurringCharges(
          state.transactions.map((tx) => ({
            vendor: tx.vendor,
            amount: tx.amount,
            date: tx.date,
            recur: (tx as any).recur ?? tx.recurrence ?? null,
            source: (tx as any).source ?? null,
          })),
        ),
      ),
    [state.transactions],
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void pushRecurringCharges(JSON.parse(recurringChargesKey));
  }, [recurringChargesKey]);

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

  // The chart draws three months forward as well as three back, so it takes
  // EVERY projected occurrence rather than only this month's — otherwise the
  // right-hand half of the rail is a flat line at zero for months that already
  // have known subscriptions in them. The projection stops three months out on
  // its own, which is exactly the width of the rail.
  const chartTransactions = useMemo(() => {
    const existingIds = new Set(normalizedTransactions.map((t) => t.id));
    const projectedAhead = projectedTransactions.filter(
      (t) => typeof t.date === 'string' && !existingIds.has(t.id),
    );

    return [...normalizedTransactions, ...projectedAhead];
  }, [normalizedTransactions, projectedTransactions]);

  // ── The month on screen ──
  //
  // The vials and the headline figure follow the rail; everything that leaves
  // this screen does not. The widget effect above and the overrun
  // notifications below deliberately keep reading `currentMonthTransactions`
  // and `remainingMoney`: a home-screen widget showing March because the phone
  // was left on March, or a "you are over budget" notification about a month
  // that ended, would both be wrong in a way the user could not see from here.
  const viewMonthBudgetTransactions = useMemo(() => {
    if (isViewingCurrentMonth) return currentMonthBudgetTransactions;
    const inViewMonth = (t: Transaction) => isInMonth(t, viewMonthKey);
    return [
      ...normalizedTransactions.filter(inViewMonth),
      ...projectedTransactions.filter(inViewMonth),
    ];
  }, [
    isViewingCurrentMonth,
    currentMonthBudgetTransactions,
    normalizedTransactions,
    projectedTransactions,
    viewMonthKey,
  ]);

  // ── The Discretionary Shield ──
  //
  // How much of the month's overspending the Leisure vault is absorbing. Read
  // off the SAME list the vials are drawing, so browsing back to March shields
  // March's overspend and not this month's, and so the amount taken out of
  // Leisure is always the amount another vial on screen is over by.
  //
  // Display-only, and deliberately not folded into `viewMonthRemaining`: the
  // headline balance already counts every transaction once, whatever category
  // it landed in, so adding the shielded amount there would count the same
  // overspend twice. This used to be a literal `0`, which is why switching the
  // shield on did nothing at all.
  //
  // The contributors come back on the same pass as the figure, so the sentence
  // the open Leisure card shows and the chunk taken out of its bar cannot
  // disagree.
  const leisureShield = useMemo(() => {
    if (!state.settings.useLeisureAsBuffer) return NO_SHIELD;
    return computeShieldBreakdown(state.budgets, viewMonthBudgetTransactions, {
      hiddenCategories: state.settings.hiddenCategories,
    });
  }, [
    state.settings.useLeisureAsBuffer,
    state.settings.hiddenCategories,
    state.budgets,
    viewMonthBudgetTransactions,
  ]);

  // Same arithmetic as the current month's, over the same list the vials are
  // drawing, so the figure at the top can never disagree with the bars below.
  const viewMonthRemaining = useMemo(
    () => (isViewingCurrentMonth
      ? remainingMoney
      : remainingForMonth(viewMonthBudgetTransactions, effectiveIncome)),
    [isViewingCurrentMonth, remainingMoney, viewMonthBudgetTransactions, effectiveIncome],
  );

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

  // Badge count: captures still waiting in Review.
  //
  // Read through the shared selector (lib/reviewQueue.ts) rather than filtered
  // here. This used to do its own `label === 'Automatic' && !caught_cleared`,
  // which keeps refunds — so a captured refund made this badge say 3 while the
  // Review page's own badge, its list, and the widget pill all said 2. That
  // disagreement is the whole reason the selector exists; the home screen was
  // the one caller still not using it.
  //
  // Still derived from app state, so it drops as soon as a row is deleted
  // (optimistic removal) or cleared (reload).
  const aiTransactionsCount = useMemo(
    () => countAwaitingReview(state.transactions),
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
    setExpandedBudgets(prev => (prev.has(id) ? new Set() : new Set([id])));
  }, []);

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
          reviewHighlightNonce={reviewHighlightNonce}
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
          onBack={closeParsing}
          onGoHome={goHome}
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
          partnerOverrides={partnerOverrides}
          partnerName={state.user?.partnerName}
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
          remainingMoney={viewMonthRemaining}
          balanceLabel={balanceLabelForMonth(
            viewMonthKey,
            monthKey,
            !state.user?.budgetingSolo,
          )}
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

        {/* Capture is the reason to use this app, and it starts off. A user
            who skipped it in the intro, or who was already here before the
            intro asked, had nothing anywhere telling them it existed — the
            setup lives inside a settings modal nobody had a reason to open.
            One line, dismissable for good, gone the moment capture is on. */}
        {!state.settings.notificationsEnabled && !captureNudgeDismissed && !searchQuery.trim() && (
          <div className="mx-4 lg:mx-6 mb-2 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/40">
            <button
              type="button"
              onClick={() => {
                setSettingsTarget('settings-notifications-container');
                setShowSettings(true);
              }}
              className="flex-1 text-left text-[11px] font-bold text-emerald-700 dark:text-emerald-300 tracking-wide"
            >
              Purchases aren't being captured yet — set it up
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                setCaptureNudgeDismissed(true);
                try {
                  localStorage.setItem(CAPTURE_NUDGE_KEY, '1');
                } catch {
                  /* Dismissed for this session at least. */
                }
              }}
              className="shrink-0 p-1 text-emerald-600/50 dark:text-emerald-400/50 active:scale-[0.97] transition-all duration-200"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

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
                  currentMonthKey={monthKey}
                  selectedMonthKey={viewMonthKey}
                  onSelectMonth={selectMonth}
                />
                </React.Suspense>
              </PremiumGate>
            </div>

            {/* Which month these vials are, when it is not this one. In the
                flow rather than floating over the list: it is the one thing on
                screen that says the numbers below belong to another month, so
                it must not be something a thumb can scroll past. */}
            {!isViewingCurrentMonth && (
              <MonthViewBanner
                monthKey={viewMonthKey}
                relation={viewMonthRelation}
                onReturnToCurrentMonth={resetToCurrentMonth}
              />
            )}

            {/* Budget bars: vertical list on mobile, 2-col grid on desktop */}
            <DashboardBudgetSectionsList
              budgets={state.budgets}
              transactions={viewMonthBudgetTransactions}
              isCurrentMonth={isViewingCurrentMonth}
              expandedBudgets={expandedBudgets}
              isFocusMode={false}
              focusedBudgetId={null}
              leisureShield={leisureShield}
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
          onGoHome={goHome}
          onAddTransaction={() => setShowTransactionForm(true)}
          onOpenParsing={() => setShowParsing(true)}
          activeView="home"
          pendingCount={aiTransactionsCount}
        />

      </PageShell>

      {showSettings && (
        <DashboardSettingsModal
          aiModel={aiModel}
          isSharedAccount={!state.user?.budgetingSolo}
          settings={state.settings}
          user={state.user}
          isLinkingPartner={isLinkingPartner}
          partnerLinkEmail={partnerLinkEmail}
          budgets={state.budgets}
          transactions={normalizedTransactions}
          onChangePartnerLinkEmail={setPartnerLinkEmail}
          onClose={() => {
            setShowSettings(false);
            setSettingsTarget(undefined);
          }}
          scrollToSectionId={settingsTarget}
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
    </>
  );
};

export default Dashboard;
