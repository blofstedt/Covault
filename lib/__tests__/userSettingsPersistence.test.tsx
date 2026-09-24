// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../../types';

const apiMocks = vi.hoisted(() => ({
  REST_BASE: 'https://supabase.test/rest/v1',
  DEFAULT_MONTHLY_INCOME: 5000,
  getAuthHeaders: vi.fn(),
  restFetch: vi.fn(),
}));

vi.mock('../apiHelpers', () => apiMocks);

import { useUserSettings } from '../hooks/useUserSettings';

const createAppState = (): AppState => ({
  user: {
    id: 'user-1',
    name: 'Avery Example',
    email: 'avery@example.com',
    hasJointAccounts: false,
    budgetingSolo: true,
    monthlyIncome: 5000,
  },
  budgets: [
    { id: 'budget:Food', name: 'Food', totalLimit: 1000 },
    { id: 'budget:Transport', name: 'Transport', totalLimit: 400 },
  ],
  transactions: [],
  settings: {
    rolloverEnabled: true,
    rolloverOverspend: false,
    useLeisureAsBuffer: true,
    showSavingsInsight: true,
    theme: 'dark',
    notificationsEnabled: false,
    hiddenCategories: [],
    app_notifications_enabled: false,
    smart_notifications_enabled: true,
    auto_accept_known_vendors: false,
    haptics_enabled: true,
    community_rules_enabled: true,
    community_rules_contribute: false,
    shareLevel: 'transactions',
    budgetMode: 'separate',
  },
});

let container: HTMLDivElement;
let root: Root;
let state: AppState;
let actions: ReturnType<typeof useUserSettings>;
const setDbError = vi.fn<(message: string | null) => void>();

