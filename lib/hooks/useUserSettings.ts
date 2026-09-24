// lib/hooks/useUserSettings.ts
import { log } from '../log';
import { useCallback, useEffect, useRef } from 'react';
import { REST_BASE, getAuthHeaders, restFetch, DEFAULT_MONTHLY_INCOME } from '../apiHelpers';
import { persistSetting } from '../settings/persistSetting';
import { SettingSaveQueue, type SettingValue } from '../settings/settingSaveQueue';
import type { UseUserDataParams } from './types';

const parseRows = (body: string): unknown[] => {
  try {
    const rows: unknown = body ? JSON.parse(body) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

const saveErrorMessage = (error: unknown, operation: string): string => {
  if (error instanceof Error && error.message.startsWith(`[${operation}]`)) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return `[${operation}] exception: ${message}`;
};

interface BudgetRowChoice {
  limit: number;
  visible: boolean;
}

const parseBudgetRowChoice = (value: SettingValue): BudgetRowChoice => {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid queued budget row choice');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError('Invalid queued budget row choice');
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
    || !('limit' in parsed)
    || typeof parsed.limit !== 'number'
    || !('visible' in parsed)
    || typeof parsed.visible !== 'boolean'
  ) {
    throw new TypeError('Invalid queued budget row choice');
  }
  return { limit: parsed.limit, visible: parsed.visible };
};

const parseThemeChoice = (value: SettingValue): 'light' | 'dark' => {
  if (value === 'light' || value === 'dark') return value;
  throw new TypeError('Invalid queued theme choice');
};

async function persistBudgetRow(
  userId: string,
  categoryId: string,
  categoryName: string,
  budgetingSolo: boolean | undefined,
  choice: BudgetRowChoice,
  operation: 'saveBudgetLimit' | 'saveBudgetVisibility',
): Promise<void> {
  const headers = await getAuthHeaders();
  const patchHeaders: Record<string, string> = {
    ...headers,
    Prefer: 'return=representation',
  };
  const patchQueries = [
    `${REST_BASE}/budgets?user_uuid=eq.${userId}&budget=eq.${encodeURIComponent(categoryName)}`,
    `${REST_BASE}/budgets?user_id=eq.${userId}&category=eq.${encodeURIComponent(categoryName)}`,
    categoryId.startsWith('budget:')
      ? null
      : `${REST_BASE}/budgets?id=eq.${encodeURIComponent(categoryId)}`,
  ].filter((patchUrl): patchUrl is string => patchUrl !== null);

  let patchRes: Response | null = null;
  let patchBody = '';
  for (const patchUrl of patchQueries) {
    patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: patchHeaders,
      body: JSON.stringify({ amount: choice.limit, Visible: choice.visible }),
    });
    patchBody = await patchRes.text();
    if (patchRes.ok) break;

    patchRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: patchHeaders,
      body: JSON.stringify({
        limit_amount: choice.limit,
        visible: choice.visible,
        is_household: !budgetingSolo,
      }),
    });
    patchBody = await patchRes.text();
    if (patchRes.ok) break;
  }

  if (!patchRes || !patchRes.ok) {
    throw new Error(`[${operation}] PATCH failed (${patchRes?.status ?? 'unknown'}): ${patchBody.slice(0, 200)}`);
  }
  if (parseRows(patchBody).length > 0) {
    log.debug(`[${operation}] PATCH OK for ${categoryName}`);
    return;
  }

  const postHeaders: Record<string, string> = {
    ...headers,
    Prefer: 'return=representation',
  };
  let postRes = await fetch(`${REST_BASE}/budgets`, {
    method: 'POST',
    headers: postHeaders,
    body: JSON.stringify({
      user_uuid: userId,
      budget: categoryName,
      amount: choice.limit,
      Visible: choice.visible,
    }),
  });
  let postBody = await postRes.text();

  if (!postRes.ok) {
    postRes = await fetch(`${REST_BASE}/budgets`, {
      method: 'POST',
      headers: postHeaders,
      body: JSON.stringify({
        user_id: userId,
        category: categoryName,
        limit_amount: choice.limit,
        visible: choice.visible,
        is_household: !budgetingSolo,
      }),
    });
    postBody = await postRes.text();
  }

  if (!postRes.ok) {
    throw new Error(`[${operation}] INSERT failed (${postRes.status}): ${postBody.slice(0, 200)}`);
  }
  if (parseRows(postBody).length === 0) {
    throw new Error(`[${operation}] INSERT returned no rows`);
  }
  log.debug(`[${operation}] INSERT OK for ${categoryName}`);
}

