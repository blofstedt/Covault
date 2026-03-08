import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core'; // Added safety check
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
const SCAN_PROCESSING_DELAY_MS = 2000;
const SCAN_INTERVAL_MS = 5 * 60 * 1000;
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

// Fixed: Added check for 'window' so Vercel doesn't crash during build
const loadSettingsFromStorage = () => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Error loading settings:', e);
  }
  return null;
};

const saveSettingsToStorage = (settings: AppState['settings']) => {
  if (typeof window === 'undefined') return;
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

  const loadUserDataWithState = useCallback(
    async (userId: string) => {
      setIsLoadingData(true);
      try {
        await loadUserData(userId);
      } catch (error) {
        console.error('[loadUserDataWithState] Error:', error);
      } finally {
        setIsLoadingData(false);
      }
    },
    [loadUserData],
  );

  useAuthState({ setAppState, setAuthState, loadUserData: loadUserDataWithState });
  useDeepLinks();

  const handlePendingTransactionCreated = useCallback((pending: PendingTransaction) => {
    setAppState(prev => {
      const existing = prev.pendingTransactions || [];
      if (existing.some(p => p.id === pending.id)) return prev;
      return { ...prev, pendingTransactions: [pending, ...existing] };
    });
  }, []);

  const handleAutoAcceptedTransaction = useCallback((tx: Transaction) => {
    setAppState(prev => {
      if (prev.transactions.some(t => t.id === tx.id)) return prev;
      return { ...prev, transactions: [tx, ...prev.transactions] };
    });
  }, []);

  const handleAIProcessingResult = useCallback(async () => {
    if (appState.user?.id) {
      await loadTransactions(appState.user.id);
    }
  }, [appState.user?.id, loadTransactions]);

  useNotificationListener({
    user: appState.user,
    budgets: appState.budgets,
    onTransactionDetected: handleAddTransaction,
    onPendingTransactionCreated: handlePendingTransactionCreated,
    onAutoAcceptedTransaction: handleAutoAcceptedTransaction,
    onAIProcessingResult: handleAIProcessingResult,
  });

  const [secondsUntilNextScan, setSecondsUntilNextScan] = useState<number | null>(null);

  const refreshNotifications = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return; // Safety check
    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
    if (covaultNotification) {
      await covaultNotification.scanActiveNotifications();
    }
    setSecondsUntilNextScan(SCAN_INTERVAL_S);
  }, []);

  // Fixed: Only run banking detection on actual Android/iOS devices
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
    }
  }, []);

  const prevNotificationsEnabled = useRef(appState.settings.notificationsEnabled);
  useEffect(() => {
    const wasEnabled = prevNotificationsEnabled.current;
    const isEnabled = appState.settings.notificationsEnabled;
    prevNotificationsEnabled.current = isEnabled;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if (!wasEnabled && isEnabled && Capacitor.isNativePlatform()) {
      const userId = appState.user?.id;
      (async () => {
        await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
        if (covaultNotification) {
          await covaultNotification.scanActiveNotifications();
        }
        if (userId) {
          timeoutId = setTimeout(() => loadTransactions(userId), SCAN_PROCESSING_DELAY_MS);
        }
      })();
    }

    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [appState.settings.notificationsEnabled, appState.user?.id, loadTransactions]);

  useEffect(() => {
    if (!appState.settings.notificationsEnabled || !covaultNotification || !Capacitor.isNativePlatform()) {
      setSecondsUntilNextScan(null);
      return;
    }

    setSecondsUntilNextScan(SCAN_INTERVAL_S);

    const intervalId = setInterval(async () => {
      try {
        await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);
        await covaultNotification.scanActiveNotifications();
      } catch (e) {
        console.warn('[periodic scan] Error:', e);
      }
      setSecondsUntilNextScan(SCAN_INTERVAL_S);
    }, SCAN_INTERVAL_MS);

    const tickId = setInterval(() => {
      setSecondsUntilNextScan(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);

    return () => {
      clearInterval(intervalId);
      clearInterval(tickId);
    };
  }, [appState.settings.notificationsEnabled]);

  useAppTheme(appState.settings.theme);

  useEffect(() => {
    saveSettingsToStorage(appState.settings);
  }, [appState.settings]);

  const handleOnboardingComplete = (isSolo: boolean, budgets: BudgetCategory[], partnerEmail?: string) => {
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

  // Render logic with extra safety
  if (authState === 'loading') {
    return <FullScreenLoader />;
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
      {authState === 'unauthenticated' && <Auth onSignIn={() => setAuthState('authenticated')} />}
      {authState === 'onboarding' && <Onboarding onComplete={handleOnboardingComplete} />}
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
          onRefreshNotifications={refreshNotifications}
          onReloadTransactions={loadTransactions}
        />
      )}
    </div>
  );
};

export default App;
