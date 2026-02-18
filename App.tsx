import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

const canUseStorage =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const loadSettingsFromStorage = () => {
  if (!canUseStorage) return null;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    console.error('Error loading settings:', e);
    return null;
  }
};

const saveSettingsToStorage = (settings: AppState['settings']) => {
  if (!canUseStorage) return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Error saving settings:', e);
  }
};

/**
 * Detect whether we're running in a native wrapper (Capacitor/Cordova).
 * This keeps native-only plugins/hooks from running on web and causing a blank screen.
 */
const isNativePlatform = () => {
  if (typeof window === 'undefined') return false;
  const w = window as any;

  // Capacitor: window.Capacitor.isNativePlatform() exists at runtime in native builds
  const capacitorNative =
    typeof w.Capacitor?.isNativePlatform === 'function'
      ? !!w.Capacitor.isNativePlatform()
      : false;

  // Cordova presence
  const cordovaNative = !!w.cordova;

  return capacitorNative || cordovaNative;
};

/**
 * Error boundary to prevent "white screen of death" on runtime exceptions.
 * Shows a minimal fallback with the error message.
 */
class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('[AppErrorBoundary] Uncaught error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
        <p style={{ marginTop: 0 }}>
          The app hit a runtime error instead of rendering. Check the console for details.
        </p>
        <pre
          style={{
            background: '#111',
            color: '#eee',
            padding: 12,
            borderRadius: 8,
            overflow: 'auto',
            maxWidth: '100%',
          }}
        >
          {this.state.error?.message ?? 'Unknown error'}
        </pre>

        {canUseStorage && (
          <button
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #ccc',
              cursor: 'pointer',
            }}
            onClick={() => {
              try {
                localStorage.removeItem(SETTINGS_KEY);
                window.location.reload();
              } catch {
                // ignore
              }
            }}
          >
            Reset local settings & reload
          </button>
        )}
      </div>
    );
  }
}

/**
 * Native-only hooks isolated into their own component so we can safely
 * NOT render it on web (no conditional hook calls).
 */
const NativeHooks: React.FC<{
  user: AppState['user'];
  budgets: AppState['budgets'];
  onTransactionDetected: (tx: any) => any;
  onPendingTransactionCreated: (pending: PendingTransaction) => void;
  onAutoAcceptedTransaction: (tx: Transaction) => void;
}> = ({ user, budgets, onTransactionDetected, onPendingTransactionCreated, onAutoAcceptedTransaction }) => {
  // Native deep link handling (OAuth callback)
  useDeepLinks();

  // Native notification → auto transaction listener
  useNotificationListener({
    user,
    budgets,
    onTransactionDetected,
    onPendingTransactionCreated,
    onAutoAcceptedTransaction,
  });

  return null;
};

const AppInner: React.FC = () => {
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

  const loadUserDataWithState = useCallback(
    async (userId: string) => {
      setIsLoadingData(true);
      try {
        await loadUserData(userId);
      } catch (error) {
        console.error('[loadUserDataWithState] Error loading user data:', error);
      } finally {
        setIsLoadingData(false);
      }
    },
    [loadUserData],
  );

  // Auth + session handling
  useAuthState({ setAppState, setAuthState, loadUserData: loadUserDataWithState });

  // Stable callbacks for the native notification listener
  const handlePendingTransactionCreated = useCallback(
    (pending: PendingTransaction) => {
      setAppState(prev => {
        const existing = prev.pendingTransactions || [];
        if (existing.some(p => p.id === pending.id)) return prev;
        return { ...prev, pendingTransactions: [pending, ...existing] };
      });
    },
    [setAppState],
  );

  const handleAutoAcceptedTransaction = useCallback(
    (tx: Transaction) => {
      setAppState(prev => {
        if (prev.transactions.some(t => t.id === tx.id)) return prev;
        return { ...prev, transactions: [tx, ...prev.transactions] };
      });
    },
    [setAppState],
  );

  // Refresh notifications: re-detect banking apps then scan currently visible notifications
  const refreshNotifications = useCallback(async () => {
    try {
      await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
      if (covaultNotification?.scanActiveNotifications) {
        await covaultNotification.scanActiveNotifications();
      }
    } catch (e) {
      console.error('[refreshNotifications] Failed:', e);
    }
  }, []);

  // Auto-detect banking apps when notifications are enabled (native-only feature)
  useEffect(() => {
    if (!appState.settings.notificationsEnabled) return;

    // Wrap in try/catch so a missing native plugin can't blank the app
    (async () => {
      try {
        await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
      } catch (e) {
        console.error('[autoDetectAndSaveMonitoredApps] Failed:', e);
      }
    })();
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
      user: prev.user ? { ...prev.user, budgetingSolo: isSolo, partnerEmail } : null,
    }));
    setAuthState('authenticated');
  };

  const handleUpdateBudget = (updatedBudget: BudgetCategory) => {
    setAppState(prev => ({
      ...prev,
      budgets: prev.budgets.map(b => (b.id === updatedBudget.id ? updatedBudget : b)),
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

  const [devState, setDevState] = useState<AppState>(() =>
    buildDevState({ solo: true, notificationsEnabled: true }),
  );

  useEffect(() => {
    if (devModeActive) {
      setDevState(buildDevState({ solo: devSolo, notificationsEnabled: devNotifications }));
    }
  }, [devModeActive, devSolo, devNotifications]);

  const devNoop = useCallback(() => {}, []);
  const devNoopAsync = useCallback(async () => {}, []);
  const devNoopString = useCallback(async () => null as string | null, []);

  // --- Platform toggle (computed once) -----------------------------------
  const native = useMemo(() => isNativePlatform(), []);

  // --- Render -------------------------------------------------------------

  // If an error was captured from data layer, show it (prevents "blank")
  if (dbError) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Database / Data Error</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{dbError}</pre>
      </div>
    );
  }

  // While auth loads (and not in dev mode), show loader
  if (authState === 'loading' && !devModeActive) {
    return <FullScreenLoader />;
  }

  // Developer mode: render fake screens with overlay
  if (devModeActive) {
    return (
      <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
        {devScreen === 'auth' && <Auth onSignIn={devNoop} />}

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
          onToggleSolo={() => setDevSolo(p => !p)}
          onToggleNotifications={() => setDevNotifications(p => !p)}
          onExit={devModeToggle}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
      {/* Native-only hooks rendered ONLY on native platforms */}
      {native && (
        <NativeHooks
          user={appState.user}
          budgets={appState.budgets}
          onTransactionDetected={handleAddTransaction}
          onPendingTransactionCreated={handlePendingTransactionCreated}
          onAutoAcceptedTransaction={handleAutoAcceptedTransaction}
        />
      )}

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

const App: React.FC = () => {
  return (
    <AppErrorBoundary>
      <AppInner />
    </AppErrorBoundary>
  );
};

export default App;
