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

// Default budget limits by category name (fallbacks)
const DEFAULT_LIMITS: Record<string, number> = {
  Housing: 1500,
  Groceries: 600,
  Transport: 300,
  Utilities: 150,
  Leisure: 400,
  Other: 100,
};

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
          // start with default limits; user-specific overrides will be loaded separately
          totalLimit: DEFAULT_LIMITS[row.name] || 500,
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

  // NEW: Load user budget limits from user_budgets
  const loadUserBudgets = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${REST_BASE}/user_budgets?select=*&user_id=eq.${userId}`,
          { headers },
        );
        const body = await res.text();

        if (!res.ok) {
          console.error('[loadUserBudgets] failed:', body.slice(0, 200));
          return;
        }

        const rows = JSON.parse(body);

        // Map category_id → total_limit
        const limitsByCategory: Record<string, number> = {};
        for (const row of rows) {
          limitsByCategory[row.category_id] = Number(row.total_limit);
        }

        // Merge with existing categories in state
        setAppState(prev => ({
          ...prev,
          budgets: prev.budgets.map(b => ({
            ...b,
            totalLimit: limitsByCategory[b.id] ?? b.totalLimit ?? 0,
          })),
        }));

        console.log('[loadUserBudgets] loaded:', limitsByCategory);
      } catch (err: any) {
        console.error('[loadUserBudgets] exception:', err?.message || err);
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

  // Load partner link status from linked_partners table
  const loadPartnerLink = useCallback(
    async (userId: string) => {
      try {
        const headers = await getAuthHeaders();

        const res = await fetch(
          `${REST_BASE}/linked_partners?select=*,partner:settings!linked_partners_partner_id_fkey(name,email),requester:settings!linked_partners_user_id_fkey(name,email)&or=(user_id.eq.${userId},partner_id.eq.${userId})&status=eq.accepted&limit=1`,
          { headers },
        );

        if (!res.ok) {
          const res2 = await fetch(
            `${REST_BASE}/linked_partners?select=*&or=(user_id.eq.${userId},partner_id.eq.${userId})&status=eq.accepted&limit=1`,
            { headers },
          );
          if (res2.ok) {
            const data = JSON.parse(await res2.text());
            if (data && data.length > 0) {
              const link = data[0];
              const partnerId =
                link.user_id === userId ? link.partner_id : link.user_id;
              setAppState(prev => ({
                ...prev,
                user: prev.user
                  ? { ...prev.user, budgetingSolo: false, partnerId }
                  : null,
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
            user: prev.user
              ? {
                  ...prev.user,
                  budgetingSolo: false,
                  partnerId,
                  partnerName: partnerInfo?.name || undefined,
                  partnerEmail: partnerInfo?.email || undefined,
                }
              : null,
          }));

          await loadTransactions(partnerId);
        }
      } catch (err: any) {
        console.error('[loadPartnerLink]', err?.message || err);
      }
    },
    [loadTransactions, setAppState],
  );

  // Load all data from Supabase
  const loadUserData = useCallback(
    async (userId: string) => {
      console.log('loadUserData called for user:', userId);
      await loadCategories();
      await loadUserBudgets(userId); // NEW: load user-specific limits
      await loadTransactions(userId);
      await loadPartnerLink(userId);
      console.log('loadUserData completed');
    },
    [loadCategories, loadPartnerLink, loadTransactions, loadUserBudgets],
  );

  // Send a partner link request by email
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
        if (!userId || partnerId === userId) {
          setDbError("You can't link with yourself.");
          return;
        }

        (headers as any)['Prefer'] = 'return=representation';
        const insertRes = await fetch(`${REST_BASE}/linked_partners`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id: userId,
            partner_id: partnerId,
            status: 'accepted',
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

  // Disconnect partner
  const handleUnlinkPartner = useCallback(async () => {
    try {
      const userId = appState.user?.id;
      if (!userId) return;

      const headers = await getAuthHeaders();
      await fetch(
        `${REST_BASE}/linked_partners?or=(user_id.eq.${userId},partner_id.eq.${userId})`,
        { method: 'DELETE', headers },
      );

      setAppState(prev => ({
        ...prev,
        user: prev.user
          ? {
              ...prev.user,
              budgetingSolo: true,
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

  // NEW: Save a single budget limit for the current user
  const saveBudgetLimit = useCallback(
    async (categoryId: string, newLimit: number) => {
      const userId = appState.user?.id;
      if (!userId) return;

      // Optimistic UI update
      setAppState(prev => ({
        ...prev,
        budgets: prev.budgets.map(b =>
          b.id === categoryId ? { ...b, totalLimit: newLimit } : b,
        ),
      }));

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';

        const payload = {
          user_id: userId,
          category_id: categoryId,
          total_limit: newLimit,
        };

        const res = await fetch(`${REST_BASE}/user_budgets`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const body = await res.text();

        if (!res.ok) {
          const msg = `[saveBudgetLimit] failed (${res.status}): ${body.slice(
            0,
            200,
          )}`;
          console.error(msg);
          setDbError(msg);
        } else {
          console.log('[saveBudgetLimit] OK');
        }
      } catch (err: any) {
        const msg = `[saveBudgetLimit] exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
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

  return {
    categoriesLoaded,
    loadUserData,
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleLinkPartner,
    handleUnlinkPartner,
    saveBudgetLimit, // NEW: expose this to the UI
  };
};
