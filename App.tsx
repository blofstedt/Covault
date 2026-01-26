import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { User, BudgetCategory, Transaction, Recurrence, TransactionLabel, AppState } from './types';
import { SYSTEM_CATEGORIES } from './constants';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';

const App: React.FC = () => {
  const [authState, setAuthState] = useState<'loading' | 'unauthenticated' | 'onboarding' | 'authenticated'>('unauthenticated');
  const [appState, setAppState] = useState<AppState>({
    user: null,
    budgets: SYSTEM_CATEGORIES,
    transactions: [],
    currentMode: 'Mine',
    settings: {
      rolloverEnabled: true,
      rolloverOverspend: false,
      useLeisureAsBuffer: true,
      showSavingsInsight: true,
      theme: 'light',
    }
  });

  // Apply theme class to document root
  useEffect(() => {
    if (appState.settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [appState.settings.theme]);

  const handleSignIn = (user: User) => {
    setAppState(prev => ({ ...prev, user }));
    setAuthState('onboarding');
  };

  const handleOnboardingComplete = (isSolo: boolean, bankMode: 'shared' | 'separate', budgets: BudgetCategory[], partnerEmail?: string) => {
    setAppState(prev => ({
      ...prev,
      budgets,
      user: prev.user ? { 
        ...prev.user, 
        budgetingSolo: isSolo, 
        bankAccountMode: bankMode,
        isLinked: !isSolo,
        linkedUserEmail: partnerEmail
      } : null,
      currentMode: isSolo ? 'Mine' : 'Ours'
    }));
    setAuthState('authenticated');
  };

  const handleUpdateBudget = (updatedBudget: BudgetCategory) => {
    setAppState(prev => ({
      ...prev,
      budgets: prev.budgets.map(b => b.id === updatedBudget.id ? updatedBudget : b)
    }));
  };

  const handleAddTransaction = (tx: Transaction) => {
    setAppState(prev => ({
      ...prev,
      transactions: [tx, ...prev.transactions]
    }));
  };

  const handleUpdateTransaction = (updatedTx: Transaction) => {
    setAppState(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => t.id === updatedTx.id ? updatedTx : t)
    }));
  };

  const handleDeleteTransaction = (id: string) => {
    setAppState(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => t.id !== id)
    }));
  };

  const handleSignOut = () => {
    setAuthState('unauthenticated');
    setAppState(prev => ({ ...prev, user: null }));
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
      {authState === 'unauthenticated' && (
        <Auth onSignIn={handleSignIn} />
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
          onDeleteTransaction={handleDeleteTransaction}
        />
      )}
    </div>
  );
};

export default App;