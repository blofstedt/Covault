// lib/hooks/useDataLoading.ts
import { useCallback, useState } from 'react';
import { SYSTEM_CATEGORIES } from '../../constants';
import type { BudgetCategory, Transaction, PendingTransaction } from '../../types';
import { REST_BASE, getAuthHeaders, DEFAULT_BUDGET_LIMIT, DEFAULT_MONTHLY_INCOME } from '../apiHelpers';
import { useFromSupabaseTransaction } from './transactionMappers';
import { deduplicatePendingTransactions } from '../notificationProcessor';
import type { UseUserDataParams } from './types';

/** Merge incoming transactions into existing ones, deduplicating by ID. */
function mergeTransactions(existing: Transaction[], incoming: Transaction[]): Transaction[] {
  const incomingIds = new Set(incoming.map(t => t.id));
  return [...existing.filter(t => !incomingIds.has(t.id)), ...incoming];
}

export const useDataLoading = ({
  setAppState,
  setDbError,
}: Pick<UseUserDataParams, 'setAppState' | 'setDbError'>) => {
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const fromSupabaseTransaction = useFromSupabaseTransaction();

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

        // Ensure all system categories are present (e.g. Services)
        const loadedNames = new Set(budgets.map(b => b.name));
        for (const sysCat of SYSTEM_CATEGORIES) {
          if (!loadedNames.has(sysCat.name)) {
            budgets.push({ ...sysCat });
          }
        }

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

  // Ensure all default budgets exist in the budgets table for this user
  const ensureDefaultBudgets = useCallback(
    async (userId: string, existingCategories: Set<string>) => {
      try {
        const headers = await getAuthHeaders();
        const missing = SYSTEM_CATEGORIES.filter(sc => !existingCategories.has(sc.name));
        if (missing.length === 0) return;

        const rows = missing.map(sc => ({
          user_id: userId,
          category: sc.name,
          limit_amount: sc.totalLimit,
          visible: true,
        }));

        // Use upsert with on_conflict to avoid creating duplicate rows
        // resolution=ignore-duplicates will skip rows that already exist for (user_id, category)
        (headers as any)['Prefer'] = 'return=representation,resolution=ignore-duplicates';
        const res = await fetch(`${REST_BASE}/budgets?on_conflict=user_id,category`, {
          method: 'POST',
          headers,
          body: JSON.stringify(rows),
        });

        if (!res.ok) {
          const body = await res.text();
          console.error('[ensureDefaultBudgets] insert failed:', body.slice(0, 200));
        } else {
          console.log('[ensureDefaultBudgets] inserted', missing.length, 'default budgets');
        }
      } catch (err: any) {
        console.error('[ensureDefaultBudgets] exception:', err?.message || err);
      }
    },
    [],
  );

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

        // Ensure all default budgets exist in the table
        const existingCategories = new Set<string>(rows.map((r: any) => r.category));
        await ensureDefaultBudgets(userId, existingCategories);

        // Map category name → limit_amount and hidden categories in a single pass
        const limitsByCategory: Record<string, number> = {};
        const hiddenCategoryNames = new Set<string>();
        for (const row of rows) {
          limitsByCategory[row.category] = Number(row.limit_amount);
          if (row.visible === false) {
            hiddenCategoryNames.add(row.category);
          }
        }

        // Merge with existing categories in state and build hidden list
        setAppState(prev => {
          const updatedBudgets = prev.budgets.map(b => ({
            ...b,
            totalLimit: limitsByCategory[b.name] ?? b.totalLimit ?? 0,
          }));

          // Build hidden categories list by matching names to budget IDs
          const hiddenCategoryIds = updatedBudgets
            .filter(b => hiddenCategoryNames.has(b.name))
            .map(b => b.id);

          return {
            ...prev,
            budgets: updatedBudgets,
            settings: {
              ...prev.settings,
              hiddenCategories: hiddenCategoryIds,
            },
          };
        });

        console.log('[loadUserBudgets] loaded:', limitsByCategory, 'hidden:', Array.from(hiddenCategoryNames));
      } catch (err: any) {
        console.error('[loadUserBudgets] exception:', err?.message || err);
      }
    },
    [setAppState, ensureDefaultBudgets],
  );

  // Load user settings from Supabase (monthly_income, etc.)
  const loadUserSettings = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${REST_BASE}/settings?select=monthly_income,theme,trial_started_at,trial_ends_at,trial_consumed,subscription_status&user_id=eq.${userId}`,
          { 
            headers,
            cache: 'no-store' // Prevent caching to always get fresh data
          },
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

          // Load trial/subscription fields
          const trial_started_at = rows[0].trial_started_at || null;
          const trial_ends_at = rows[0].trial_ends_at || null;
          const trial_consumed = rows[0].trial_consumed ?? false;
          const subscription_status = rows[0].subscription_status || 'none';

          setAppState(prev => ({
            ...prev,
            user: prev.user
              ? {
                  ...prev.user,
                  monthlyIncome,
                  trial_started_at,
                  trial_ends_at,
                  trial_consumed,
                  subscription_status,
                }
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
  // When merge is true, new transactions are appended to existing ones (used for partner data)
  const loadTransactions = useCallback(
    async (userId: string, { merge = false }: { merge?: boolean } = {}) => {
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
          setAppState(prev => {
            const mergedTransactions = merge
              ? mergeTransactions(prev.transactions, transactions)
              : transactions;
            return { ...prev, transactions: mergedTransactions };
          });
        } else {
          console.log('[loadTransactions] no transactions found');
          if (!merge) {
            setAppState(prev => ({ ...prev, transactions: [] }));
          }
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
          `${REST_BASE}/pending_transactions?select=*&user_id=eq.${userId}&status=eq.pending&order=created_at.desc`,
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

        const data: PendingTransaction[] = JSON.parse(await res.text());
        if (data && data.length > 0) {
          // Second-phase dedup: remove any duplicates that slipped through
          const deduped = await deduplicatePendingTransactions(userId, data);
          console.log('[loadPendingTransactions] OK, count:', deduped.length);
          setAppState(prev => ({ ...prev, pendingTransactions: deduped }));
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

          // Load partner's transactions and merge with existing user transactions
          await loadTransactions(partnerId, { merge: true });
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

  return {
    categoriesLoaded,
    loadUserData,
    loadPendingTransactions,
    loadTransactions,
  };
};
