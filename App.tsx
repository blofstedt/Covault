import React, { useCallback, useEffect, useState } from 'react';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import Onboarding from './components/Onboarding';
import FullScreenLoader from './components/FullScreenLoader';
import type { AppState, BudgetCategory, Transaction, PendingTransaction } from './types';
import { supabase } from './lib/supabase';
import { useAuthState, AuthStatus } from './lib/useAuthState';
import { useDeepLinks } from './lib/useDeepLinks';
import { useNotificationListener } from './lib/useNotificationListener';
import { covaultNotification } from './lib/covaultNotification';
import { useAppTheme } from './lib/useAppTheme';
import { useUserData } from './lib/useUserData';

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

  // Native notification → auto transaction listener
  useNotificationListener({
    user: appState.user,
    onTransactionDetected: handleAddTransaction,
    onPendingTransactionCreated: handlePendingTransactionCreated,
    onAutoAcceptedTransaction: handleAutoAcceptedTransaction,
  });

  // Refresh notifications: scan currently visible Android notifications
  const refreshNotifications = useCallback(async () => {
    if (covaultNotification) {
      await covaultNotification.scanActiveNotifications();
    }
  }, []);

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
          onRefreshNotifications={refreshNotifications}
          onReloadPendingTransactions={loadPendingTransactions}
          isLoadingData={isLoadingData}
        />
      )}
    </div>
  );
};

export default App;