function Harness() {
  const [appState, setAppState] = useState(createAppState);
  state = appState;
  actions = useUserSettings({ appState, setAppState, setDbError });
  return null;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  apiMocks.getAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('user setting saves', () => {
  it('uses the income create fallback after reading a failed PATCH response once', async () => {
    apiMocks.restFetch
      .mockResolvedValueOnce(new Response('settings row is not ready', { status: 409 }))
      .mockResolvedValueOnce(Response.json([{ user_id: 'user-1', monthly_income: 8000 }]));

    await act(async () => actions.saveUserIncome(8000));

    expect(apiMocks.restFetch).toHaveBeenCalledTimes(2);
    expect(apiMocks.restFetch).toHaveBeenNthCalledWith(
      2,
      '/settings',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"monthly_income":8000') }),
    );
    expect(state.user?.monthlyIncome).toBe(8000);
    expect(setDbError).not.toHaveBeenCalled();
  });

  it('keeps rapid income changes in order when an earlier write fails', async () => {
    apiMocks.restFetch
      .mockResolvedValueOnce(new Response('settings row is not ready', { status: 409 }))
      .mockResolvedValueOnce(new Response('insert failed', { status: 500 }))
      .mockResolvedValueOnce(Response.json([{ user_id: 'user-1', monthly_income: 7000 }]));

    await act(async () => {
      const firstSave = actions.saveUserIncome(6000);
      const newerSave = actions.saveUserIncome(7000);
      await Promise.all([firstSave, newerSave]);
    });

    expect(apiMocks.restFetch).toHaveBeenCalledTimes(3);
    expect(state.user?.monthlyIncome).toBe(7000);
    expect(setDbError).not.toHaveBeenCalled();
  });

  it('rolls back a theme when the server confirms no settings row changed', async () => {
    apiMocks.restFetch.mockResolvedValueOnce(Response.json([]));

    await act(async () => actions.saveTheme('light'));

    expect(state.settings.theme).toBe('dark');
    expect(setDbError).toHaveBeenCalledWith(expect.stringContaining('no settings row'));
  });

  it('rolls back a new budget limit when the insert returns no row', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([], { status: 201 })));

    await act(async () => actions.saveBudgetLimit('budget:Food', 1500));

    expect(state.budgets[0].totalLimit).toBe(1000);
    expect(setDbError).toHaveBeenCalledWith('[saveBudgetLimit] INSERT returned no rows');
  });

  it('restores budget visibility when the insert returns no row', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([], { status: 201 })));

    await act(async () => actions.saveBudgetVisibility('budget:Food', false));

    expect(state.settings.hiddenCategories).toEqual([]);
    expect(setDbError).toHaveBeenCalledWith('[saveBudgetVisibility] INSERT returned no rows');
  });

  it('uses the alternate budget insert shape when visibility cannot find an existing row', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response('column not found', { status: 400 }))
      .mockResolvedValueOnce(Response.json([{ category: 'Food', visible: false }], { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => actions.saveBudgetVisibility('budget:Food', false));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://supabase.test/rest/v1/budgets',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"limit_amount":1000'),
      }),
    );
    expect(state.settings.hiddenCategories).toEqual(['budget:Food']);
    expect(setDbError).not.toHaveBeenCalled();
  });

  it('serializes limit and visibility changes to the same budget row without clobbering fields', async () => {
    let resolveFirstPatch: ((response: Response) => void) | undefined;
    const firstPatch = new Promise<Response>(resolve => { resolveFirstPatch = resolve; });
    const requestBodies: unknown[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body ?? '{}')));
      if (fetchMock.mock.calls.length === 1) return firstPatch;
      return Promise.resolve(Response.json([{ budget: 'Food' }]));
    });
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      const limitSave = actions.saveBudgetLimit('budget:Food', 1500);
      const visibilitySave = actions.saveBudgetVisibility('budget:Food', false);
      for (let attempt = 0; attempt < 8 && fetchMock.mock.calls.length === 0; attempt += 1) {
        await Promise.resolve();
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      resolveFirstPatch?.(Response.json([{ budget: 'Food', amount: 1500 }]));
      await Promise.all([limitSave, visibilitySave]);
    });

    expect(requestBodies).toEqual([
      { amount: 1500, Visible: true },
      { amount: 1500, Visible: false },
    ]);
    expect(state.budgets.find(budget => budget.id === 'budget:Food')?.totalLimit).toBe(1500);
    expect(state.settings.hiddenCategories).toEqual(['budget:Food']);
    expect(setDbError).not.toHaveBeenCalled();
  });

  it('retries a missing budget row with the latest combined limit and visibility choices', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response('first insert shape failed', { status: 400 }))
      .mockResolvedValueOnce(new Response('second insert shape failed', { status: 400 }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json([{ amount: 1500, Visible: false }], { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      const limitSave = actions.saveBudgetLimit('budget:Food', 1500);
      const visibilitySave = actions.saveBudgetVisibility('budget:Food', false);
      await Promise.all([limitSave, visibilitySave]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://supabase.test/rest/v1/budgets',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"amount":1500,"Visible":false'),
      }),
    );
    expect(state.budgets.find(budget => budget.id === 'budget:Food')?.totalLimit).toBe(1500);
    expect(state.settings.hiddenCategories).toEqual(['budget:Food']);
    expect(setDbError).not.toHaveBeenCalled();
  });

  it('restores both budget fields when every queued create attempt fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response('insert failed', { status: 400 }))
      .mockResolvedValueOnce(new Response('alternate insert failed', { status: 400 }))
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response('insert failed', { status: 400 }))
      .mockResolvedValueOnce(new Response('alternate insert failed', { status: 400 })));

    await act(async () => {
      const limitSave = actions.saveBudgetLimit('budget:Food', 1500);
      const visibilitySave = actions.saveBudgetVisibility('budget:Food', false);
      await Promise.all([limitSave, visibilitySave]);
    });

    expect(state.budgets.find(budget => budget.id === 'budget:Food')?.totalLimit).toBe(1000);
    expect(state.settings.hiddenCategories).toEqual([]);
    expect(setDbError).toHaveBeenCalledWith(expect.stringContaining('INSERT failed'));
  });

  it('does not let one category failure undo another category visibility save', async () => {
    let resolveFoodPatch: ((response: Response) => void) | undefined;
    const foodPatch = new Promise<Response>(resolve => { resolveFoodPatch = resolve; });
    let foodCallCount = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('eq.Food')) {
        foodCallCount += 1;
        return foodCallCount === 1
          ? foodPatch
          : Promise.resolve(new Response('legacy columns missing', { status: 400 }));
      }
      return Promise.resolve(Response.json([{ budget: 'Transport', visible: false }]));
    }));

    await act(async () => {
      const foodSave = actions.saveBudgetVisibility('budget:Food', false);
      const transportSave = actions.saveBudgetVisibility('budget:Transport', false);
      await transportSave;
      resolveFoodPatch?.(new Response('write failed', { status: 400 }));
      await foodSave;
    });

    expect(state.settings.hiddenCategories).toEqual(['budget:Transport']);
    expect(setDbError).toHaveBeenCalledWith(expect.stringContaining('PATCH failed (400)'));
  });
});
