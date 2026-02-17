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

  // Load budgets from Supabase (replaces both loadCategories and loadUserBudgets)
  // The budgets table now serves as both categories and per-user budget limits.
  const loadCategories = useCallback(async () => {
    // Categories are now loaded as part of loadUserBudgets; mark as loaded immediately
    setCategoriesLoaded(true);
  }, []);

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

  // Load user budgets from budgets table (this is now the single source of truth for categories)
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
          if (res.status === 404 && body.includes('Could not find the table')) {
            console.log('[loadUserBudgets] budgets table not found - using defaults');
            setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
            setCategoriesLoaded(true);
            return;
          }
          console.error('[loadUserBudgets] failed:', body.slice(0, 200));
          setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
          setCategoriesLoaded(true);
          return;
        }

        const rows = JSON.parse(body);

        // Ensure all default budgets exist in the table
        const existingCategories = new Set<string>(rows.map((r: any) => r.category));
        await ensureDefaultBudgets(userId, existingCategories);

        // If we just seeded new budgets, re-fetch to get their IDs
        let finalRows = rows;
        if (SYSTEM_CATEGORIES.some(sc => !existingCategories.has(sc.name))) {
          const refetchRes = await fetch(
            `${REST_BASE}/budgets?select=*&user_id=eq.${userId}`,
            { headers },
          );
          if (refetchRes.ok) {
            finalRows = JSON.parse(await refetchRes.text());
          }
        }

        // Build budgets directly from the budgets table rows
        const hiddenCategoryIds: string[] = [];
        const budgets: BudgetCategory[] = finalRows.map((row: any) => {
          if (row.visible === false) {
            hiddenCategoryIds.push(row.id);
          }
          return {
            id: row.id,
            name: row.category,
            totalLimit: Number(row.limit_amount) || 0,
          };
        });

        // Ensure all system categories are present (fallback for newly seeded ones)
        const loadedNames = new Set(budgets.map(b => b.name));
        for (const sysCat of SYSTEM_CATEGORIES) {
          if (!loadedNames.has(sysCat.name)) {
            budgets.push({ ...sysCat });
          }
        }

        setAppState(prev => ({
          ...prev,
          budgets,
          settings: {
            ...prev.settings,
            hiddenCategories: hiddenCategoryIds,
          },
        }));

        console.log('[loadUserBudgets] loaded:', budgets.map(b => ({ id: b.id, name: b.name, limit: b.totalLimit })));
        setCategoriesLoaded(true);
      } catch (err: any) {
        console.error('[loadUserBudgets] exception:', err?.message || err);
        setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
        setCategoriesLoaded(true);
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

  // Load household link status from settings table (partner_id field)
  const loadHouseholdLink = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();

        // Check if the user has a partner_id set in their settings
        const res = await fetch(
          `${REST_BASE}/settings?select=partner_id,partner_name,partner_email,has_joint_accounts&user_id=eq.${userId}&limit=1`,
          { headers },
        );

        if (!res.ok) {
          console.log('[loadHouseholdLink] Could not load settings');
          return;
        }

        const body = await res.text();
        const data = JSON.parse(body);
        if (data && data.length > 0 && data[0].partner_id) {
          const partnerId = data[0].partner_id;
          const partnerName = data[0].partner_name;

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
