
import React, { useState, useEffect } from 'react';
import { User, BudgetCategory, Transaction, AppState } from './types';
import { SYSTEM_CATEGORIES } from './constants';
import Onboarding from './components/Onboarding';
import Dashboard from './components/Dashboard';
import Auth from './components/Auth';
import { supabase, supabaseUrl, supabaseAnonKey } from './lib/supabase';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

const REST_BASE = `${supabaseUrl}/rest/v1`;

// Get auth headers with the current session token
const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || '';
  return {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

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
  notificationsEnabled: false,
};

const App: React.FC = () => {
  const [authState, setAuthState] = useState<'loading' | 'unauthenticated' | 'onboarding' | 'authenticated'>('loading');
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
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

  // Listen for auto-detected transactions from the native NotificationListener service
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const plugin = (Capacitor as any).Plugins?.CovaultNotification;
        if (!plugin || typeof plugin.addListener !== 'function') return;

        const handle = await plugin.addListener('transactionDetected', (event: any) => {
          console.log('[notification] Transaction detected:', event);
          const userId = appState.user?.id;
          if (!userId) {
            console.warn('[notification] No user logged in, ignoring transaction');
            return;
          }

          const tx: Transaction = {
            id: crypto.randomUUID(),
            user_id: userId,
            vendor: event.vendor || 'Unknown Merchant',
            amount: event.amount || 0,
            date: new Date().toISOString().slice(0, 10),
            budget_id: null, // User will categorize later
            is_projected: false,
            label: 'Auto-Added',
            userName: appState.user?.name || 'User',
            created_at: new Date().toISOString(),
          };

          handleAddTransaction(tx);
        });

        cleanup = () => handle.remove();
      } catch (e) {
        console.warn('[notification] Could not set up transaction listener:', e);
      }
    };

    setupListener();
    return () => { cleanup?.(); };
  }, [appState.user?.id]);

  // Apply theme class to document root with smooth transition
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add('theme-transitioning');
    if (appState.settings.theme === 'dark') {
      el.classList.add('dark');
    } else {
      el.classList.remove('dark');
    }
    const timer = setTimeout(() => el.classList.remove('theme-transitioning'), 500);
    return () => clearTimeout(timer);
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
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${REST_BASE}/categories?select=*&order=display_order`,
        { headers }
      );
      const body = await res.text();
      console.log('[loadCategories] status:', res.status, 'body:', body.slice(0, 300));

      if (!res.ok) {
        const msg = `Load categories failed (${res.status}): ${body.slice(0, 200)}`;
        console.error(msg);
        setDbError(msg);
        setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
        setCategoriesLoaded(true);
        return;
      }

      const data = JSON.parse(body);
      if (data && data.length > 0) {
        const budgets: BudgetCategory[] = data.map((row: any) => ({
          id: row.id,
          name: row.name,
          totalLimit: DEFAULT_LIMITS[row.name] || 500,
        }));
        console.log('[loadCategories] OK:', budgets.map(b => ({ id: b.id, name: b.name })));
        setAppState(prev => ({ ...prev, budgets }));
      } else {
        console.warn('[loadCategories] empty result, using fallback');
        setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
      }
      setCategoriesLoaded(true);
    } catch (err: any) {
      const msg = `Load categories exception: ${err?.message || err}`;
      console.error(msg);
      setDbError(msg);
      setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
      setCategoriesLoaded(true);
    }
  };

  // Load transactions from Supabase via raw fetch
  const loadTransactions = async (userId: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${REST_BASE}/transactions?select=*&user_id=eq.${userId}&order=date.desc`,
        { headers }
      );
      const body = await res.text();
      console.log('[loadTransactions] status:', res.status, 'body:', body.slice(0, 300));

      if (!res.ok) {
        const msg = `Load transactions failed (${res.status}): ${body.slice(0, 200)}`;
        console.error(msg);
        setDbError(msg);
        return;
      }

      const data = JSON.parse(body);
      if (data && data.length > 0) {
        const transactions = data.map(fromSupabaseTransaction);
        console.log('[loadTransactions] OK, count:', transactions.length);
        setAppState(prev => ({ ...prev, transactions }));
      } else {
        console.log('[loadTransactions] no transactions found');
      }
    } catch (err: any) {
      const msg = `Load transactions exception: ${err?.message || err}`;
      console.error(msg);
      setDbError(msg);
    }
  };

  // Load partner link status from linked_partners table
  const loadPartnerLink = async (userId: string) => {
    try {
      const headers = await getAuthHeaders();
      // Check for accepted partnership in either direction
      const res = await fetch(
        `${REST_BASE}/linked_partners?select=*,partner:settings!linked_partners_partner_id_fkey(name,email),requester:settings!linked_partners_user_id_fkey(name,email)&or=(user_id.eq.${userId},partner_id.eq.${userId})&status=eq.accepted&limit=1`,
        { headers }
      );
      if (!res.ok) {
        // Try simpler query without joins
        const res2 = await fetch(
          `${REST_BASE}/linked_partners?select=*&or=(user_id.eq.${userId},partner_id.eq.${userId})&status=eq.accepted&limit=1`,
          { headers }
        );
        if (res2.ok) {
          const data = JSON.parse(await res2.text());
          if (data && data.length > 0) {
            const link = data[0];
            const partnerId = link.user_id === userId ? link.partner_id : link.user_id;
            setAppState(prev => ({
              ...prev,
              user: prev.user ? { ...prev.user, budgetingSolo: false, partnerId } : null,
            }));
          }
        }
        return;
      }
      const body = await res.text();
      const data = JSON.parse(body);
      if (data && data.length > 0) {
        const link = data[0];
        const isRequester = link.user_id === userId;
        const partnerInfo = isRequester ? link.partner : link.requester;
        const partnerId = isRequester ? link.partner_id : link.user_id;
        setAppState(prev => ({
          ...prev,
          user: prev.user ? {
            ...prev.user,
            budgetingSolo: false,
            partnerId,
            partnerName: partnerInfo?.name || undefined,
            partnerEmail: partnerInfo?.email || undefined,
          } : null,
        }));
        // Also load partner's transactions
        await loadTransactions(partnerId);
      }
    } catch (err: any) {
      console.error('[loadPartnerLink]', err?.message || err);
    }
  };

  // Send a partner link request by email
  const handleLinkPartner = async (partnerEmail: string) => {
    try {
      const headers = await getAuthHeaders();
      // Look up partner by email in settings table
      const lookupRes = await fetch(
        `${REST_BASE}/settings?select=user_id,name,email&email=eq.${encodeURIComponent(partnerEmail)}&limit=1`,
        { headers }
      );
      if (!lookupRes.ok) {
        setDbError(`Could not find user with email ${partnerEmail}`);
        return;
      }
      const lookupData = JSON.parse(await lookupRes.text());
      if (!lookupData || lookupData.length === 0) {
        setDbError(`No Covault account found for ${partnerEmail}. They need to sign up first.`);
        return;
      }
      const partnerId = lookupData[0].user_id;
      const partnerName = lookupData[0].name;
      const userId = appState.user?.id;
      if (!userId || partnerId === userId) {
        setDbError("You can't link with yourself.");
        return;
      }

      // Insert the link request
      headers['Prefer'] = 'return=representation';
      const insertRes = await fetch(`${REST_BASE}/linked_partners`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: userId,
          partner_id: partnerId,
          status: 'accepted', // Auto-accept for now (MVP)
        }),
      });

      if (!insertRes.ok) {
        const body = await insertRes.text();
        setDbError(`Link failed: ${body.slice(0, 200)}`);
        return;
      }

      setAppState(prev => ({
        ...prev,
        user: prev.user ? {
          ...prev.user,
          budgetingSolo: false,
          partnerId,
          partnerName,
          partnerEmail,
        } : null,
      }));
      console.log('[linkPartner] OK, linked with', partnerEmail);
    } catch (err: any) {
      setDbError(`Link exception: ${err?.message || err}`);
    }
  };

  // Disconnect partner
  const handleUnlinkPartner = async () => {
    try {
      const userId = appState.user?.id;
      if (!userId) return;
      const headers = await getAuthHeaders();
      // Delete all links involving this user
      await fetch(
        `${REST_BASE}/linked_partners?or=(user_id.eq.${userId},partner_id.eq.${userId})`,
        { method: 'DELETE', headers }
      );
      setAppState(prev => ({
        ...prev,
        user: prev.user ? {
          ...prev.user,
          budgetingSolo: true,
          partnerId: undefined,
          partnerEmail: undefined,
          partnerName: undefined,
        } : null,
      }));
      console.log('[unlinkPartner] OK');
    } catch (err: any) {
      setDbError(`Unlink exception: ${err?.message || err}`);
    }
  };

  // Load all data from Supabase
  const loadUserData = async (userId: string) => {
    console.log('loadUserData called for user:', userId);
    await loadCategories();
    await loadTransactions(userId);
    await loadPartnerLink(userId);
    console.log('loadUserData completed');
  };

  const handleAddTransaction = async (tx: Transaction) => {
    if (!categoriesLoaded) {
      setDbError('Cannot add transaction: categories not yet loaded');
      return;
    }

    // Optimistic update
    setAppState(prev => ({
      ...prev,
      transactions: [tx, ...prev.transactions]
    }));

    try {
      const row = toSupabaseTransaction(tx);
      console.log('[insert] payload:', JSON.stringify(row));

      const headers = await getAuthHeaders();
      headers['Prefer'] = 'return=representation';

      const res = await fetch(`${REST_BASE}/transactions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(row),
      });
      const body = await res.text();
      console.log('[insert] status:', res.status, 'body:', body.slice(0, 300));

      if (!res.ok) {
        const msg = `Insert failed (${res.status}): ${body.slice(0, 200)}`;
        console.error(msg);
        setDbError(msg);
        // Rollback
        setAppState(prev => ({
          ...prev,
          transactions: prev.transactions.filter(t => t.id !== tx.id)
        }));
        return;
      }

      const data = JSON.parse(body);
      // PostgREST returns an array for inserts
      const saved = fromSupabaseTransaction(Array.isArray(data) ? data[0] : data);
      console.log('[insert] OK, id:', saved.id);
      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.map(t => t.id === tx.id ? saved : t)
      }));
    } catch (err: any) {
      const msg = `Insert exception: ${err?.message || err}`;
      console.error(msg);
      setDbError(msg);
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

      const headers = await getAuthHeaders();
      const res = await fetch(
        `${REST_BASE}/transactions?id=eq.${updatedTx.id}`,
        { method: 'PATCH', headers, body: JSON.stringify(row) }
      );
      const body = await res.text();
      console.log('[update] status:', res.status, 'body:', body.slice(0, 300));

      if (!res.ok) {
        const msg = `Update failed (${res.status}): ${body.slice(0, 200)}`;
        console.error(msg);
        setDbError(msg);
      }
    } catch (err: any) {
      const msg = `Update exception: ${err?.message || err}`;
      console.error(msg);
      setDbError(msg);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    const deletedTx = appState.transactions.find(t => t.id === id);

    setAppState(prev => ({
      ...prev,
      transactions: prev.transactions.filter(t => t.id !== id)
    }));

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${REST_BASE}/transactions?id=eq.${id}`,
        { method: 'DELETE', headers }
      );

      if (!res.ok) {
        const body = await res.text();
        const msg = `Delete failed (${res.status}): ${body.slice(0, 200)}`;
        console.error(msg);
        setDbError(msg);
        if (deletedTx) {
          setAppState(prev => ({
            ...prev,
            transactions: [deletedTx, ...prev.transactions]
          }));
        }
      } else {
        console.log('[delete] OK:', id);
      }
    } catch (err: any) {
      const msg = `Delete exception: ${err?.message || err}`;
      console.error(msg);
      setDbError(msg);
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
      {dbError && (
        <div
          onClick={() => setDbError(null)}
          className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white text-xs px-4 py-3 shadow-lg"
          style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
        >
          <strong>DB Error:</strong> {dbError}
          <span className="block text-[10px] opacity-75 mt-1">Tap to dismiss</span>
        </div>
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
          onLinkPartner={handleLinkPartner}
          onUnlinkPartner={handleUnlinkPartner}
        />
      )}
    </div>
  );
};

export default App;
