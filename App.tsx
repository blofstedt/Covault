import React, { useCallback, useEffect, useRef, useState } from 'react';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import Onboarding from './components/Onboarding';
import FullScreenLoader from './components/FullScreenLoader';
import type { AppState, BudgetCategory, Transaction, PendingTransaction } from './types';
import { supabase } from './lib/supabase';
import { useAuthState, AuthStatus } from './lib/useAuthState';
import { useDeepLinks } from './lib/useDeepLinks';
import { useNotificationListener } from './lib/useNotificationListener';
import { covaultNotification, autoDetectAndSaveMonitoredApps } from './lib/covaultNotification';
import { KNOWN_BANKING_APPS } from './lib/bankingApps';
import { useAppTheme } from './lib/useAppTheme';
import { useUserData } from './lib/useUserData';

const SETTINGS_KEY = 'covault_settings';

/** Delay (ms) after scanning to allow notification processing before reloading data */
const SCAN_PROCESSING_DELAY_MS = 2000;

/** Interval (ms) between periodic notification scans while enabled */
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SCAN_INTERVAL_S = SCAN_INTERVAL_MS / 1000;

const DEFAULT_SETTINGS = {
  rolloverEnabled: true,
  rolloverOverspend: false,
  useLeisureAsBuffer: true,
  showSavingsInsight: true,
  theme: 'light' as const,
  notificationsEnabled: false,
  app_notifications_enabled: false,
  hiddenCategories: [] as string[],
};

// Load settings from localStorage
const loadSettingsFromStorage = () => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error loading settings:', e);
  }
  return null;
};

// Save settings to localStorage
const saveSettingsToStorage = (settings: AppState['settings']) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving settings:', e);
  }
};

