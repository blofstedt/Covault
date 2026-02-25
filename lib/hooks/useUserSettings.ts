// lib/hooks/useUserSettings.ts
import { useCallback, useRef } from 'react';
import { REST_BASE, getAuthHeaders, DEFAULT_MONTHLY_INCOME } from '../apiHelpers';
import type { UseUserDataParams } from './types';

export const useUserSettings = ({
  appState,
  setAppState,
  setDbError,
}: UseUserDataParams) => {

  // Always-current ref for hiddenCategories, used for rollback in saveBudgetVisibility
  // to avoid stale closure values when the useCallback captures old appState
  const hiddenCategoriesRef = useRef<string[]>([]);
  hiddenCategoriesRef.current = appState.settings.hiddenCategories || [];

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

      // Get current visibility state (true if NOT in hiddenCategories)
      const hiddenCategories = appState.settings.hiddenCategories || [];
      const visible = !hiddenCategories.includes(categoryId);

      // Optimistic UI update
      setAppState(prev => ({
        ...prev,
        budgets: prev.budgets.map(b =>
          b.id === categoryId ? { ...b, totalLimit: newLimit } : b,
        ),
      }));

      const rollback = () => {
        setAppState(prev => ({
          ...prev,
          budgets: prev.budgets.map(b =>
            b.id === categoryId ? { ...b, totalLimit: previousLimit } : b,
          ),
        }));
      };

      try {
        const headers = await getAuthHeaders();

        // First try PATCH (update) on existing row — this works regardless of unique constraints
        const patchHeaders: Record<string, string> = {
          ...headers,
          'Prefer': 'return=representation',
        };
        let patchRes = await fetch(
          `${REST_BASE}/budgets?id=eq.${encodeURIComponent(categoryId)}`,
          {
            method: 'PATCH',
            headers: patchHeaders,
            body: JSON.stringify({ amount: newLimit, Visible: visible }),
          },
        );

        let patchBody = await patchRes.text();

        if (!patchRes.ok) {
          patchRes = await fetch(
            `${REST_BASE}/budgets?id=eq.${encodeURIComponent(categoryId)}`,
            {
              method: 'PATCH',
              headers: patchHeaders,
              body: JSON.stringify({
                limit_amount: newLimit,
                visible,
                is_household: !appState.user?.budgetingSolo,
              }),
            },
          );
          patchBody = await patchRes.text();
        }

        if (!patchRes.ok) {
          const msg = `[saveBudgetLimit] PATCH failed (${patchRes.status}): ${patchBody.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          rollback();
          return;
        }

        // Check if any rows were updated
        let updatedRows: any[] = [];
        try {
          updatedRows = patchBody ? JSON.parse(patchBody) : [];
        } catch {
          updatedRows = [];
        }

        if (Array.isArray(updatedRows) && updatedRows.length > 0) {
          console.log(`[saveBudgetLimit] PATCH OK for ${categoryName}`);
          return;
        }

        // No existing row found — INSERT a new one
        const postHeaders: Record<string, string> = {
          ...headers,
          'Prefer': 'return=representation',
        };
        let postRes = await fetch(
          `${REST_BASE}/budgets`,
          {
            method: 'POST',
            headers: postHeaders,
            body: JSON.stringify({
              user_uuid: userId,
              budget: categoryName,
              amount: newLimit,
              Visible: visible,
            }),
          },
        );

        let postBody = await postRes.text();

        if (!postRes.ok) {
          postRes = await fetch(
            `${REST_BASE}/budgets`,
            {
              method: 'POST',
              headers: postHeaders,
              body: JSON.stringify({
                user_id: userId,
                category: categoryName,
                limit_amount: newLimit,
                visible,
                is_household: !appState.user?.budgetingSolo,
              }),
            },
          );
          postBody = await postRes.text();
        }

        if (!postRes.ok) {
          const msg = `[saveBudgetLimit] INSERT failed (${postRes.status}): ${postBody.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          rollback();
        } else {
          console.log(`[saveBudgetLimit] INSERT OK for ${categoryName}`);
        }
      } catch (err: any) {
        const msg = `[saveBudgetLimit] exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
        rollback();
      }
    },
    [appState.user, appState.budgets, appState.settings, setAppState, setDbError],
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
            body: JSON.stringify({ theme_selected: theme }),
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

      // Optimistic UI update: toggle hiddenCategories
      // Read current hidden state from the always-current ref
      // to avoid stale closure values causing the rollback to restore wrong state
      const previousHidden = [...hiddenCategoriesRef.current];
      const nextHidden = visible
        ? previousHidden.filter((id: string) => id !== categoryId)
        : [...previousHidden, categoryId];

      setAppState(prev => ({
        ...prev,
        settings: { ...prev.settings, hiddenCategories: nextHidden },
      }));

      const rollback = () => {
        setAppState(prev => ({
          ...prev,
          settings: { ...prev.settings, hiddenCategories: previousHidden },
        }));
      };

      try {
        const headers = await getAuthHeaders();

        // Use PATCH to update existing row (avoids dependency on unique constraints)
        const patchHeaders: Record<string, string> = {
          ...headers,
          'Prefer': 'return=representation',
        };
        let patchRes = await fetch(
          `${REST_BASE}/budgets?id=eq.${encodeURIComponent(categoryId)}`,
          {
            method: 'PATCH',
            headers: patchHeaders,
            body: JSON.stringify({ amount: category.totalLimit, Visible: visible }),
          },
        );

        let patchBody = await patchRes.text();

        if (!patchRes.ok) {
          patchRes = await fetch(
            `${REST_BASE}/budgets?id=eq.${encodeURIComponent(categoryId)}`,
            {
              method: 'PATCH',
              headers: patchHeaders,
              body: JSON.stringify({
                limit_amount: category.totalLimit,
                visible,
                is_household: !appState.user?.budgetingSolo,
              }),
            },
          );
          patchBody = await patchRes.text();
        }

        if (!patchRes.ok) {
          console.error('[saveBudgetVisibility] PATCH failed:', patchBody.slice(0, 200));
          setDbError(`[saveBudgetVisibility] PATCH failed (${patchRes.status})`);
          rollback();
          return;
        }

        // Check if any rows were updated
        let updatedRows: any[] = [];
        try {
          updatedRows = patchBody ? JSON.parse(patchBody) : [];
        } catch {
          updatedRows = [];
        }

        if (Array.isArray(updatedRows) && updatedRows.length > 0) {
          console.log(`[saveBudgetVisibility] PATCH OK ${categoryName} visible=${visible}`);
          return;
        }

        // No existing row — INSERT
        const postHeaders: Record<string, string> = {
          ...headers,
          'Prefer': 'return=representation',
        };
        const postRes = await fetch(
          `${REST_BASE}/budgets`,
          {
            method: 'POST',
            headers: postHeaders,
            body: JSON.stringify({
              user_uuid: userId,
              budget: categoryName,
              amount: category.totalLimit,
              Visible: visible,
            }),
          },
        );

        if (!postRes.ok) {
          const postBody = await postRes.text();
          console.error('[saveBudgetVisibility] INSERT failed:', postBody.slice(0, 200));
          setDbError(`[saveBudgetVisibility] INSERT failed (${postRes.status})`);
          rollback();
        } else {
          console.log(`[saveBudgetVisibility] INSERT OK ${categoryName} visible=${visible}`);
        }
      } catch (err: any) {
        const msg = `[saveBudgetVisibility] exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
        rollback();
      }
    },
    [appState.user, appState.budgets, setAppState, setDbError],
  );

  return {
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
  };
};
