
import React, { useState, useEffect } from 'react';
import { User, BudgetCategory, Transaction, AppState } from './types';
import { SYSTEM_CATEGORIES } from './constants';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';
import { supabase } from './lib/supabase';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

const SESSION_EXPIRY_KEY = 'covault_session_start';
const SESSION_DURATION_DAYS = 14;
const SETTINGS_KEY = 'covault_settings';

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

const DEFAULT_SETTINGS = {
  rolloverEnabled: true,
  rolloverOverspend: false,
  useLeisureAsBuffer: true,
  showSavingsInsight: true,
  theme: 'light' as const,
  hasSeenTutorial: false,
};

const App: React.FC = () => {
  const [authState, setAuthState] = useState<'loading' | 'unauthenticated' | 'onboarding' | 'authenticated'>('loading');
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [appState, setAppState] = useState<AppState>(() => {
    // Initialize with saved settings merged with defaults (so new settings get default values)
    const savedSettings = loadSettingsFromStorage();
    return {
      user: null,
      budgets: [],  // Start empty -- real IDs loaded from Supabase categories table
      transactions: [],
      settings: { ...DEFAULT_SETTINGS, ...savedSettings }
    };
  });

  // Check if session is within 14-day window
  const isSessionValid = (): boolean => {
    const sessionStart = localStorage.getItem(SESSION_EXPIRY_KEY);
    if (!sessionStart) {
      // No timestamp yet - this is a valid first-time session, mark it now
      markSessionStart();
      return true;
    }

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

  // Save settings whenever they change
  useEffect(() => {
    saveSettingsToStorage(appState.settings);
  }, [appState.settings]);

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

  // Handle deep link callback from OAuth on native platforms
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleAppUrlOpen = CapApp.addListener('appUrlOpen', async ({ url }) => {
      console.log('Deep link received:', url);

      // Check if this is our auth callback
      if (url.includes('auth/callback') || url.includes('access_token') || url.includes('#')) {
        // Extract the fragment (tokens come after #)
        const hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
          const fragment = url.substring(hashIndex + 1);
          const params = new URLSearchParams(fragment);
          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');

          if (accessToken && refreshToken) {
            console.log('Setting session from deep link tokens...');
            const { error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (error) {
              console.error('Error setting session from deep link:', error);
            } else {
              console.log('Session set successfully from deep link');
            }
          }
        }
      }
    });

    return () => {
      handleAppUrlOpen.then(h => h.remove());
    };
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

  // Build the object Supabase expects — only columns that exist in the table
  const toSupabaseTransaction = (tx: Transaction) => {
    const dateStr = new Date(tx.date).toISOString().split('T')[0];

    const row: Record<string, any> = {
      user_id: tx.user_id,
      vendor: tx.vendor,
      amount: Number(tx.amount),
      date: dateStr,
      category_id: tx.budget_id,
      recurrence: tx.recurrence || 'One-time',
      label: tx.label || 'Manual',
      is_projected: tx.is_projected ?? false,
    };

    // Only include optional columns when they have real values
    if (tx.userName) row.user_name = tx.userName;
    if (tx.splits && tx.splits.length > 1) row.split_group_id = tx.id;

    return row;
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
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('display_order');

    if (error) {
      console.error('Error loading categories:', error);
      // Fall back to SYSTEM_CATEGORIES so UI still renders, but inserts will fail FK check
      setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
      setCategoriesLoaded(true);
      return;
    }

    if (data && data.length > 0) {
      const budgets: BudgetCategory[] = data.map(row => ({
        id: row.id,
        name: row.name,
        totalLimit: DEFAULT_LIMITS[row.name] || 500,
      }));
      console.log('Categories loaded from Supabase:', budgets.map(b => ({ id: b.id, name: b.name })));
      setAppState(prev => ({ ...prev, budgets }));
    } else {
      console.warn('No categories found in categories table, using fallback SYSTEM_CATEGORIES with hardcoded IDs');
      setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
    }
    setCategoriesLoaded(true);
  };

  // Load transactions from Supabase
  const loadTransactions = async (userId: string) => {
    console.log('loadTransactions called with userId:', userId);

    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false });

    console.log('Transactions query result:', { data, error, count: data?.length });

    if (error) {
      console.error('Error loading transactions:', error);
      return;
    }

    if (data && data.length > 0) {
      const transactions = data.map(fromSupabaseTransaction);
      console.log('Mapped transactions:', transactions);
      setAppState(prev => ({ ...prev, transactions }));
    } else {
      console.log('No transactions found for user');
    }
  };

  // Load all data from Supabase
  const loadUserData = async (userId: string) => {
    console.log('loadUserData called for user:', userId);
    await loadCategories();
    await loadTransactions(userId);
    console.log('loadUserData completed');
  };

  const handleAddTransaction = async (tx: Transaction) => {
    if (!categoriesLoaded) {
      console.error('Cannot add transaction: categories not yet loaded');
      return;
    }

    // Optimistic update — use the client-side tx so UI responds instantly
    setAppState(prev => ({
      ...prev,
      transactions: [tx, ...prev.transactions]
    }));

    try {
      const row = toSupabaseTransaction(tx);
      console.log('[insert] payload:', JSON.stringify(row));

      const { data, error } = await supabase
        .from('transactions')
        .insert(row)
        .select()
        .single();

      if (error) {
        console.error('[insert] FAILED:', error.code, error.message, error.details, error.hint);
        // Rollback optimistic add
        setAppState(prev => ({
          ...prev,
          transactions: prev.transactions.filter(t => t.id !== tx.id)
        }));
        return;
      }

      // Replace the optimistic tx with the real DB row (has server-generated id)
      const saved = fromSupabaseTransaction(data);
      console.log('[insert] OK, id:', saved.id);
      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.map(t => t.id === tx.id ? saved : t)
      }));
    } catch (err) {
      console.error('[insert] exception:', err);
      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.filter(t => t.id !== tx.id)
      }));
    }
  };

  const handleUpdateTransaction = async (updatedTx: Transaction) => {
    setAppState(prev => ({
      ...prev,
      transactions: prev.transactions.map(t => t.id === updatedTx.id ? updatedTx : t)
    }));

    try {
      const row = toSupabaseTransaction(updatedTx);
      console.log('[update] id:', updatedTx.id, 'payload:', JSON.stringify(row));

      const { error } = await supabase
        .from('transactions')
        .update(row)
        .eq('id', updatedTx.id);

      if (error) {
        console.error('[update] FAILED:', error.code, error.message, error.details, error.hint);
      } else {
        console.log('[update] OK');
      }
    } catch (err) {
      console.error('[update] exception:', err);
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

    try {
      const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting transaction:', error);
        if (deletedTx) {
          setAppState(prev => ({
            ...prev,
            transactions: [deletedTx, ...prev.transactions]
          }));
        }
      } else {
        console.log('Transaction deleted successfully:', id);
      }
    } catch (err) {
      console.error('Transaction delete threw exception:', err);
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
          onUpdateTransaction={handleUpdateTransaction}
          onDeleteTransaction={handleDeleteTransaction}
        />
      )}
    </div>
  );
};

export default App;
