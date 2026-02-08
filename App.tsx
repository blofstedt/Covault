import React, { useCallback, useEffect, useState } from 'react';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import Onboarding from './components/Onboarding';
import FullScreenLoader from './components/FullScreenLoader';
import DevModeToolbar from './components/DevModeToolbar';
import type { AppState, BudgetCategory, Transaction } from './types';
import { supabase } from './lib/supabase';
import { useAuthState, AuthStatus } from './lib/useAuthState';
import { useDeepLinks } from './lib/useDeepLinks';
import { useNotificationListener } from './lib/useNotificationListener';
import { useAppTheme } from './lib/useAppTheme';
import { useUserData } from './lib/useUserData';
import {
  DevModeContext,
  DevModeContextValue,
  createDevAppState,
} from './lib/devMode';

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

  // ─── Dev mode state ──────────────────────────────────────────────────────
  const [isDevMode, setIsDevMode] = useState(false);
  const [dbPingLog, setDbPingLog] = useState<string[]>([]);
  const [devShowOnboarding, setDevShowOnboarding] = useState(false);
  const [devShowSettings, setDevShowSettings] = useState(false);
  const [devShowTutorial, setDevShowTutorial] = useState(false);
  const [devShowAddTx, setDevShowAddTx] = useState(false);

  const addPingLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setDbPingLog((prev) => [...prev, `[${ts}] ${msg}`]);
  }, []);

  const clearPingLog = useCallback(() => setDbPingLog([]), []);

  const devCtx: DevModeContextValue = {
    isDevMode,
    dbPingLog,
    addPingLog,
    clearPingLog,
  };

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
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleLinkPartner,
    handleUnlinkPartner,
    handleGenerateLinkCode,
    handleJoinWithCode,
    handleApprovePendingTransaction,
    handleRejectPendingTransaction,
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
      // Error is already logged by loadUserData functions
      console.error('[loadUserDataWithState] Error loading user data:', error);
    } finally {
      setIsLoadingData(false);
    }
  }, [loadUserData]);

  // Auth + session handling
  useAuthState({ setAppState, setAuthState, loadUserData: loadUserDataWithState });

  // Native deep link handling (OAuth callback)
  useDeepLinks();

  // Native notification → auto transaction listener
  useNotificationListener({
    user: appState.user,
    onTransactionDetected: handleAddTransaction,
    onPendingTransactionCreated: (pending) => {
      setAppState(prev => ({
        ...prev,
        pendingTransactions: [pending, ...(prev.pendingTransactions || [])],
      }));
    },
    onAutoAcceptedTransaction: (tx) => {
      // Only update local UI state — the transaction is already in the DB
      setAppState(prev => ({
        ...prev,
        transactions: [tx, ...prev.transactions],
      }));
    },
  });

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

  // ─── Dev mode helpers ────────────────────────────────────────────────────
  const enterDevMode = () => {
    const state = createDevAppState(true);
    setAppState(state);
    setIsDevMode(true);
    setAuthState('authenticated');
    addPingLog('DEV MODE ACTIVATED — DB writes are intercepted');
  };

  const exitDevMode = () => {
    setIsDevMode(false);
    setDevShowOnboarding(false);
    setDevShowSettings(false);
    setDevShowTutorial(false);
    setDevShowAddTx(false);
    setDbPingLog([]);
    setAppState({
      user: null,
      budgets: [],
      transactions: [],
      settings: { ...DEFAULT_SETTINGS },
    });
    setAuthState('unauthenticated');
  };

  const devToggleRole = () => {
    const isSolo = appState.user?.budgetingSolo ?? true;
    const newState = createDevAppState(!isSolo);
    setAppState(newState);
    addPingLog(`Switched to ${!isSolo ? 'SINGLE' : 'COUPLE'} mode`);
  };

  // Dev mode mock handlers that intercept DB writes but allow local state updates
  const devAddTransaction = (tx: Transaction) => {
    addPingLog(`DB WRITE intercepted: INSERT transaction "${tx.vendor}" $${tx.amount}`);
    setAppState((prev) => ({
      ...prev,
      transactions: [tx, ...prev.transactions],
    }));
  };

  const devUpdateTransaction = (tx: Transaction) => {
    addPingLog(`DB WRITE intercepted: UPDATE transaction "${tx.vendor}" id=${tx.id}`);
    setAppState((prev) => ({
      ...prev,
      transactions: prev.transactions.map((t) => (t.id === tx.id ? tx : t)),
    }));
  };

  const devDeleteTransaction = (id: string) => {
    addPingLog(`DB WRITE intercepted: DELETE transaction id=${id}`);
    setAppState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((t) => t.id !== id),
    }));
  };

  const devSaveBudgetLimit = (categoryId: string, newLimit: number) => {
    addPingLog(`DB WRITE intercepted: UPDATE budget limit category=${categoryId} limit=${newLimit}`);
    setAppState((prev) => ({
      ...prev,
      budgets: prev.budgets.map((b) => (b.id === categoryId ? { ...b, totalLimit: newLimit } : b)),
    }));
  };

  const devSaveUserIncome = (income: number) => {
    addPingLog(`DB WRITE intercepted: UPDATE monthly_income=${income}`);
    setAppState((prev) => ({
      ...prev,
      user: prev.user ? { ...prev.user, monthlyIncome: income } : null,
    }));
  };

  const devSaveTheme = (theme: 'light' | 'dark') => {
    addPingLog(`DB WRITE intercepted: UPDATE theme=${theme}`);
    setAppState((prev) => ({
      ...prev,
      settings: { ...prev.settings, theme },
    }));
  };

  const devSaveBudgetVisibility = (categoryId: string, visible: boolean) => {
    addPingLog(`DB WRITE intercepted: UPDATE visibility category=${categoryId} visible=${visible}`);
    const currentHidden: string[] = appState.settings.hiddenCategories || [];
    const nextHidden = visible
      ? currentHidden.filter((id: string) => id !== categoryId)
      : [...currentHidden, categoryId];
    setAppState((prev) => ({
      ...prev,
      settings: { ...prev.settings, hiddenCategories: nextHidden },
    }));
  };

  const devSignOut = () => {
    addPingLog('SIGN OUT intercepted — returning to auth screen');
    exitDevMode();
  };

  const devLinkPartner = async (_email: string) => {
    addPingLog(`DB WRITE intercepted: LINK partner email=${_email}`);
  };

  const devUnlinkPartner = async () => {
    addPingLog('DB WRITE intercepted: UNLINK partner');
    setAppState((prev) => ({
      ...prev,
      user: prev.user
        ? { ...prev.user, budgetingSolo: true, partnerId: undefined, partnerEmail: undefined, partnerName: undefined }
        : null,
    }));
  };

  const devGenerateLinkCode = async (): Promise<string | null> => {
    const code = 'DEV123';
    addPingLog(`DB WRITE intercepted: GENERATE link code → ${code}`);
    return code;
  };

  const devJoinWithCode = async (code: string) => {
    addPingLog(`DB WRITE intercepted: JOIN with code ${code}`);
  };

  const devApprovePending = async (pendingId: string, categoryId: string) => {
    addPingLog(`DB WRITE intercepted: APPROVE pending ${pendingId} → category ${categoryId}`);
  };

  const devRejectPending = async (pendingId: string) => {
    addPingLog(`DB WRITE intercepted: REJECT pending ${pendingId}`);
  };

  // --- Render -------------------------------------------------------------

  if (authState === 'loading') {
    return <FullScreenLoader />;
  }

  // Dev mode: show onboarding overlay
  if (isDevMode && devShowOnboarding) {
    return (
      <DevModeContext.Provider value={devCtx}>
        <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
          <Onboarding onComplete={(isSolo, budgets, partnerEmail) => {
            addPingLog(`Onboarding complete: solo=${isSolo} budgets=${budgets.length} partner=${partnerEmail || 'none'}`);
            setDevShowOnboarding(false);
          }} />
          <DevModeToolbar
            isSolo={appState.user?.budgetingSolo ?? true}
            onToggleRole={devToggleRole}
            onGoToDashboard={() => { setDevShowOnboarding(false); setDevShowSettings(false); setDevShowTutorial(false); setDevShowAddTx(false); }}
            onGoToOnboarding={() => setDevShowOnboarding(true)}
            onGoToSettings={() => { setDevShowOnboarding(false); setDevShowSettings(true); }}
            onGoToTutorial={() => { setDevShowOnboarding(false); setDevShowTutorial(true); }}
            onGoToAddTransaction={() => { setDevShowOnboarding(false); setDevShowAddTx(true); }}
            onExitDevMode={exitDevMode}
          />
        </div>
      </DevModeContext.Provider>
    );
  }

  return (
    <DevModeContext.Provider value={devCtx}>
      <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
        {/* DB errors are still logged to the console via hooks; no visible banner */}

        {authState === 'unauthenticated' && (
          <Auth
            onSignIn={() => setAuthState('authenticated')}
            onDevLogin={enterDevMode}
          />
        )}

        {authState === 'onboarding' && (
          <Onboarding onComplete={handleOnboardingComplete} />
        )}

        {authState === 'authenticated' && (
          <Dashboard
            state={appState}
            setState={setAppState}
            onSignOut={isDevMode ? devSignOut : handleSignOut}
            onUpdateBudget={handleUpdateBudget}
            onAddTransaction={isDevMode ? devAddTransaction : handleAddTransaction}
            onUpdateTransaction={isDevMode ? devUpdateTransaction : handleUpdateTransaction}
            onDeleteTransaction={isDevMode ? devDeleteTransaction : handleDeleteTransaction}
            saveBudgetLimit={isDevMode ? devSaveBudgetLimit : saveBudgetLimit}
            saveUserIncome={isDevMode ? devSaveUserIncome : saveUserIncome}
            saveTheme={isDevMode ? devSaveTheme : saveTheme}
            saveBudgetVisibility={isDevMode ? devSaveBudgetVisibility : saveBudgetVisibility}
            onLinkPartner={isDevMode ? devLinkPartner : handleLinkPartner}
            onUnlinkPartner={isDevMode ? devUnlinkPartner : handleUnlinkPartner}
            onGenerateLinkCode={isDevMode ? devGenerateLinkCode : handleGenerateLinkCode}
            onJoinWithCode={isDevMode ? devJoinWithCode : handleJoinWithCode}
            onApprovePendingTransaction={isDevMode ? devApprovePending : handleApprovePendingTransaction}
            onRejectPendingTransaction={isDevMode ? devRejectPending : handleRejectPendingTransaction}
            isLoadingData={isLoadingData}
            devShowSettings={isDevMode ? devShowSettings : undefined}
            devShowTutorial={isDevMode ? devShowTutorial : undefined}
            devShowAddTx={isDevMode ? devShowAddTx : undefined}
            onDevResetShowSettings={isDevMode ? () => setDevShowSettings(false) : undefined}
            onDevResetShowTutorial={isDevMode ? () => setDevShowTutorial(false) : undefined}
            onDevResetShowAddTx={isDevMode ? () => setDevShowAddTx(false) : undefined}
          />
        )}

        {/* Dev mode floating toolbar */}
        {isDevMode && authState === 'authenticated' && (
          <DevModeToolbar
            isSolo={appState.user?.budgetingSolo ?? true}
            onToggleRole={devToggleRole}
            onGoToDashboard={() => { setDevShowOnboarding(false); setDevShowSettings(false); setDevShowTutorial(false); setDevShowAddTx(false); }}
            onGoToOnboarding={() => setDevShowOnboarding(true)}
            onGoToSettings={() => setDevShowSettings(true)}
            onGoToTutorial={() => setDevShowTutorial(true)}
            onGoToAddTransaction={() => setDevShowAddTx(true)}
            onExitDevMode={exitDevMode}
          />
        )}

        {/* Dev mode banner */}
        {isDevMode && (
          <div className="fixed top-0 left-0 right-0 z-[300] bg-amber-500 py-0.5 text-center pointer-events-none">
            <span className="text-[8px] font-black text-white uppercase tracking-[0.3em]">
              Dev Mode — DB Writes Paused
            </span>
          </div>
        )}
      </div>
    </DevModeContext.Provider>
  );
};

export default App;
