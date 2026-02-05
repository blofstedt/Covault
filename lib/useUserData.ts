// lib/useUserData.ts
import { useCallback, useState } from 'react';
import { SYSTEM_CATEGORIES } from '../constants';
import type { AppState, BudgetCategory, Transaction } from '../types';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

const REST_BASE = `${supabaseUrl}/rest/v1`;

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token || '';
  return {
    apikey: supabaseAnonKey || '',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

// Default budget limit when user has not set a budget
const DEFAULT_BUDGET_LIMIT = 500;

// Default monthly income when user has not set income
const DEFAULT_MONTHLY_INCOME = 5000;

interface UseUserDataParams {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  setDbError: (msg: string | null) => void;
}

export const useUserData = ({
  appState,
  setAppState,
  setDbError,
}: UseUserDataParams) => {
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);

  // Build the object Supabase expects — only columns that exist in the table
  const toSupabaseTransaction = useCallback((tx: Transaction) => {
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

    if (tx.userName) row.user_name = tx.userName;
    if (tx.splits && tx.splits.length > 1) row.split_group_id = tx.id;

    return row;
  }, []);

  // Convert Supabase transaction to app format
  const fromSupabaseTransaction = useCallback((row: any): Transaction => {
    return {
      id: row.id,
      user_id: row.user_id,
      vendor: row.vendor,
      amount: parseFloat(row.amount),
      date: new Date(row.date).toISOString(),
      budget_id: row.category_id,
      recurrence: row.recurrence,
      label: row.label,
      is_projected: row.is_projected,
      userName: row.user_name || '',
      created_at: row.created_at,
    };
  }, []);

  // Load categories from Supabase
  const loadCategories = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${REST_BASE}/categories?select=*&order=display_order`,
        { headers },
      );
      const body = await res.text();
      console.log(
        '[loadCategories] status:',
        res.status,
        'body:',
        body.slice(0, 300),
      );

      if (!res.ok) {
        const msg = `Load categories failed (${res.status}): ${body.slice(
          0,
          200,
        )}`;
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
          // start with default limit; user-specific overrides will be loaded separately
          totalLimit: DEFAULT_BUDGET_LIMIT,
        }));
        console.log(
          '[loadCategories] OK:',
          budgets.map(b => ({ id: b.id, name: b.name })),
        );
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
  }, [setAppState, setDbError]);

  // Load user budget limits from budgets table
  const loadUserBudgets = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${REST_BASE}/budgets?select=*&user_id=eq.${userId}`,
          { headers },
        );
        const body = await res.text();

        if (!res.ok) {
          // Check if it's a "table not found" error (expected during initial setup)
          if (res.status === 404 && body.includes('Could not find the table')) {
            console.log('[loadUserBudgets] budgets table not found - using defaults (run schema.sql to create tables)');
            return;
          }
          console.error('[loadUserBudgets] failed:', body.slice(0, 200));
          return;
        }

        const rows = JSON.parse(body);

        // Map category name → limit_amount
        const limitsByCategory: Record<string, number> = {};
        for (const row of rows) {
          limitsByCategory[row.category] = Number(row.limit_amount);
        }

        // Merge with existing categories in state
        setAppState(prev => ({
          ...prev,
          budgets: prev.budgets.map(b => ({
            ...b,
            totalLimit: limitsByCategory[b.name] ?? b.totalLimit ?? 0,
          })),
        }));

        console.log('[loadUserBudgets] loaded:', limitsByCategory);
      } catch (err: any) {
        console.error('[loadUserBudgets] exception:', err?.message || err);
      }
    },
    [setAppState],
  );

  // Load user settings from Supabase (monthly_income, etc.)
  const loadUserSettings = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${REST_BASE}/settings?select=monthly_income,theme&user_id=eq.${userId}`,
          { headers },
        );
        
        if (!res.ok) {
          console.error('[loadUserSettings] failed:', res.status);
          return;
        }
        
        const rows = await res.json();

        if (rows && rows.length > 0) {
          const rawMonthlyIncome = rows[0].monthly_income;
          const parsedMonthlyIncome =
            rawMonthlyIncome === null || rawMonthlyIncome === undefined
              ? null
              : Number(rawMonthlyIncome);
          const shouldUseDefault =
            parsedMonthlyIncome === null || Number.isNaN(parsedMonthlyIncome);
          const monthlyIncome = shouldUseDefault
            ? DEFAULT_MONTHLY_INCOME
            : parsedMonthlyIncome;

          // Load theme from database
          const theme = rows[0].theme || 'light';

          setAppState(prev => ({
            ...prev,
            user: prev.user
              ? { ...prev.user, monthlyIncome }
              : null,
            settings: {
              ...prev.settings,
              theme: theme as 'light' | 'dark',
            },
          }));

          console.log(
            shouldUseDefault
              ? '[loadUserSettings] monthly_income missing, using default:'
              : '[loadUserSettings] loaded monthly_income:',
            monthlyIncome,
          );
          console.log('[loadUserSettings] loaded theme:', theme);
        } else {
          // No settings row exists (shouldn't happen with trigger, but handle it)
          // Use default value only in this case
          console.log('[loadUserSettings] no settings row found, using default:', DEFAULT_MONTHLY_INCOME);
          setAppState(prev => ({
            ...prev,
            user: prev.user
              ? { ...prev.user, monthlyIncome: DEFAULT_MONTHLY_INCOME }
              : null,
          }));
        }
      } catch (err: any) {
        console.error('[loadUserSettings] exception:', err?.message || err);
      }
    },
    [setAppState],
  );

  // Load transactions from Supabase via raw fetch
  const loadTransactions = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${REST_BASE}/transactions?select=*&user_id=eq.${userId}&order=date.desc`,
          { headers },
        );
        const body = await res.text();
        console.log(
          '[loadTransactions] status:',
          res.status,
          'body:',
          body.slice(0, 300),
        );

        if (!res.ok) {
          const msg = `Load transactions failed (${res.status}): ${body.slice(
            0,
            200,
          )}`;
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
    },
    [fromSupabaseTransaction, setAppState, setDbError],
  );

  // Load pending transactions awaiting approval
  const loadPendingTransactions = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${REST_BASE}/pending_transactions?select=*&user_id=eq.${userId}&needs_review=eq.true&order=created_at.desc`,
          { headers },
        );

        if (!res.ok) {
          // Check if table doesn't exist (expected during initial setup)
          const body = await res.text();
          if (res.status === 404 && body.includes('Could not find the table')) {
            console.log('[loadPendingTransactions] table not found - using defaults (run schema.sql to create tables)');
            setAppState(prev => ({ ...prev, pendingTransactions: [] }));
            return;
          }
          console.log('[loadPendingTransactions] failed or no pending transactions');
          return;
        }

        const data = JSON.parse(await res.text());
        if (data && data.length > 0) {
          console.log('[loadPendingTransactions] OK, count:', data.length);
          setAppState(prev => ({ ...prev, pendingTransactions: data }));
        } else {
          console.log('[loadPendingTransactions] no pending transactions');
          setAppState(prev => ({ ...prev, pendingTransactions: [] }));
        }
      } catch (err: any) {
        console.error('[loadPendingTransactions]', err?.message || err);
      }
    },
    [setAppState],
  );

  // Load household link status from household_links table
  const loadHouseholdLink = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();

        // Query household_links where user is either user1 or user2
        const res = await fetch(
          `${REST_BASE}/household_links?select=*&or=(user1_id.eq.${userId},user2_id.eq.${userId})&limit=1`,
          { headers },
        );

        if (!res.ok) {
          const body = await res.text();
          // Check if table doesn't exist (expected during initial setup)
          if (res.status === 404 && body.includes('Could not find the table')) {
            console.log('[loadHouseholdLink] table not found - using defaults (run schema.sql to create tables)');
            return;
          }
          console.log('[loadHouseholdLink] No household link found or error');
          return;
        }

        const body = await res.text();
        const data = JSON.parse(body);
        if (data && data.length > 0) {
          const link = data[0];
          const isUser1 = link.user1_id === userId;
          const partnerId = isUser1 ? link.user2_id : link.user1_id;
          const partnerName = isUser1 ? link.user2_name : link.user1_name;

          setAppState(prev => ({
            ...prev,
            user: prev.user
              ? {
                  ...prev.user,
                  budgetingSolo: false,
                  hasJointAccounts: true,
                  partnerId,
                  partnerName: partnerName || undefined,
                }
              : null,
          }));

          // Load partner's transactions
          await loadTransactions(partnerId);
        }
      } catch (err: any) {
        console.error('[loadHouseholdLink]', err?.message || err);
      }
    },
    [loadTransactions, setAppState],
  );

  // Load all data from Supabase
  const loadUserData = useCallback(
    async (userId: string) => {
      console.log('loadUserData called for user:', userId);
      await loadCategories();
      await loadUserBudgets(userId); // load user-specific budget limits
      await loadUserSettings(userId); // load user-specific settings (monthly_income, etc.)
      await loadTransactions(userId);
      await loadPendingTransactions(userId); // load pending transactions awaiting approval
      await loadHouseholdLink(userId); // Changed from loadPartnerLink
      console.log('loadUserData completed');
    },
    [loadCategories, loadHouseholdLink, loadPendingTransactions, loadTransactions, loadUserBudgets, loadUserSettings],
  );

  // Generate a link code for household linking
  const handleGenerateLinkCode = useCallback(async (): Promise<string | null> => {
    try {
      const userId = appState.user?.id;
      if (!userId) {
        setDbError('User not logged in');
        return null;
      }

      const headers = await getAuthHeaders();
      
      // Generate a 6-character code
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      // Set expiration to 24 hours from now
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      
      (headers as any)['Prefer'] = 'return=representation';
      const res = await fetch(`${REST_BASE}/link_codes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code,
          user_id: userId,
          expires_at: expiresAt,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        setDbError(`Failed to generate link code: ${body.slice(0, 200)}`);
        return null;
      }

      console.log('[generateLinkCode] Generated code:', code);
      return code;
    } catch (err: any) {
      setDbError(`Generate link code exception: ${err?.message || err}`);
      return null;
    }
  }, [appState.user, setDbError]);

  // Join household using a link code
  const handleJoinWithCode = useCallback(
    async (code: string) => {
      try {
        const userId = appState.user?.id;
        const userName = appState.user?.name;
        if (!userId || !userName) {
          setDbError('User not logged in');
          return;
        }

        const headers = await getAuthHeaders();
        
        // Look up the link code
        const codeRes = await fetch(
          `${REST_BASE}/link_codes?select=*&code=eq.${code.toUpperCase()}&expires_at=gt.${new Date().toISOString()}&limit=1`,
          { headers },
        );

        if (!codeRes.ok) {
          setDbError('Invalid or expired link code');
          return;
        }

        const codeData = JSON.parse(await codeRes.text());
        if (!codeData || codeData.length === 0) {
          setDbError('Invalid or expired link code');
          return;
        }

        const linkCode = codeData[0];
        const otherUserId = linkCode.user_id;

        if (otherUserId === userId) {
          setDbError("You can't link with yourself");
          return;
        }

        // Get the other user's name
        const settingsRes = await fetch(
          `${REST_BASE}/settings?select=name&user_id=eq.${otherUserId}&limit=1`,
          { headers },
        );

        let otherUserName = 'Partner';
        if (settingsRes.ok) {
          const settingsData = JSON.parse(await settingsRes.text());
          if (settingsData && settingsData.length > 0) {
            otherUserName = settingsData[0].name;
          }
        }

        // Create household link
        (headers as any)['Prefer'] = 'return=representation';
        const linkRes = await fetch(`${REST_BASE}/household_links`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user1_id: otherUserId,
            user2_id: userId,
            user1_name: otherUserName,
            user2_name: userName,
          }),
        });

        if (!linkRes.ok) {
          const body = await linkRes.text();
          setDbError(`Failed to create household link: ${body.slice(0, 200)}`);
          return;
        }

        // Delete the used link code
        await fetch(`${REST_BASE}/link_codes?code=eq.${code.toUpperCase()}`, {
          method: 'DELETE',
          headers,
        });

        setAppState(prev => ({
          ...prev,
          user: prev.user
            ? {
                ...prev.user,
                budgetingSolo: false,
                hasJointAccounts: true,
                partnerId: otherUserId,
                partnerName: otherUserName,
              }
            : null,
        }));

        console.log('[joinWithCode] Successfully linked household');
      } catch (err: any) {
        setDbError(`Join with code exception: ${err?.message || err}`);
      }
    },
    [appState.user, setAppState, setDbError],
  );

  // Send a partner link request by email (legacy method, kept for compatibility)
  const handleLinkPartner = useCallback(
    async (partnerEmail: string) => {
      try {
        const headers = await getAuthHeaders();
        const lookupRes = await fetch(
          `${REST_BASE}/settings?select=user_id,name,email&email=eq.${encodeURIComponent(
            partnerEmail,
          )}&limit=1`,
          { headers },
        );

        if (!lookupRes.ok) {
          setDbError(`Could not find user with email ${partnerEmail}`);
          return;
        }

        const lookupData = JSON.parse(await lookupRes.text());
        if (!lookupData || lookupData.length === 0) {
          setDbError(
            `No Covault account found for ${partnerEmail}. They need to sign up first.`,
          );
          return;
        }

        const partnerId = lookupData[0].user_id;
        const partnerName = lookupData[0].name;
        const userId = appState.user?.id;
        const userName = appState.user?.name;
        if (!userId || partnerId === userId) {
          setDbError("You can't link with yourself.");
          return;
        }

        (headers as any)['Prefer'] = 'return=representation';
        const insertRes = await fetch(`${REST_BASE}/household_links`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user1_id: userId,
            user2_id: partnerId,
            user1_name: userName,
            user2_name: partnerName,
          }),
        });

        if (!insertRes.ok) {
          const body = await insertRes.text();
          setDbError(`Link failed: ${body.slice(0, 200)}`);
          return;
        }

        setAppState(prev => ({
          ...prev,
          user: prev.user
            ? {
                ...prev.user,
                budgetingSolo: false,
                hasJointAccounts: true,
                partnerId,
                partnerName,
                partnerEmail,
              }
            : null,
        }));
        console.log('[linkPartner] OK, linked with', partnerEmail);
      } catch (err: any) {
        setDbError(`Link exception: ${err?.message || err}`);
      }
    },
    [appState.user, setAppState, setDbError],
  );

  // Disconnect household
  const handleUnlinkPartner = useCallback(async () => {
    try {
      const userId = appState.user?.id;
      if (!userId) return;

      const headers = await getAuthHeaders();
      await fetch(
        `${REST_BASE}/household_links?or=(user1_id.eq.${userId},user2_id.eq.${userId})`,
        { method: 'DELETE', headers },
      );

      setAppState(prev => ({
        ...prev,
        user: prev.user
          ? {
              ...prev.user,
              budgetingSolo: true,
              hasJointAccounts: false,
              partnerId: undefined,
              partnerEmail: undefined,
              partnerName: undefined,
            }
          : null,
      }));
      console.log('[unlinkPartner] OK');
    } catch (err: any) {
      setDbError(`Unlink exception: ${err?.message || err}`);
    }
  }, [appState.user, setAppState, setDbError]);

  // Save a single budget limit for the current user
  const saveBudgetLimit = useCallback(
    async (categoryId: string, newLimit: number) => {
      const userId = appState.user?.id;
      if (!userId) return;

      // Find the category name from the categoryId
      const category = appState.budgets.find(b => b.id === categoryId);
      if (!category) {
        console.error('[saveBudgetLimit] Category not found:', categoryId);
        return;
      }
      const categoryName = category.name;
      
      // Store previous value for rollback
      const previousLimit = category.totalLimit;

      // Optimistic UI update
      setAppState(prev => ({
        ...prev,
        budgets: prev.budgets.map(b =>
          b.id === categoryId ? { ...b, totalLimit: newLimit } : b,
        ),
      }));

      try {
        const headers = await getAuthHeaders();
        
        // First, check if a record exists
        const checkRes = await fetch(
          `${REST_BASE}/budgets?select=id&user_id=eq.${userId}&category=eq.${encodeURIComponent(categoryName)}`,
          { headers },
        );
        
        if (!checkRes.ok) {
          const msg = `[saveBudgetLimit] check failed (${checkRes.status})`;
          console.error(msg);
          setDbError(msg);
          
          // Rollback optimistic update
          setAppState(prev => ({
            ...prev,
            budgets: prev.budgets.map(b =>
              b.id === categoryId ? { ...b, totalLimit: previousLimit } : b,
            ),
          }));
          return;
        }
        
        const existingRecords = await checkRes.json();
        const recordExists = existingRecords && existingRecords.length > 0;

        let res;
        if (recordExists) {
          // Update existing record
          const recordId = existingRecords[0].id;
          (headers as any)['Prefer'] = 'return=representation';
          res = await fetch(
            `${REST_BASE}/budgets?id=eq.${recordId}`,
            {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ limit_amount: newLimit }),
            },
          );
        } else {
          // Insert new record
          (headers as any)['Prefer'] = 'return=representation';
          res = await fetch(
            `${REST_BASE}/budgets`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                user_id: userId,
                category: categoryName,
                limit_amount: newLimit,
                is_household: !appState.user?.budgetingSolo,
              }),
            },
          );
        }
        
        const body = await res.text();

        if (!res.ok) {
          const msg = `[saveBudgetLimit] ${recordExists ? 'update' : 'insert'} failed (${res.status}): ${body.slice(
            0,
            200,
          )}`;
          console.error(msg);
          setDbError(msg);
          
          // Rollback optimistic update
          setAppState(prev => ({
            ...prev,
            budgets: prev.budgets.map(b =>
              b.id === categoryId ? { ...b, totalLimit: previousLimit } : b,
            ),
          }));
        } else {
          // Verify that rows were actually modified
          let updatedRows: any[] = [];
          try {
            updatedRows = body ? JSON.parse(body) : [];
          } catch (parseErr) {
            const msg = `[saveBudgetLimit] failed to parse response: ${body.slice(0, 200)}`;
            console.error(msg);
            setDbError(msg);
            
            // Rollback optimistic update
            setAppState(prev => ({
              ...prev,
              budgets: prev.budgets.map(b =>
                b.id === categoryId ? { ...b, totalLimit: previousLimit } : b,
              ),
            }));
            return;
          }
          
          if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
            const msg = `[saveBudgetLimit] no rows ${recordExists ? 'updated' : 'inserted'} - operation failed silently`;
            console.error(msg);
            setDbError(msg);
            
            // Rollback optimistic update
            setAppState(prev => ({
              ...prev,
              budgets: prev.budgets.map(b =>
                b.id === categoryId ? { ...b, totalLimit: previousLimit } : b,
              ),
            }));
          } else {
            console.log(`[saveBudgetLimit] ${recordExists ? 'updated' : 'inserted'} OK`);
          }
        }
      } catch (err: any) {
        const msg = `[saveBudgetLimit] exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
        
        // Rollback optimistic update
        setAppState(prev => ({
          ...prev,
          budgets: prev.budgets.map(b =>
            b.id === categoryId ? { ...b, totalLimit: previousLimit } : b,
          ),
        }));
      }
    },
    [appState.user, appState.budgets, setAppState, setDbError],
  );

  // Save user monthly income to Supabase settings table
  const saveUserIncome = useCallback(
    async (income: number) => {
      const userId = appState.user?.id;
      const userName = appState.user?.name;
      const userEmail = appState.user?.email;
      
      if (!userId || !userName || !userEmail) {
        console.warn('[saveUserIncome] missing user data, skipping save');
        return;
      }

      // Store the previous value for rollback (with fallback to default if not set)
      const previousIncome = appState.user?.monthlyIncome ?? DEFAULT_MONTHLY_INCOME;

      // Optimistic UI update
      setAppState(prev => ({
        ...prev,
        user: prev.user ? { ...prev.user, monthlyIncome: income } : null,
      }));

      try {
        const headers = await getAuthHeaders();
        // Use POST with upsert to handle both insert and update cases
        // resolution=merge-duplicates will update if row exists (on conflict with primary key)
        (headers as any)['Prefer'] = 'return=representation,resolution=merge-duplicates';
        
        // Upsert to the settings table - will insert if missing or update if exists
        // Include required fields (name, email) for INSERT case
        const res = await fetch(
          `${REST_BASE}/settings`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
              user_id: userId, 
              name: userName,
              email: userEmail,
              monthly_income: income 
            }),
          },
        );
        
        if (!res.ok) {
          const body = await res.text();
          const msg = `[saveUserIncome] update failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          
          // Rollback optimistic update on failure
          setAppState(prev => ({
            ...prev,
            user: prev.user ? { ...prev.user, monthlyIncome: previousIncome } : null,
          }));
        } else {
          // Check if any rows were actually updated
          const body = await res.text();
          let updatedRows: any[] = [];
          try {
            updatedRows = body ? JSON.parse(body) : [];
          } catch (parseErr) {
            const msg = `[saveUserIncome] failed to parse response: ${body.slice(0, 200)}`;
            console.error(msg);
            setDbError(msg);
            
            // Rollback optimistic update
            setAppState(prev => ({
              ...prev,
              user: prev.user ? { ...prev.user, monthlyIncome: previousIncome } : null,
            }));
            return;
          }
          
          if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
            const msg = `[saveUserIncome] no rows updated - settings record may not exist for user ${userId}`;
            console.error(msg);
            setDbError(msg);
            
            // Rollback optimistic update
            setAppState(prev => ({
              ...prev,
              user: prev.user ? { ...prev.user, monthlyIncome: previousIncome } : null,
            }));
          } else {
            console.log(`[saveUserIncome] successfully updated to ${income}`);
          }
        }
      } catch (err: any) {
        const msg = `[saveUserIncome] exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
        
        // Rollback optimistic update on error
        setAppState(prev => ({
          ...prev,
          user: prev.user ? { ...prev.user, monthlyIncome: previousIncome } : null,
        }));
      }
    },
    [appState.user, setAppState, setDbError],
  );

  // Save theme to Supabase settings table
  const saveTheme = useCallback(
    async (theme: 'light' | 'dark') => {
      const userId = appState.user?.id;
      if (!userId) {
        console.warn('[saveTheme] no userId, skipping save');
        return;
      }

      // Store the previous value for rollback
      const previousTheme = appState.settings.theme;

      // Optimistic UI update
      setAppState(prev => ({
        ...prev,
        settings: { ...prev.settings, theme },
      }));

      try {
        const headers = await getAuthHeaders();
        const headersWithPrefer: Record<string, string> = {
          ...headers,
          'Prefer': 'return=representation',
        };
        
        // Update the settings table for this user
        const res = await fetch(
          `${REST_BASE}/settings?user_id=eq.${userId}`,
          {
            method: 'PATCH',
            headers: headersWithPrefer,
            body: JSON.stringify({ theme }),
          },
        );
        
        if (!res.ok) {
          const body = await res.text();
          const msg = `[saveTheme] update failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          
          // Rollback optimistic update on failure
          setAppState(prev => ({
            ...prev,
            settings: { ...prev.settings, theme: previousTheme },
          }));
        } else {
          console.log(`[saveTheme] successfully updated to ${theme}`);
        }
      } catch (err: any) {
        const msg = `[saveTheme] exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
        
        // Rollback optimistic update on error
        setAppState(prev => ({
          ...prev,
          settings: { ...prev.settings, theme: previousTheme },
        }));
      }
    },
    [appState.user, setAppState, setDbError],
  );

  // Add transaction
  const handleAddTransaction = useCallback(
    async (tx: Transaction) => {
      if (!categoriesLoaded) {
        setDbError('Cannot add transaction: categories not yet loaded');
        return;
      }

      // Optimistic update
      setAppState(prev => ({
        ...prev,
        transactions: [tx, ...prev.transactions],
      }));

      try {
        const row = toSupabaseTransaction(tx);
        console.log('[insert] payload:', JSON.stringify(row));

        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';

        const res = await fetch(`${REST_BASE}/transactions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(row),
        });
        const body = await res.text();
        console.log(
          '[insert] status:',
          res.status,
          'body:',
          body.slice(0, 300),
        );

        if (!res.ok) {
          const msg = `Insert failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          setAppState(prev => ({
            ...prev,
            transactions: prev.transactions.filter(t => t.id !== tx.id),
          }));
          return;
        }

        const data = JSON.parse(body);
        const saved = fromSupabaseTransaction(
          Array.isArray(data) ? data[0] : data,
        );
        console.log('[insert] OK, id:', saved.id);
        setAppState(prev => ({
          ...prev,
          transactions: prev.transactions.map(t =>
            t.id === tx.id ? saved : t,
          ),
        }));
      } catch (err: any) {
        const msg = `Insert exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
        setAppState(prev => ({
          ...prev,
          transactions: prev.transactions.filter(t => t.id !== tx.id),
        }));
      }
    },
    [
      categoriesLoaded,
      fromSupabaseTransaction,
      setAppState,
      setDbError,
      toSupabaseTransaction,
    ],
  );

  // Update transaction
  const handleUpdateTransaction = useCallback(
    async (updatedTx: Transaction) => {
      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.map(t =>
          t.id === updatedTx.id ? updatedTx : t,
        ),
      }));

      try {
        const row = toSupabaseTransaction(updatedTx);
        console.log(
          '[update] id:',
          updatedTx.id,
          'payload:',
          JSON.stringify(row),
        );

        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const res = await fetch(
          `${REST_BASE}/transactions?id=eq.${updatedTx.id}`,
          { method: 'PATCH', headers, body: JSON.stringify(row) },
        );
        const body = await res.text();
        console.log(
          '[update] status:',
          res.status,
          'body:',
          body.slice(0, 300),
        );

        if (!res.ok) {
          const msg = `Update failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
        } else {
          // Verify that rows were actually updated
          let updatedRows: any[] = [];
          try {
            updatedRows = body ? JSON.parse(body) : [];
          } catch (parseErr) {
            const msg = `[updateTransaction] failed to parse response: ${body.slice(0, 200)}`;
            console.error(msg);
            setDbError(msg);
            return;
          }
          
          if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
            const msg = `[updateTransaction] no rows updated for transaction ${updatedTx.id}`;
            console.error(msg);
            setDbError(msg);
          }
        }
      } catch (err: any) {
        const msg = `Update exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
      }
    },
    [setAppState, setDbError, toSupabaseTransaction],
  );

  // Delete transaction
  const handleDeleteTransaction = useCallback(
    async (id: string) => {
      const deletedTx = appState.transactions.find(t => t.id === id);

      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.filter(t => t.id !== id),
      }));

      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${REST_BASE}/transactions?id=eq.${id}`,
          { method: 'DELETE', headers },
        );

        if (!res.ok) {
          const body = await res.text();
          const msg = `Delete failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          if (deletedTx) {
            setAppState(prev => ({
              ...prev,
              transactions: [deletedTx, ...prev.transactions],
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
            transactions: [deletedTx, ...prev.transactions],
          }));
        }
      }
    },
    [appState.transactions, setAppState, setDbError],
  );

  // Approve a pending transaction (convert to actual transaction)
  const handleApprovePendingTransaction = useCallback(
    async (pendingId: string, categoryId: string) => {
      try {
        const userId = appState.user?.id;
        if (!userId) return;

        const pending = appState.pendingTransactions?.find(p => p.id === pendingId);
        if (!pending) {
          setDbError('Pending transaction not found');
          return;
        }

        // Create the actual transaction
        const newTransaction: Partial<Transaction> = {
          id: pendingId, // Use same ID for tracking
          user_id: userId,
          vendor: pending.extracted_vendor,
          amount: pending.extracted_amount,
          date: pending.extracted_timestamp,
          budget_id: categoryId,
          recurrence: 'One-time',
          label: 'Auto-Added',
          is_projected: false,
        };

        await handleAddTransaction(newTransaction as Transaction);

        // Mark pending transaction as reviewed and approved
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const res = await fetch(`${REST_BASE}/pending_transactions?id=eq.${pendingId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            needs_review: false,
            reviewed_at: new Date().toISOString(),
            approved: true,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          const msg = `[approvePending] PATCH failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }

        const body = await res.text();
        let updatedRows: any[] = [];
        try {
          updatedRows = body ? JSON.parse(body) : [];
        } catch (parseErr) {
          const msg = `[approvePending] failed to parse response: ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }
        
        if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
          const msg = `[approvePending] no rows updated for pending transaction ${pendingId}`;
          console.error(msg);
          setDbError(msg);
          return;
        }

        // Remove from pending list in UI
        setAppState(prev => ({
          ...prev,
          pendingTransactions: prev.pendingTransactions?.filter(p => p.id !== pendingId) || [],
        }));

        console.log('[approvePending] OK, approved pending transaction', pendingId);
      } catch (err: any) {
        const msg = `Approve pending exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
      }
    },
    [appState.user, appState.pendingTransactions, handleAddTransaction, setAppState, setDbError],
  );

  // Reject a pending transaction
  const handleRejectPendingTransaction = useCallback(
    async (pendingId: string) => {
      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';

        // Mark as reviewed and not approved
        const res = await fetch(`${REST_BASE}/pending_transactions?id=eq.${pendingId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            needs_review: false,
            reviewed_at: new Date().toISOString(),
            approved: false,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          const msg = `[rejectPending] PATCH failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }

        const body = await res.text();
        let updatedRows: any[] = [];
        try {
          updatedRows = body ? JSON.parse(body) : [];
        } catch (parseErr) {
          const msg = `[rejectPending] failed to parse response: ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }
        
        if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
          const msg = `[rejectPending] no rows updated for pending transaction ${pendingId}`;
          console.error(msg);
          setDbError(msg);
          return;
        }

        // Remove from pending list in UI
        setAppState(prev => ({
          ...prev,
          pendingTransactions: prev.pendingTransactions?.filter(p => p.id !== pendingId) || [],
        }));

        console.log('[rejectPending] OK, rejected pending transaction', pendingId);
      } catch (err: any) {
        const msg = `Reject pending exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
      }
    },
    [setAppState, setDbError],
  );

  return {
    categoriesLoaded,
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
  };
};