const App: React.FC = () => {
  const [authState, setAuthState] = useState<AuthStatus>('loading');
  const [dbError, setDbError] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [appState, setAppState] = useState<AppState>(() => {
    const savedSettings = loadSettingsFromStorage();
    return {
      user: null,
      budgets: [],
      transactions: [],
      settings: { ...DEFAULT_SETTINGS, ...savedSettings },
    };
  });

  const {
    loadUserData,
    loadPendingTransactions,
    loadTransactions,
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleLinkPartner,
    handleUnlinkPartner,
    handleGenerateLinkCode,
    handleJoinWithCode,
    handleApprovePendingTransaction,
    handleRejectPendingTransaction,
    handleClearFilteredNotifications,
    handleClearApprovedTransactions,
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
  } = useUserData({ appState, setAppState, setDbError });

  // Wrapped loadUserData that tracks loading state
  const loadUserDataWithState = useCallback(async (userId: string) => {
    setIsLoadingData(true);
    try {
      await loadUserData(userId);
    } catch (error) {
      console.error('[loadUserDataWithState] Error loading user data:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, [loadUserData]);

  // Auth + session handling
  useAuthState({ setAppState, setAuthState, loadUserData: loadUserDataWithState });

  // Native deep link handling (OAuth callback)
  useDeepLinks();

  // Stable callbacks for the native notification listener
  const handlePendingTransactionCreated = useCallback((pending: PendingTransaction) => {
    setAppState(prev => {
      const existing = prev.pendingTransactions || [];
      if (existing.some(p => p.id === pending.id)) return prev;
      return { ...prev, pendingTransactions: [pending, ...existing] };
    });
  }, [setAppState]);

  const handleAutoAcceptedTransaction = useCallback((tx: Transaction) => {
    setAppState(prev => {
      if (prev.transactions.some(t => t.id === tx.id)) return prev;
      return { ...prev, transactions: [tx, ...prev.transactions] };
    });
  }, [setAppState]);

  // Handle AI processing result: reload transactions so newly inserted
  // AI-labelled transactions appear in the UI immediately.
  // Handle AI processing result: the transaction was already added to state
  // via onAutoAcceptedTransaction, so we only reload on the next explicit
  // refresh to avoid a race between the optimistic state update and a DB
  // round-trip that could momentarily double or lose the entry.
  const handleAIProcessingResult = useCallback(async () => {
    if (appState.user?.id) {
      await loadTransactions(appState.user.id);
    }
  }, [appState.user?.id, loadTransactions]);
    // No-op: rely on handleAutoAcceptedTransaction for immediate state update
    // and on explicit refresh / visibility-change reload for DB sync.
  }, []);

  // Native notification → auto transaction listener
  useNotificationListener({
    user: appState.user,
    budgets: appState.budgets,
    onTransactionDetected: handleAddTransaction,
    onPendingTransactionCreated: handlePendingTransactionCreated,
    onAutoAcceptedTransaction: handleAutoAcceptedTransaction,
    onAIProcessingResult: handleAIProcessingResult,
  });

  // ── Countdown state for periodic notification scanning ──
  const [secondsUntilNextScan, setSecondsUntilNextScan] = useState<number | null>(null);

  // Refresh notifications: re-detect banking apps then scan currently
  // visible Android notifications so newly installed apps are picked up.
  const refreshNotifications = useCallback(async () => {
    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
    if (covaultNotification) {
      await covaultNotification.scanActiveNotifications();
    }
    // Reset countdown after manual refresh
    setSecondsUntilNextScan(SCAN_INTERVAL_S);
  }, []);

  // Auto-detect installed banking apps on startup so the notification
  // listener can monitor them immediately (even before the user opens
  // notification settings or any banking notification arrives).
  // Runs unconditionally so that banking apps are discovered as soon as
  // the user opens the app — not only after notifications are enabled.
  useEffect(() => {
    autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
  }, []);

  // ── Scan immediately when notifications are enabled ──
  // Track the previous value of notificationsEnabled so we detect the
  // transition from false → true.  On that transition, auto-detect
  // banking apps and scan active notifications in the notification shade.
  const prevNotificationsEnabled = useRef(appState.settings.notificationsEnabled);
  useEffect(() => {
    const wasEnabled = prevNotificationsEnabled.current;
    const isEnabled = appState.settings.notificationsEnabled;
    prevNotificationsEnabled.current = isEnabled;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (!wasEnabled && isEnabled) {
      // Notifications were just enabled — scan immediately
      const userId = appState.user?.id;
      (async () => {
        await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
        if (covaultNotification) {
          await covaultNotification.scanActiveNotifications();
        }
        // Reload transactions after a short delay to pick up processed results
        if (userId) {
          timeoutId = setTimeout(() => loadTransactions(userId), SCAN_PROCESSING_DELAY_MS);
        }
      })();
    }

    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [appState.settings.notificationsEnabled, appState.user?.id, loadTransactions]);

  // ── Periodic banking app detection & notification scanning while enabled ──
  // Every 5 minutes, re-detect installed banking apps (so newly installed
  // apps are picked up without waiting for a notification) and then
  // re-scan active notifications in the notification shade.
  useEffect(() => {
    if (!appState.settings.notificationsEnabled || !covaultNotification) {
      setSecondsUntilNextScan(null);
      return;
    }

    // Reset countdown when interval starts
    setSecondsUntilNextScan(SCAN_INTERVAL_S);

    const intervalId = setInterval(async () => {
      try {
        await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
        await covaultNotification.scanActiveNotifications();
      } catch (e) {
        console.warn('[periodic scan] Error during periodic bank app detection/scan:', e);
      }
      // Reset countdown after each scan
      setSecondsUntilNextScan(SCAN_INTERVAL_S);
    }, SCAN_INTERVAL_MS);

    // Tick down every second
    const tickId = setInterval(() => {
      setSecondsUntilNextScan(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);

    return () => {
      clearInterval(intervalId);
      clearInterval(tickId);
    };
  }, [appState.settings.notificationsEnabled]);

  // Theme handling
  useAppTheme(appState.settings.theme);

  // Persist settings whenever they change
  useEffect(() => {
    saveSettingsToStorage(appState.settings);
  }, [appState.settings]);

  const handleOnboardingComplete = (
    isSolo: boolean,
    budgets: BudgetCategory[],
    partnerEmail?: string,
  ) => {
    setAppState(prev => ({
      ...prev,
      budgets,
      user: prev.user
        ? { ...prev.user, budgetingSolo: isSolo, partnerEmail }
        : null,
    }));
    setAuthState('authenticated');
  };

  const handleUpdateBudget = (updatedBudget: BudgetCategory) => {
    setAppState(prev => ({
      ...prev,
      budgets: prev.budgets.map(b =>
        b.id === updatedBudget.id ? updatedBudget : b,
      ),
    }));
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  // --- Render -------------------------------------------------------------

  if (authState === 'loading') {
    return <FullScreenLoader />;
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
      {authState === 'unauthenticated' && (
        <Auth onSignIn={() => setAuthState('authenticated')} />
      )}

      {authState === 'onboarding' && (
        <Onboarding onComplete={handleOnboardingComplete} />
      )}

      {authState === 'authenticated' && (
        <Dashboard
          state={appState}
          setState={setAppState}
          onSignOut={handleSignOut}
          onUpdateBudget={handleUpdateBudget}
          onAddTransaction={handleAddTransaction}
          onUpdateTransaction={handleUpdateTransaction}
          onDeleteTransaction={handleDeleteTransaction}
          saveBudgetLimit={saveBudgetLimit}
          saveUserIncome={saveUserIncome}
          saveTheme={saveTheme}
          saveBudgetVisibility={saveBudgetVisibility}
          onLinkPartner={handleLinkPartner}
          onUnlinkPartner={handleUnlinkPartner}
          onGenerateLinkCode={handleGenerateLinkCode}
          onJoinWithCode={handleJoinWithCode}
          onApprovePendingTransaction={handleApprovePendingTransaction}
          onRejectPendingTransaction={handleRejectPendingTransaction}
          onClearFilteredNotifications={handleClearFilteredNotifications}
          onClearApprovedTransactions={handleClearApprovedTransactions}
          onRefreshNotifications={refreshNotifications}
          onReloadPendingTransactions={loadPendingTransactions}
          onReloadTransactions={loadTransactions}
          isLoadingData={isLoadingData}
          secondsUntilNextScan={secondsUntilNextScan}
        />
      )}
    </div>
  );
};

export default App;
