// lib/hooks/useUserSettings.ts
import { useCallback } from 'react';
import { REST_BASE, getAuthHeaders, DEFAULT_MONTHLY_INCOME } from '../apiHelpers';
import type { UseUserDataParams } from './types';

export const useUserSettings = ({
  appState,
  setAppState,
  setDbError,
}: UseUserDataParams) => {

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
        
        // Use upsert with on_conflict to handle both insert and update in one call
        // resolution=merge-duplicates will update existing row if (user_id, category) already exists
        (headers as any)['Prefer'] = 'return=representation,resolution=merge-duplicates';
        const res = await fetch(
          `${REST_BASE}/budgets?on_conflict=user_id,category`,
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
        
        const body = await res.text();

        if (!res.ok) {
          const msg = `[saveBudgetLimit] upsert failed (${res.status}): ${body.slice(
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
            const msg = `[saveBudgetLimit] no rows upserted - operation failed silently`;
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
            console.log(`[saveBudgetLimit] upserted OK`);
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
        const missing = [];
        if (!userId) missing.push('userId');
        if (!userName) missing.push('userName');
        if (!userEmail) missing.push('userEmail');
        console.warn(`[saveUserIncome] missing user data: ${missing.join(', ')}, skipping save`);
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
        // PostgREST upsert requires all NOT NULL fields (name, email) even for updates
        // These fields won't overwrite existing data in UPDATE case as they're part of the user record
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

  // Save budget visibility to Supabase budgets table
  const saveBudgetVisibility = useCallback(
    async (categoryId: string, visible: boolean) => {
      const userId = appState.user?.id;
      if (!userId) return;

      // Find the category name from the categoryId
      const category = appState.budgets.find(b => b.id === categoryId);
      if (!category) {
        console.error('[saveBudgetVisibility] Category not found:', categoryId);
        return;
      }
      const categoryName = category.name;

      // Store previous hidden state for rollback
      const previousHidden: string[] = (appState.settings as any).hiddenCategories || [];

      // Optimistic UI update: toggle hiddenCategories
      const rollback = () => {
        setAppState(prev => ({
          ...prev,
          settings: { ...prev.settings, hiddenCategories: previousHidden },
        }));
      };

      setAppState(prev => {
        const currentHidden: string[] = (prev.settings as any).hiddenCategories || [];
        const nextHidden = visible
          ? currentHidden.filter((id: string) => id !== categoryId)
          : [...currentHidden, categoryId];
        return {
          ...prev,
          settings: { ...prev.settings, hiddenCategories: nextHidden },
        };
      });

      try {
        const headers = await getAuthHeaders();

        // Use upsert with on_conflict to handle both insert and update in one call
        // resolution=merge-duplicates will update existing row if (user_id, category) already exists
        (headers as any)['Prefer'] = 'return=representation,resolution=merge-duplicates';
        const res = await fetch(
          `${REST_BASE}/budgets?on_conflict=user_id,category`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              user_id: userId,
              category: categoryName,
              limit_amount: category.totalLimit,
              visible,
            }),
          },
        );

        if (!res.ok) {
          const body = await res.text();
          console.error('[saveBudgetVisibility] upsert failed:', body.slice(0, 200));
          setDbError(`[saveBudgetVisibility] upsert failed (${res.status})`);
          rollback();
        } else {
          console.log(`[saveBudgetVisibility] upserted ${categoryName} visible=${visible}`);
        }
      } catch (err: any) {
        const msg = `[saveBudgetVisibility] exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
        rollback();
      }
    },
    [appState.user, appState.budgets, appState.settings, setAppState, setDbError],
  );

  return {
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
  };
};
