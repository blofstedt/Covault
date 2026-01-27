
import React, { useState, useEffect } from 'react';
import { User, BudgetCategory, Transaction, AppState } from './types';
import { SYSTEM_CATEGORIES } from './constants';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';
import { supabase } from './lib/supabase';

const App: React.FC = () => {
  const [authState, setAuthState] = useState<'loading' | 'unauthenticated' | 'onboarding' | 'authenticated'>('loading');
  const [appState, setAppState] = useState<AppState>({
    user: null,
    budgets: SYSTEM_CATEGORIES,
    transactions: [],
    settings: {
      rolloverEnabled: true,
      rolloverOverspend: false,
      useLeisureAsBuffer: true,
      showSavingsInsight: true,
      theme: 'light',
      hasSeenTutorial: false,
    }
  });

  // Handle Supabase Auth Session
  useEffect(() => {
    // Check for initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const mappedUser: User = {
          id: session.user.id,
          name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || 'User',
          email: session.user.email || '',
          hasJointAccounts: false,
          budgetingSolo: true,
          monthlyIncome: 5000,
        };
        setAppState(prev => ({ ...prev, user: mappedUser }));
        // Logic: if they have a session, we assume they passed onboarding or should be authenticated.
        // For a real app, you'd check a 'profile' table here.
        setAuthState('authenticated');
      } else {
        setAuthState('unauthenticated');
      }
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const mappedUser: User = {
          id: session.user.id,
          name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || 'User',
          email: session.user.email || '',
          hasJointAccounts: false,
          budgetingSolo: true,
          monthlyIncome: 5000,
        };
        setAppState(prev => ({ ...prev, user: mappedUser }));
        // Only trigger onboarding if we were just unauthenticated
        setAuthState(prev => prev === 'unauthenticated' ? 'onboarding' : 'authenticated');
      } else {
        setAuthState('unauthenticated');
        setAppState(prev => ({ ...prev, user: null }));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Apply theme class to document root
  useEffect(() => {
    if (appState.settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [appState.settings.theme]);

  const handleOnboardingComplete = (isSolo: boolean, budgets: BudgetCategory[], partnerEmail?: string) => {
    setAppState(prev => ({
      ...prev,
      budgets,
      user: prev.user ? {
        ...prev.user,
        budgetingSolo: isSolo,
        partnerEmail: partnerEmail
      } : null
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

  const handleDeleteTransaction = (id: string) => {
    setAppState(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => t.id !== id)
    }));
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (authState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center space-y-4">
           <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Securing Vault...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 overflow-hidden relative flex flex-col transition-colors duration-300">
      {authState === 'unauthenticated' && <Auth onSignIn={() => {}} />}

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
