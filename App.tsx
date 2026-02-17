import React, { useCallback, useEffect, useRef, useState } from 'react';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import Onboarding from './components/Onboarding';
import FullScreenLoader from './components/FullScreenLoader';
import DeveloperModeOverlay from './components/DeveloperModeOverlay';
import type { AppState, BudgetCategory, Transaction, PendingTransaction } from './types';
import { supabase } from './lib/supabase';
import { useAuthState, AuthStatus } from './lib/useAuthState';
import { useDeepLinks } from './lib/useDeepLinks';
import { useNotificationListener } from './lib/useNotificationListener';
import { covaultNotification, autoDetectAndSaveMonitoredApps } from './lib/covaultNotification';
import { KNOWN_BANKING_APPS } from './lib/bankingApps';
import { useAppTheme } from './lib/useAppTheme';
import { useUserData } from './lib/useUserData';
import { useDeveloperMode } from './lib/useDeveloperMode';
import { buildDevState } from './lib/developerData';

const SETTINGS_KEY = 'covault_settings';

/** Delay (ms) after scanning to allow notification processing before reloading data */
const SCAN_PROCESSING_DELAY_MS = 2000;

/** Interval (ms) between periodic notification scans while enabled */
const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const DEFAULT_SETTINGS = {
  rolloverEnabled: true,
  rolloverOverspend: false,
  useLeisureAsBuffer: true,
  showSavingsInsight: true,
  theme: 'light' as const,
  hasSeenTutorial: false,
  notificationsEnabled: false,
  app_notifications_enabled: false,
  hiddenCategories: [] as string[],
  notification_rules: [] as import('./types').NotificationRule[],
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
  const handleAIProcessingResult = useCallback(async () => {
    if (appState.user?.id) {
      await loadTransactions(appState.user.id);
    }
  }, [appState.user?.id, loadTransactions]);

  // Native notification → auto transaction listener
  useNotificationListener({
    user: appState.user,
    budgets: appState.budgets,
    onTransactionDetected: handleAddTransaction,
    onPendingTransactionCreated: handlePendingTransactionCreated,
    onAutoAcceptedTransaction: handleAutoAcceptedTransaction,
    onAIProcessingResult: handleAIProcessingResult,
  });

  // Refresh notifications: re-detect banking apps then scan currently
  // visible Android notifications so newly installed apps are picked up.
  const refreshNotifications = useCallback(async () => {
    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
    if (covaultNotification) {
      await covaultNotification.scanActiveNotifications();
    }
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

  // ── Periodic notification scanning while enabled ──
  // Re-scan active notifications every 5 minutes so the app picks up
  // banking notifications that arrive while the app is in the foreground
  // without waiting for the user to tap refresh.
  useEffect(() => {
    if (!appState.settings.notificationsEnabled || !covaultNotification) return;

    const intervalId = setInterval(async () => {
      try {
        await covaultNotification.scanActiveNotifications();
      } catch (e) {
        console.warn('[periodic scan] Error scanning active notifications:', e);
      }
    }, SCAN_INTERVAL_MS);

    return () => clearInterval(intervalId);
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

  // --- Developer Mode ----------------------------------------------------

  const [devModeActive, devModeToggle] = useDeveloperMode();
  type DevScreen = 'auth' | 'onboarding' | 'dashboard' | 'parsing';
  const [devScreen, setDevScreen] = useState<DevScreen>('dashboard');
  const [devSolo, setDevSolo] = useState(true);
  const [devNotifications, setDevNotifications] = useState(true);

  // Rebuild fake state whenever dev toggles change
  const [devState, setDevState] = useState<AppState>(() =>
    buildDevState({ solo: true, notificationsEnabled: true }),
  );

  useEffect(() => {
    if (devModeActive) {
      setDevState(buildDevState({ solo: devSolo, notificationsEnabled: devNotifications }));
    }
  }, [devModeActive, devSolo, devNotifications]);

  // No-op handlers for developer mode (all data is fake)
  const devNoop = useCallback(() => {}, []);
  const devNoopAsync = useCallback(async () => {}, []);
  const devNoopString = useCallback(async () => null as string | null, []);

  // --- Render -------------------------------------------------------------

  if (authState === 'loading' && !devModeActive) {
    return <FullScreenLoader />;
  }

  // Developer mode: render fake screens with overlay
  if (devModeActive) {
    return (
      <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
        {devScreen === 'auth' && (
          <Auth onSignIn={devNoop} />
        )}

        {devScreen === 'onboarding' && (
          <Onboarding onComplete={() => setDevScreen('dashboard')} />
        )}

        {(devScreen === 'dashboard' || devScreen === 'parsing') && (
          <Dashboard
            key={devScreen}
            state={{
              ...devState,
              settings: {
                ...devState.settings,
                notificationsEnabled: devNotifications,
              },
            }}
            setState={setDevState}
            onSignOut={devNoop}
            onUpdateBudget={devNoop as any}
            onAddTransaction={devNoop as any}
            onUpdateTransaction={devNoop as any}
            onDeleteTransaction={devNoop}
            saveBudgetLimit={devNoop as any}
            saveUserIncome={devNoop as any}
            saveTheme={devNoop as any}
            saveBudgetVisibility={devNoop as any}
            onLinkPartner={devNoop as any}
            onUnlinkPartner={devNoop}
            onGenerateLinkCode={devNoopString}
            onJoinWithCode={devNoop as any}
            onApprovePendingTransaction={devNoop as any}
            onRejectPendingTransaction={devNoop}
            onClearFilteredNotifications={devNoopAsync as any}
            onClearApprovedTransactions={devNoopAsync as any}
            onRefreshNotifications={devNoopAsync}
            onReloadPendingTransactions={devNoopAsync as any}
            onReloadTransactions={devNoopAsync as any}
            isLoadingData={false}
            initialShowParsing={devScreen === 'parsing'}
          />
        )}

        <DeveloperModeOverlay
          currentScreen={devScreen}
          isSolo={devSolo}
          notificationsEnabled={devNotifications}
          onNavigate={setDevScreen}
          onToggleSolo={() => setDevSolo((p) => !p)}
          onToggleNotifications={() => setDevNotifications((p) => !p)}
          onExit={devModeToggle}
        />
      </div>
    );
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
        />
      )}
    </div>
  );
};

export default App;