export const useUserSettings = ({
  appState,
  setAppState,
  setDbError,
}: UseUserDataParams) => {
  const saveQueueRef = useRef(new SettingSaveQueue());
  const budgetRowChoicesRef = useRef(new Map<string, BudgetRowChoice>());
  useEffect(() => {
    saveQueueRef.current.clear();
  }, [appState.user?.id]);

  const currentHiddenCategories = appState.settings.hiddenCategories || [];
  if (appState.user?.id) {
    for (const budget of appState.budgets) {
      budgetRowChoicesRef.current.set(`${appState.user.id}:${budget.id}`, {
        limit: budget.totalLimit,
        visible: !currentHiddenCategories.includes(budget.id),
      });
    }
  }

  // Save a single budget limit for the current user
  const saveBudgetLimit = useCallback(
    async (categoryId: string, newLimit: number) => {
      const userId = appState.user?.id;
      if (!userId) {
        setDbError('Could not save this budget limit. Please try again.');
        return;
      }

      // Find the category name from the categoryId
      const category = appState.budgets.find(b => b.id === categoryId);
      if (!category) {
        log.error('[saveBudgetLimit] Category not found:', categoryId);
        setDbError('Could not save this budget limit. Please try again.');
        return;
      }
      const categoryName = category.name;
      const rowKey = `${userId}:${categoryId}`;
      const previousChoice = budgetRowChoicesRef.current.get(rowKey) ?? {
        limit: category.totalLimit,
        visible: !appState.settings.hiddenCategories?.includes(categoryId),
      };
      const nextChoice = { ...previousChoice, limit: newLimit };
      budgetRowChoicesRef.current.set(rowKey, nextChoice);

      // Optimistic UI update
      setAppState(prev => ({
        ...prev,
        budgets: prev.budgets.map(b =>
          b.id === categoryId ? { ...b, totalLimit: newLimit } : b,
        ),
      }));

      return saveQueueRef.current.enqueue({
        key: `budget-row:${userId}:${categoryId}`,
        value: JSON.stringify(nextChoice),
        previousValue: JSON.stringify(previousChoice),
        save: async (_key, serializedChoice) => {
          await persistBudgetRow(
            userId,
            categoryId,
            categoryName,
            appState.user?.budgetingSolo,
            parseBudgetRowChoice(serializedChoice),
            'saveBudgetLimit',
          );
        },
        onFailure: (lastSavedValue, error) => {
          const msg = saveErrorMessage(error, 'saveBudgetLimit');
          log.error(msg);
          setDbError(msg);
          const lastSavedChoice = parseBudgetRowChoice(lastSavedValue);
          budgetRowChoicesRef.current.set(rowKey, lastSavedChoice);
          setAppState(prev => {
            if (prev.user?.id !== userId) return prev;
            const hidden = prev.settings.hiddenCategories || [];
            const hiddenCategories = lastSavedChoice.visible
              ? hidden.filter(id => id !== categoryId)
              : hidden.includes(categoryId) ? hidden : [...hidden, categoryId];
            return {
              ...prev,
              budgets: prev.budgets.map(b =>
                b.id === categoryId ? { ...b, totalLimit: lastSavedChoice.limit } : b,
              ),
              settings: { ...prev.settings, hiddenCategories },
            };
          });
        },
      });
    },
    [appState.user, appState.budgets, appState.settings.hiddenCategories, setAppState, setDbError],
  );

  // Save user monthly income to Supabase settings table
  const saveUserIncome = useCallback(
    async (income: number) => {
      const userId = appState.user?.id;
      const userName = appState.user?.name;
      const userEmail = appState.user?.email;
      
      if (!userId) {
        log.warn('[saveUserIncome] missing userId, skipping save');
        setDbError('Could not save your monthly income. Please try again.');
        return;
      }

      // Store the previous value for rollback (with fallback to default if not set)
      const previousIncome = appState.user?.monthlyIncome ?? DEFAULT_MONTHLY_INCOME;

      // Optimistic UI update
      setAppState(prev => ({
        ...prev,
        user: prev.user ? { ...prev.user, monthlyIncome: income } : null,
      }));

      return saveQueueRef.current.enqueue({
        key: 'user-income',
        value: income,
        previousValue: previousIncome,
        save: async () => {
          // PATCH first — this only updates the columns we specify, so the
          // existing subscription_status value is preserved.
          const res = await restFetch(`/settings?user_id=eq.${userId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ monthly_income: income }),
          });

          let patchBody = '';
          let updatedRows: unknown[] = [];
          try {
            patchBody = await res.text();
            updatedRows = parseRows(patchBody);
          } catch {
            // A bad body cannot confirm a save; continue to the create fallback.
          }

          if (res.ok && updatedRows.length > 0) {
            log.debug(`[saveUserIncome] PATCH OK: ${income}`);
            return;
          }

          // No existing row — fall back to a full POST. subscription_status
          // stays unset so the database default remains in control.
          if (!res.ok) {
            log.warn(`[saveUserIncome] PATCH failed (${res.status}): ${patchBody.slice(0, 200)} — trying POST`);
          } else {
            log.warn('[saveUserIncome] PATCH matched 0 rows — trying POST');
          }

          if (!userName || !userEmail) {
            throw new Error('[saveUserIncome] Cannot create a settings row without the user name and email');
          }

          const postRes = await restFetch('/settings', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              user_id: userId,
              name: userName,
              email: userEmail,
              monthly_income: income,
            }),
          });

          if (!postRes.ok) {
            const body = await postRes.text();
            throw new Error(`[saveUserIncome] POST failed (${postRes.status}): ${body.slice(0, 200)}`);
          }

          const postBody = await postRes.text();
          if (parseRows(postBody).length === 0) {
            throw new Error('[saveUserIncome] POST returned no rows');
          }
          log.debug(`[saveUserIncome] POST OK: ${income}`);
        },
        onFailure: (lastSavedValue, error) => {
          const msg = saveErrorMessage(error, 'saveUserIncome');
          log.error(msg);
          setDbError(msg);
          setAppState(prev => {
            if (prev.user?.id !== userId || prev.user.monthlyIncome !== income) return prev;
            return {
              ...prev,
              user: { ...prev.user, monthlyIncome: Number(lastSavedValue) },
            };
          });
        },
      });
    },
    [appState.user, setAppState, setDbError],
  );

  // Save theme to Supabase settings table
  const saveTheme = useCallback(
    async (theme: 'light' | 'dark') => {
      const userId = appState.user?.id;
      if (!userId) {
        log.warn('[saveTheme] no userId, skipping save');
        setDbError('Could not save your theme choice. Please try again.');
        return;
      }

      // Store the previous value for rollback
      const previousTheme = appState.settings.theme;

      // Optimistic UI update
      setAppState(prev => ({
        ...prev,
        settings: { ...prev.settings, theme },
      }));

      return saveQueueRef.current.enqueue({
        key: 'theme',
        value: theme,
        previousValue: previousTheme,
        save: async () => {
          const res = await restFetch(`/settings?user_id=eq.${userId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({ theme_selected: theme }),
          });
          const body = await res.text();
          if (!res.ok || parseRows(body).length === 0) {
            const reason = res.ok
              ? 'update returned no settings row'
              : `update failed (${res.status})`;
            throw new Error(`[saveTheme] ${reason}: ${body.slice(0, 200)}`);
          }
          log.debug(`[saveTheme] successfully updated to ${theme}`);
        },
        onFailure: (lastSavedValue, error) => {
          const msg = saveErrorMessage(error, 'saveTheme');
          log.error(msg);
          setDbError(msg);
          setAppState(prev => {
            if (prev.user?.id !== userId || prev.settings.theme !== theme) return prev;
            return { ...prev, settings: { ...prev.settings, theme: parseThemeChoice(lastSavedValue) } };
          });
        },
      });
    },
    [appState.user, appState.settings.theme, setAppState, setDbError],
  );

  // Save budget visibility to Supabase budgets table
  const saveBudgetVisibility = useCallback(
    async (categoryId: string, visible: boolean) => {
      const userId = appState.user?.id;
      if (!userId) {
        setDbError('Could not save this budget visibility choice. Please try again.');
        return;
      }

      // Find the category name from the categoryId
      const category = appState.budgets.find(b => b.id === categoryId);
      if (!category) {
        log.error('[saveBudgetVisibility] Category not found:', categoryId);
        setDbError('Could not save this budget visibility choice. Please try again.');
        return;
      }
      const categoryName = category.name;
      const rowKey = `${userId}:${categoryId}`;
      const previousChoice = budgetRowChoicesRef.current.get(rowKey) ?? {
        limit: category.totalLimit,
        visible: !appState.settings.hiddenCategories?.includes(categoryId),
      };
      const nextChoice = { ...previousChoice, visible };
      budgetRowChoicesRef.current.set(rowKey, nextChoice);

      setAppState(prev => {
        const hidden = prev.settings.hiddenCategories || [];
        const nextHidden = visible
          ? hidden.filter(id => id !== categoryId)
          : hidden.includes(categoryId) ? hidden : [...hidden, categoryId];
        return { ...prev, settings: { ...prev.settings, hiddenCategories: nextHidden } };
      });

      return saveQueueRef.current.enqueue({
        key: `budget-row:${userId}:${categoryId}`,
        value: JSON.stringify(nextChoice),
        previousValue: JSON.stringify(previousChoice),
        save: async (_key, serializedChoice) => {
          await persistBudgetRow(
            userId,
            categoryId,
            categoryName,
            appState.user?.budgetingSolo,
            parseBudgetRowChoice(serializedChoice),
            'saveBudgetVisibility',
          );
        },
        onFailure: (lastSavedValue, error) => {
          const msg = saveErrorMessage(error, 'saveBudgetVisibility');
          log.error(msg);
          setDbError(msg);
          const lastSavedChoice = parseBudgetRowChoice(lastSavedValue);
          budgetRowChoicesRef.current.set(rowKey, lastSavedChoice);
          setAppState(prev => {
            if (prev.user?.id !== userId) return prev;
            const hidden = prev.settings.hiddenCategories || [];
            const nextHidden = lastSavedChoice.visible
              ? hidden.filter(id => id !== categoryId)
              : hidden.includes(categoryId) ? hidden : [...hidden, categoryId];
            return {
              ...prev,
              budgets: prev.budgets.map(b =>
                b.id === categoryId ? { ...b, totalLimit: lastSavedChoice.limit } : b,
              ),
              settings: { ...prev.settings, hiddenCategories: nextHidden },
            };
          });
        },
      });
    },
    [appState.user, appState.budgets, appState.settings.hiddenCategories, setAppState, setDbError],
  );

  // Save one setting to the person's settings row. A successful HTTP response
  // with no updated row is a failed save, not a saved choice.
  const saveSettingToDb = useCallback(
    async (dbKey: string, value: boolean | string | number) => {
      const userId = appState.user?.id;
      if (!userId) {
        throw new Error('No signed-in user to save this setting for.');
      }
      try {
        await persistSetting(userId, dbKey, value);
        log.debug(`[saveSettingToDb] ${dbKey} = ${value}`);
      } catch (error) {
        log.error('[saveSettingToDb] failed:', error);
        throw error;
      }
    },
    [appState.user],
  );

  return {
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
    saveSettingToDb,
  };
};
