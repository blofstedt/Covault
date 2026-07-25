// lib/hooks/useDataLoading.ts
import { log } from '../log';
import { useCallback, useState } from 'react';
import { SYSTEM_CATEGORIES } from '../../constants';
import type { BudgetCategory, Transaction, PendingTransaction } from '../../types';
import { REST_BASE, getAuthHeaders, restFetch, DEFAULT_MONTHLY_INCOME } from '../apiHelpers';
import { useFromSupabaseTransaction } from './transactionMappers';
import { deduplicatePendingTransactions } from '../notificationProcessor';
import type { UseUserDataParams } from './types';

/** Merge incoming transactions into existing ones, deduplicating by ID. */
function mergeTransactions(existing: Transaction[], incoming: Transaction[]): Transaction[] {
  const incomingIds = new Set(incoming.map(t => t.id));
  return [...existing.filter(t => !incomingIds.has(t.id)), ...incoming];
}

const toBudgetId = (row: any): string => {
  if (row?.id !== undefined && row?.id !== null) return String(row.id);
  const name = (row?.category || row?.budget || 'other').toString().toLowerCase();
  return `budget:${name}`;
};

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

        const newRows = missing.map(sc => ({
          user_uuid: userId,
          budget: sc.name,
          amount: sc.totalLimit,
          Visible: true,
        }));

        (headers as any)['Prefer'] = 'return=representation,resolution=ignore-duplicates';
        let res = await fetch(`${REST_BASE}/budgets?on_conflict=user_uuid,budget`, {
          method: 'POST',
          headers,
          body: JSON.stringify(newRows),
        });

        if (!res.ok) {
          // Fallback for alternate schema column names
          const altRows = missing.map(sc => ({
            user_id: userId,
            category: sc.name,
            limit_amount: sc.totalLimit,
            visible: true,
          }));
          res = await fetch(`${REST_BASE}/budgets?on_conflict=user_id,category`, {
            method: 'POST',
            headers,
            body: JSON.stringify(altRows),
          });
        }

        if (!res.ok) {
          const body = await res.text();
          log.error('[ensureDefaultBudgets] insert failed:', body.slice(0, 200));
        } else {
          log.debug('[ensureDefaultBudgets] inserted', missing.length, 'default budgets');
        }
      } catch (err: any) {
        log.error('[ensureDefaultBudgets] exception:', err?.message || err);
      }
    },
    [],
  );

  // Load user budgets from budgets table (this is now the single source of truth for categories)
  const loadUserBudgets = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();
        let res = await fetch(
          `${REST_BASE}/budgets?select=*&user_uuid=eq.${userId}`,
          { headers },
        );

        if (!res.ok) {
          res = await fetch(
            `${REST_BASE}/budgets?select=*&user_id=eq.${userId}`,
            { headers },
          );
        }
        const body = await res.text();

        if (!res.ok) {
          if (res.status === 404 && body.includes('Could not find the table')) {
            log.debug('[loadUserBudgets] budgets table not found - using defaults');
            setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
            setCategoriesLoaded(true);
            return;
          }
          log.error('[loadUserBudgets] failed:', body.slice(0, 200));
          setAppState(prev => ({ ...prev, budgets: SYSTEM_CATEGORIES }));
          setCategoriesLoaded(true);
          return;
        }

        const rows = JSON.parse(body);

        // Ensure all default budgets exist in the table
        const existingCategories = new Set<string>(rows.map((r: any) => r.category || r.budget).filter(Boolean));
        await ensureDefaultBudgets(userId, existingCategories);

        // If we just seeded new budgets, re-fetch to get their IDs
        let finalRows = rows;
        if (SYSTEM_CATEGORIES.some(sc => !existingCategories.has(sc.name))) {
          let refetchRes = await fetch(
            `${REST_BASE}/budgets?select=*&user_uuid=eq.${userId}`,
            { headers },
          );
          if (!refetchRes.ok) {
            refetchRes = await fetch(
              `${REST_BASE}/budgets?select=*&user_id=eq.${userId}`,
              { headers },
            );
          }
          if (refetchRes.ok) {
            finalRows = JSON.parse(await refetchRes.text());
          }
        }

        // Build budgets directly from the budgets table rows
        const hiddenCategoryIds: string[] = [];
        const budgets: BudgetCategory[] = finalRows.map((row: any) => {
          const isVisible = row.visible ?? row.Visible ?? true;
          if (isVisible === false) {
            hiddenCategoryIds.push(toBudgetId(row));
          }

          return {
            id: toBudgetId(row),
            name: row.category || row.budget || 'Other',
            totalLimit: Number(row.limit_amount ?? row.amount) || 0,
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

        log.debug('[loadUserBudgets] loaded:', budgets.map(b => ({ id: b.id, name: b.name, limit: b.totalLimit })));
        setCategoriesLoaded(true);
      } catch (err: any) {
        log.error('[loadUserBudgets] exception:', err?.message || err);
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
        const res = await restFetch(
          `/settings?select=monthly_income,theme_selected,trial_started_at,trial_ends_at,trial_consumed,subscription_status,rollover_enabled,leisure_buffer_enabled,show_savings_insight,app_notifications_enabled,budgeting_solo&user_id=eq.${userId}`,
          { cache: 'no-store' }, // Prevent caching to always get fresh data
        );
        
        if (!res.ok) {
          log.error('[loadUserSettings] failed:', res.status);
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
          const theme = rows[0].theme_selected || 'light';

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
                  // Only use DB value if partner_id hasn't already set budgetingSolo=false
                  budgetingSolo: prev.user.budgetingSolo === false
                    ? false
                    : (rows[0].budgeting_solo ?? prev.user.budgetingSolo),
                }
              : null,
            settings: {
              ...prev.settings,
              theme: theme as 'light' | 'dark',
              rolloverEnabled: rows[0].rollover_enabled ?? prev.settings.rolloverEnabled,
              useLeisureAsBuffer: rows[0].leisure_buffer_enabled ?? prev.settings.useLeisureAsBuffer,
              showSavingsInsight: rows[0].show_savings_insight ?? prev.settings.showSavingsInsight,
              app_notifications_enabled: rows[0].app_notifications_enabled ?? prev.settings.app_notifications_enabled,
            },
          }));

          log.debug(
            shouldUseDefault
              ? '[loadUserSettings] monthly_income missing, using default:'
              : '[loadUserSettings] loaded monthly_income:',
            monthlyIncome,
          );
          log.debug('[loadUserSettings] loaded theme:', theme);
        } else {
          // No settings row exists (shouldn't happen with trigger, but handle it)
          // Use default value only in this case
          log.debug('[loadUserSettings] no settings row found, using default:', DEFAULT_MONTHLY_INCOME);
          setAppState(prev => ({
            ...prev,
            user: prev.user
              ? { ...prev.user, monthlyIncome: DEFAULT_MONTHLY_INCOME }
              : null,
          }));
        }
      } catch (err: any) {
        log.error('[loadUserSettings] exception:', err?.message || err);
      }
    },
    [setAppState],
  );

  // Load transactions from Supabase via raw fetch
  // When merge is true, new transactions are appended to existing ones (used for partner data)
  const loadTransactions = useCallback(
    async (userId: string, { merge = false }: { merge?: boolean } = {}) => {
      try {
        const res = await restFetch(
          `/transactions?select=*&user_id=eq.${userId}&order=date.desc`,
        );
        const body = await res.text();
        log.debug(
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
          log.error(msg);
          setDbError(msg);
          return;
        }

        const data = JSON.parse(body);
        if (data && data.length > 0) {
          const transactions: Transaction[] = [];
          for (const row of data) {
            try {
              transactions.push(fromSupabaseTransaction(row));
            } catch (mapErr: any) {
              log.warn('[loadTransactions] Skipping invalid row:', row?.id, mapErr?.message);
            }
          }

          log.debug('[loadTransactions] OK, count:', transactions.length);
          setAppState(prev => {
            const mergedTransactions = merge
              ? mergeTransactions(prev.transactions, transactions)
              : transactions;
            return { ...prev, transactions: mergedTransactions };
          });
        } else {
          log.debug('[loadTransactions] no transactions found');
          if (!merge) {
            setAppState(prev => ({ ...prev, transactions: [] }));
          }
        }
      } catch (err: any) {
        const msg = `Load transactions exception: ${err?.message || err}`;
        log.error(msg);
        setDbError(msg);
      }
    },
    [fromSupabaseTransaction, setAppState, setDbError],
  );

  // Load pending transactions awaiting approval
  const loadPendingTransactions = useCallback(
    async (userId: string) => {
      try {
        const res = await restFetch(
          `/pending_transactions?select=*&user_id=eq.${userId}&status=eq.pending&order=created_at.desc`,
        );

        if (!res.ok) {
          // Check if table doesn't exist (expected during initial setup)
          const body = await res.text();
          if (res.status === 404 && body.includes('Could not find the table')) {
            log.debug('[loadPendingTransactions] table not found - using defaults (run schema.sql to create tables)');
            setAppState(prev => ({ ...prev, pendingTransactions: [] }));
            return;
          }
          log.debug('[loadPendingTransactions] failed or no pending transactions');
          return;
        }

        const data: PendingTransaction[] = JSON.parse(await res.text());
        if (data && data.length > 0) {
          // Second-phase dedup: remove any duplicates that slipped through
          const deduped = await deduplicatePendingTransactions(data);
          log.debug('[loadPendingTransactions] OK, count:', deduped.length);
          setAppState(prev => ({ ...prev, pendingTransactions: deduped }));
        } else {
          log.debug('[loadPendingTransactions] no pending transactions');
          setAppState(prev => ({ ...prev, pendingTransactions: [] }));
        }
      } catch (err: any) {
        log.error('[loadPendingTransactions]', err?.message || err);
      }
    },
    [setAppState],
  );

  // Load household link status from settings table (partner_id field)
  const loadHouseholdLink = useCallback(
    async (userId: string) => {
      try {
        // Check if the user has a partner_id set in their settings
        const res = await restFetch(
          `/settings?select=partner_id,partner_name,partner_email&user_id=eq.${userId}&limit=1`,
        );

        if (!res.ok) {
          log.debug('[loadHouseholdLink] Could not load settings');
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
        log.error('[loadHouseholdLink]', err?.message || err);
      }
    },
    [loadTransactions, setAppState],
  );

  // Load all data from Supabase
  const loadUserData = useCallback(
    async (userId: string) => {
      log.debug('loadUserData called for user:', userId);
      await loadCategories();

      // These four are mutually independent: each uses a functional
      // setAppState updater and they touch disjoint keys (budgets +
      // hiddenCategories / user + theme / transactions / pendingTransactions).
      // Running them serially cost four round-trips for no ordering benefit.
      await Promise.all([
        loadUserBudgets(userId), // user-specific budget limits
        loadUserSettings(userId), // monthly_income, theme, trial flags
        loadTransactions(userId),
        loadPendingTransactions(userId), // awaiting approval
      ]);

      // Must stay after loadTransactions: it merges the partner's rows onto
      // the list that call populates. It must also stay after
      // loadUserSettings, which reads budgetingSolo and defers to the
      // `=== false` this call sets.
      await loadHouseholdLink(userId);
      log.debug('loadUserData completed');
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
