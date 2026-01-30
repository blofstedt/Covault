import React, { useEffect, useState } from 'react';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import Onboarding from './components/Onboarding';
import FullScreenLoader from './components/FullScreenLoader';
import type { AppState, BudgetCategory } from './types';
import { supabase } from './lib/supabase';
import { useAuthState, AuthStatus } from './lib/useAuthState';
import { useDeepLinks } from './lib/useDeepLinks';
import { useNotificationListener } from './lib/useNotificationListener';
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
  } = useUserData({ appState, setAppState, setDbError });

  // Auth + session handling
  useAuthState({ setAppState, setAuthState, loadUserData });

  // Native deep link handling (OAuth callback)
  useDeepLinks();

  // Native notification → auto transaction listener
  useNotificationListener({
    user: appState.user,
    onTransactionDetected: handleAddTransaction,
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

  // --- Render -------------------------------------------------------------

  if (authState === 'loading') {
    return <FullScreenLoader />;
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
      {/* DB errors are still logged to the console via hooks; no visible banner */}

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
          onLinkPartner={handleLinkPartner}
          onUnlinkPartner={handleUnlinkPartner}
        />
      )}
    </div>
  );
};

export default App;
