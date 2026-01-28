
import React, { useState, useEffect } from 'react';
import { User, BudgetCategory, Transaction, AppState } from './types';
import { SYSTEM_CATEGORIES } from './constants';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';
import { supabase } from './lib/supabase';

const SESSION_EXPIRY_KEY = 'covault_session_start';
const SESSION_DURATION_DAYS = 14;

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

  // Check if session is within 14-day window
  const isSessionValid = (): boolean => {
    const sessionStart = localStorage.getItem(SESSION_EXPIRY_KEY);
    if (!sessionStart) return false;

    const startTime = parseInt(sessionStart, 10);
    const now = Date.now();
    const daysSinceStart = (now - startTime) / (1000 * 60 * 60 * 24);

    return daysSinceStart < SESSION_DURATION_DAYS;
  };

  // Mark session start time
  const markSessionStart = () => {
    localStorage.setItem(SESSION_EXPIRY_KEY, Date.now().toString());
  };

  // Clear session timestamp
  const clearSessionTimestamp = () => {
    localStorage.removeItem(SESSION_EXPIRY_KEY);
  };

  // Handle Supabase Auth Session
  useEffect(() => {
    // Check for initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        // Check if session is within 14-day window
        if (!isSessionValid()) {
          // Session expired, require re-auth
          supabase.auth.signOut();
          clearSessionTimestamp();
          setAuthState('unauthenticated');
          return;
        }

        const mappedUser: User = {
          id: session.user.id,
          name: session.user.user_metadata.full_name || session.user.email?.split('@')[0] || 'User',
          email: session.user.email || '',
          hasJointAccounts: false,
          budgetingSolo: true,
          monthlyIncome: 5000,
        };
        setAppState(prev => ({ ...prev, user: mappedUser }));
        setAuthState('authenticated');
        // Load categories and transactions from Supabase
        loadUserData(session.user.id);
      } else {
        setAuthState('unauthenticated');
      }
    });

    // Listen for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        // On new sign-in, mark session start
        if (event === 'SIGNED_IN') {
          markSessionStart();
        }

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
        // Load categories and transactions from Supabase
        loadUserData(session.user.id);
      } else {
        clearSessionTimestamp();
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

  // Convert app transaction to Supabase format
  const toSupabaseTransaction = (tx: Transaction) => {
    // Extract date in YYYY-MM-DD format
    const dateObj = new Date(tx.date);
    const dateStr = dateObj.toISOString().split('T')[0];

    return {
      id: tx.id,
      user_id: tx.user_id,
      vendor: tx.vendor,
      amount: tx.amount,
      date: dateStr,
      category_id: tx.budget_id, // Map budget_id to category_id
      recurrence: tx.recurrence,
      label: tx.label,
      is_projected: tx.is_projected,
      split_group_id: tx.splits && tx.splits.length > 1 ? tx.id : null, // Use tx.id as split group if splits exist
      user_name: tx.userName, // Map userName to user_name
    };
  };

  // Convert Supabase transaction to app format
  const fromSupabaseTransaction = (row: any): Transaction => {
    return {
      id: row.id,
      user_id: row.user_id,
      vendor: row.vendor,
      amount: parseFloat(row.amount),
      date: new Date(row.date).toISOString(),
      budget_id: row.category_id, // Map category_id back to budget_id
      recurrence: row.recurrence,
      label: row.label,
      is_projected: row.is_projected,
      userName: row.user_name || '', // Map user_name back to userName
      created_at: row.created_at,
    };
  };

  // Load categories from Supabase
  // Default budget limits by category name
  const DEFAULT_LIMITS: Record<string, number> = {
    'Housing': 1500,
    'Groceries': 600,
    'Transport': 300,
    'Utilities': 150,
    'Leisure': 400,
    'Other': 100,
  };

  const loadCategories = async () => {
    console.log('Loading categories from Supabase...');
    const { data, error } = await supabase
      .from('primary_categories')
      .select('*')
      .order('display_order');

    if (error) {
      console.error('Error loading categories:', error);
      alert(`Failed to load categories: ${error.message}`);
      return;
    }

    console.log('Categories loaded from Supabase:', data);

    if (data && data.length > 0) {
      const budgets: BudgetCategory[] = data.map(row => ({
        id: row.id,
        name: row.name,
        totalLimit: DEFAULT_LIMITS[row.name] || 500,
      }));
      console.log('Mapped budgets:', budgets);
      setAppState(prev => ({ ...prev, budgets }));
    } else {
      console.warn('No categories found in Supabase. Make sure primary_categories table has data.');
      alert('No categories found in database. Please add categories to the primary_categories table.');
    }
  };

  // Load transactions from Supabase
  const loadTransactions = async (userId: string) => {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error loading transactions:', error);
      return;
    }

    if (data) {
      const transactions = data.map(fromSupabaseTransaction);
      setAppState(prev => ({ ...prev, transactions }));
    }
  };

  // Load all data from Supabase
  const loadUserData = async (userId: string) => {
    await loadCategories();
    await loadTransactions(userId);
  };

  const handleAddTransaction = async (tx: Transaction) => {
    console.log('Adding transaction:', tx);
    console.log('Current budgets in state:', appState.budgets);
    console.log('Transaction budget_id:', tx.budget_id);

    // Validate that the budget_id exists in current budgets
    const budgetExists = appState.budgets.some(b => b.id === tx.budget_id);
    if (!budgetExists) {
      console.error('Budget ID not found in current budgets!', tx.budget_id);
      alert('Error: Selected category not found. Please refresh and try again.');
      return;
    }

    // Optimistic update
    setAppState(prev => ({
      ...prev,
      transactions: [tx, ...prev.transactions]
    }));

    // Sync to Supabase
    const supabaseTx = toSupabaseTransaction(tx);
    console.log('Saving transaction to Supabase:', supabaseTx);

    const { data, error } = await supabase
      .from('transactions')
      .insert(supabaseTx)
      .select();

    if (error) {
      console.error('Error saving transaction:', error);
      console.error('Transaction data:', supabaseTx);
      // Rollback on error
      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.filter(t => t.id !== tx.id)
      }));
      alert(`Failed to save transaction: ${error.message}`);
    } else {
      console.log('Transaction saved successfully:', data);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    // Store for potential rollback
    const deletedTx = appState.transactions.find(t => t.id === id);

    // Optimistic update
    setAppState(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => t.id !== id)
    }));

    // Sync to Supabase
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting transaction:', error);
      // Rollback on error
      if (deletedTx) {
        setAppState(prev => ({
          ...prev,
          transactions: [deletedTx, ...prev.transactions]
        }));
      }
    }
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
          onDeleteTransaction={handleDeleteTransaction}
        />
      )}
    </div>
  );
};

export default App;
