// @vitest-environment happy-dom
import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Transaction } from '../../../app/types';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  handler: undefined as ((event: string, session: unknown) => void) | undefined,
}));

const api = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(async () => ({})),
  restFetch: vi.fn(),
  callRpc: vi.fn(),
}));

vi.mock('../../../app/lib/api/supabase', () => ({ supabase: { auth } }));
vi.mock('../../../app/lib/api/apiHelpers', () => ({
  clearCachedAccessToken: vi.fn(),
  setCachedAccessToken: vi.fn(),
  getAuthHeaders: api.getAuthHeaders,
  restFetch: api.restFetch,
  callRpc: api.callRpc,
  REST_BASE: 'https://supabase.example.test/rest/v1',
  DEFAULT_MONTHLY_INCOME: 3000,
}));
vi.mock('../../../app/hooks/onboardingState', () => ({ shouldShowOnboarding: () => false }));
vi.mock('../../../app/lib/time/serverClock', () => ({ syncServerClock: vi.fn(async () => undefined) }));

import { useAuthState } from '../../../app/hooks/useAuthState';
import { useFirstPaintCache } from '../../../app/hooks/useFirstPaintCache';
import { useDataLoading } from '../../../app/data/useDataLoading';
import { useTransactionOps } from '../../../app/data/useTransactionOps';
import { clearFirstPaintCache, readFirstPaintCache } from '../../../app/lib/cache/firstPaintCache';
import { queryClient } from '../../../app/lib/cache/queryClient';
import { SYSTEM_CATEGORIES } from '../../../app/constants';
import { DEFAULT_SETTINGS } from '../../../app/lib/settings/defaultSettings';
import type { AccountDataScopeRef } from '../../../app/lib/auth/accountScope';

const transaction = (id: string, userId: string): Transaction => ({
  id,
  user_id: userId,
  vendor: `Private shop ${id}`,
  amount: 75,
  date: '2026-10-01',
  budget_id: 'budget:groceries',
  label: 'Manual',
  is_projected: false,
  created_at: '2026-10-01T12:00:00.000Z',
});

const user = (id: string) => ({
  id,
  name: `User ${id}`,
  email: `${id}@example.test`,
  hasJointAccounts: false,
  budgetingSolo: true,
  monthlyIncome: 4800,
});

const session = (id: string) => ({
  access_token: `token-${id}`,
  user: { id, email: `${id}@example.test`, user_metadata: { onboarded: true } },
});

const initialState = (): AppState => ({
  user: { ...user('account-a'), hasJointAccounts: true, partnerId: 'partner-a' },
  budgets: [{ id: 'budget:private-a', name: 'A private category', totalLimit: 725 }],
  transactions: [transaction('private-a-row', 'account-a')],
  partnerIncome: 2200,
  partnerSummary: { level: 'totals', total: 310, byCategory: { Groceries: 310 } },
  partnerBudgets: [{ id: 'partner:budget-a', name: 'Partner A category', totalLimit: 400 }],
  settings: {
    ...DEFAULT_SETTINGS,
    theme: 'light',
    notificationsEnabled: true,
    hiddenCategories: ['budget:private-a'],
    auto_accept_known_vendors: true,
    shareLevel: 'totals',
    budgetMode: 'combined',
  },
});

function mountAuthHarness() {
  const loadUserData = vi.fn(async (_userId: string, _scope?: unknown) => undefined);
  const scopeRef: AccountDataScopeRef = { current: { userId: 'account-a', generation: 1 } };
  const hook = renderHook(() => {
    const [appState, setAppState] = useState(initialState);
    const [authState, setAuthState] = useState<'loading' | 'unauthenticated' | 'onboarding' | 'authenticated'>('loading');
    useAuthState({
      setAppState,
      setAuthState,
      loadUserData,
      accountScopeRef: scopeRef,
    });
    useFirstPaintCache(appState, scopeRef);
    return { appState, authState };
  });
  return { ...hook, loadUserData, scopeRef };
}

const response = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function mountDataHarness(scopeRef: AccountDataScopeRef) {
  const hook = renderHook(() => {
    const [appState, setAppState] = useState(initialState);
    const { loadUserData, loadTransactions } = useDataLoading({
      setAppState,
      setDbError: vi.fn(),
      accountScopeRef: scopeRef,
    });
    useFirstPaintCache(appState, scopeRef);
    return { appState, setAppState, loadUserData, loadTransactions };
  });
  return hook;
}

function mountTransactionOpsHarness(scopeRef: AccountDataScopeRef) {
  const hook = renderHook(() => {
    const [appState, setAppState] = useState(initialState);
    const operations = useTransactionOps({
      appState,
      setAppState,
      setDbError: vi.fn(),
      categoriesLoaded: true,
      accountScopeRef: scopeRef,
    });
    return { appState, setAppState, ...operations };
  });
  return hook;
}

describe('account-scoped app data', () => {
  beforeEach(() => {
    vi.useRealTimers();
    auth.getSession.mockReset();
    auth.onAuthStateChange.mockReset();
    auth.signOut.mockReset();
    auth.handler = undefined;
    auth.getSession.mockResolvedValue({ data: { session: session('account-a') } });
    auth.onAuthStateChange.mockImplementation((callback) => {
      auth.handler = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    queryClient.clear();
    clearFirstPaintCache();
    api.getAuthHeaders.mockReset().mockResolvedValue({});
    api.restFetch.mockReset();
    api.callRpc.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => response([])));
  });

  afterEach(() => {
    vi.useRealTimers();
    clearFirstPaintCache();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it('clears the previous account data in the same update that signs in a different user', async () => {
    const { result, loadUserData } = mountAuthHarness();
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.appState.user?.id).toBe('account-a');
    expect(result.current.appState.transactions.map((row) => row.id)).toEqual(['private-a-row']);

    act(() => auth.handler?.('SIGNED_IN', session('account-b')));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.appState.user?.id).toBe('account-b');
    expect(result.current.appState.transactions).toEqual([]);
    expect(result.current.appState.budgets).toEqual([]);
    expect(result.current.appState.partnerIncome).toBeNull();
    expect(result.current.appState.partnerSummary).toBeNull();
    expect(result.current.appState.partnerBudgets).toBeNull();
    expect(result.current.appState.settings).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
      notificationsEnabled: true,
    });
    expect(loadUserData).toHaveBeenCalledWith('account-b', {
      userId: 'account-b',
      generation: 2,
    });
  });

  it('clears cached screen data when the active account signs out', async () => {
    const { result } = mountAuthHarness();
    await act(async () => { await Promise.resolve(); });
    const rulesKey = ['notification-rules', 'account-a'];
    queryClient.setQueryData(rulesKey, [{ id: 'private-rule-a' }]);

    act(() => auth.handler?.('SIGNED_OUT', null));

    expect(result.current.appState.user).toBeNull();
    expect(queryClient.getQueryData(rulesKey)).toBeUndefined();
  });

  it('does not write account A transactions into account B first-paint storage', async () => {
    vi.useFakeTimers();
    const { result } = mountAuthHarness();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => auth.handler?.('SIGNED_OUT', null));
    act(() => auth.handler?.('SIGNED_IN', session('account-b')));
    expect(result.current.appState.user?.id).toBe('account-b');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(readFirstPaintCache('account-b')).toBeNull();
  });

  it('keeps B empty when B data reads fail after the account switch', async () => {
    const { result, loadUserData } = mountAuthHarness();
    await act(async () => { await Promise.resolve(); });
    loadUserData.mockImplementation(async (userId: string) => {
      if (userId === 'account-b') throw new Error('temporary read failure');
    });

    act(() => auth.handler?.('SIGNED_IN', session('account-b')));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.appState.user?.id).toBe('account-b');
    expect(result.current.appState.transactions).toEqual([]);
    expect(result.current.appState.budgets).toEqual([]);
    expect(result.current.appState.partnerIncome).toBeNull();
    expect(result.current.appState.partnerSummary).toBeNull();
    expect(result.current.appState.partnerBudgets).toBeNull();
  });

  it('uses a new generation when the same account signs back in after another account', async () => {
    const { loadUserData, scopeRef } = mountAuthHarness();
    await act(async () => { await Promise.resolve(); });

    act(() => auth.handler?.('SIGNED_IN', session('account-b')));
    await act(async () => { await Promise.resolve(); });
    const accountBGeneration = scopeRef.current.generation;
    act(() => auth.handler?.('SIGNED_IN', session('account-a')));
    await act(async () => { await Promise.resolve(); });

    expect(accountBGeneration).toBe(2);
    expect(scopeRef.current).toEqual({ userId: 'account-a', generation: 3 });
    expect(loadUserData.mock.calls.map(([id, scope]) => [id, (scope as { generation: number }).generation]))
      .toEqual([['account-a', 1], ['account-b', 2], ['account-a', 3]]);
  });

  it('ignores a startup session that resolves after a newer sign-in event', async () => {
    const initialSession = deferred<{ data: { session: ReturnType<typeof session> } }>();
    auth.getSession.mockReturnValue(initialSession.promise);
    const { result, loadUserData, scopeRef } = mountAuthHarness();

    act(() => auth.handler?.('SIGNED_IN', session('account-b')));
    await act(async () => { await Promise.resolve(); });
    initialSession.resolve({ data: { session: session('account-a') } });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.appState.user?.id).toBe('account-b');
    expect(scopeRef.current.userId).toBe('account-b');
    expect(loadUserData.mock.calls.map(([id]) => id)).toEqual(['account-b']);
  });

  it('does not apply a late transaction response from A after the visible account changes to B', async () => {
    const oldRows = deferred<ReturnType<typeof response>>();
    const scopeRef: AccountDataScopeRef = { current: { userId: 'account-a', generation: 1 } };
    api.restFetch.mockImplementation((path: string) => {
      if (path.includes('user_id=eq.account-a')) return oldRows.promise;
      if (path.includes('user_id=eq.account-b')) return Promise.resolve(response([
        { ...transaction('private-b-row', 'account-b'), vendor_name: 'B shop' },
      ]));
      return Promise.resolve(response([]));
    });

    const { result } = mountDataHarness(scopeRef);
    let oldLoad!: Promise<void>;
    await act(async () => {
      oldLoad = result.current.loadTransactions('account-a', { scope: scopeRef.current });
      scopeRef.current = { userId: 'account-b', generation: 2 };
      result.current.setAppState(prev => ({
        ...prev,
        user: user('account-b'),
        budgets: [],
        transactions: [],
        partnerIncome: null,
        partnerSummary: null,
        partnerBudgets: null,
      }));
      await result.current.loadTransactions('account-b', { scope: scopeRef.current });
    });
    oldRows.resolve(response([{ ...transaction('private-a-late', 'account-a') }]));
    await act(async () => oldLoad);

    expect(result.current.appState.transactions.map(row => row.id)).toEqual(['private-b-row']);
  });

  it('does not apply a late partner summary from A after the account changes to B', async () => {
    const partnerSummary = deferred<{ ok: boolean; data: unknown }>();
    const scopeRef: AccountDataScopeRef = { current: { userId: 'account-a', generation: 1 } };
    api.restFetch.mockImplementation((path: string) => {
      if (path.startsWith('/transactions')) return Promise.resolve(response([]));
      if (path.includes('partner_id,partner_name,partner_email')) {
        return Promise.resolve(response([{ partner_id: 'partner-a', partner_name: 'Partner A' }]));
      }
      if (path.includes('monthly_income')) return Promise.resolve(response([{
        monthly_income: 4800, theme_selected: 'light', budgeting_solo: false,
      }]));
      if (path.startsWith('/budgets')) return Promise.resolve(response([]));
      return Promise.resolve(response([]));
    });
    api.callRpc.mockImplementation((name: string) => {
      if (name === 'partner_month_summary') return partnerSummary.promise;
      if (name === 'partner_monthly_income') return Promise.resolve({ ok: true, data: 5200 });
      return Promise.resolve({ ok: false, data: null });
    });
    vi.stubGlobal('fetch', vi.fn(async () => response(SYSTEM_CATEGORIES.map(category => ({
      id: category.id,
      budget: category.name,
      amount: category.totalLimit,
      visible: true,
    })))));

    const { result } = mountDataHarness(scopeRef);
    let loadA!: Promise<void>;
    await act(async () => {
      loadA = result.current.loadUserData('account-a', scopeRef.current);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.callRpc).toHaveBeenCalledWith('partner_month_summary', expect.anything());

    act(() => {
      scopeRef.current = { userId: 'account-b', generation: 2 };
      result.current.setAppState(prev => ({
        ...prev,
        user: user('account-b'),
        budgets: [],
        transactions: [],
        partnerIncome: null,
        partnerSummary: null,
        partnerBudgets: null,
      }));
    });
    partnerSummary.resolve({ ok: true, data: { level: 'totals', total: 999, byCategory: {} } });
    await act(async () => loadA);

    expect(result.current.appState.user?.id).toBe('account-b');
    expect(result.current.appState.partnerIncome).toBeNull();
    expect(result.current.appState.partnerSummary).toBeNull();
    expect(result.current.appState.partnerBudgets).toBeNull();
  });

  it('does not apply late settings or budget reads from A after the account changes to B', async () => {
    const oldSettings = deferred<ReturnType<typeof response>>();
    const oldBudgets = deferred<ReturnType<typeof response>>();
    const scopeRef: AccountDataScopeRef = { current: { userId: 'account-a', generation: 1 } };
    api.restFetch.mockImplementation((path: string) => {
      if (path.startsWith('/transactions')) return Promise.resolve(response([]));
      if (path.includes('monthly_income')) return oldSettings.promise;
      return Promise.resolve(response([]));
    });
    vi.stubGlobal('fetch', vi.fn(() => oldBudgets.promise));

    const { result } = mountDataHarness(scopeRef);
    let loadA!: Promise<void>;
    act(() => {
      loadA = result.current.loadUserData('account-a', scopeRef.current);
    });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      scopeRef.current = { userId: 'account-b', generation: 2 };
      result.current.setAppState(prev => ({
        ...prev,
        user: user('account-b'),
        budgets: [{ id: 'budget:b', name: 'B budget', totalLimit: 900 }],
        transactions: [transaction('private-b-row', 'account-b')],
        settings: { ...DEFAULT_SETTINGS, shareLevel: 'categories' },
      }));
    });
    oldSettings.resolve(response([{
      monthly_income: 12345,
      theme_selected: 'dark',
      share_level: 'totals',
      budget_mode: 'combined',
    }]));
    oldBudgets.resolve(response([{ id: 'budget:a', budget: 'A budget', amount: 1 }]));
    await act(async () => loadA);

    expect(result.current.appState.user?.id).toBe('account-b');
    expect(result.current.appState.user?.monthlyIncome).toBe(4800);
    expect(result.current.appState.budgets.map(budget => budget.id)).toEqual(['budget:b']);
    expect(result.current.appState.settings.shareLevel).toBe('categories');
  });

  it('keeps current-account transactions visible when the read fails', async () => {
    const scopeRef: AccountDataScopeRef = { current: { userId: 'account-a', generation: 1 } };
    api.restFetch.mockResolvedValue(response({ message: 'temporary failure' }, false, 503));
    const { result } = mountDataHarness(scopeRef);

    await act(async () => {
      await result.current.loadTransactions('account-a', { scope: scopeRef.current });
    });

    expect(result.current.appState.transactions.map(row => row.id)).toEqual(['private-a-row']);
  });

  it('does not restore a successfully added A transaction after the visible account changes to B', async () => {
    const responseA = deferred<ReturnType<typeof response>>();
    const scopeRef: AccountDataScopeRef = { current: { userId: 'account-a', generation: 1 } };
    api.restFetch.mockReturnValue(responseA.promise);
    const { result } = mountTransactionOpsHarness(scopeRef);
    const added = { ...transaction('private-a-added', 'account-a'), budget_id: 'budget:private-a' };
    let addPromise!: Promise<void>;
    act(() => { addPromise = result.current.handleAddTransaction(added); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.appState.transactions.some(row => row.id === added.id)).toBe(true);

    act(() => {
      scopeRef.current = { userId: 'account-b', generation: 2 };
      result.current.setAppState(prev => ({
        ...prev,
        user: user('account-b'),
        budgets: [],
        transactions: [transaction('private-b-row', 'account-b')],
      }));
    });
    responseA.resolve(response([{
      id: added.id,
      user_id: 'account-a',
      vendor: added.vendor,
      amount: added.amount,
      date: added.date,
      budget: 'A private category',
      type: 'Manual',
      is_projected: false,
    }]));
    await act(async () => addPromise);

    expect(result.current.appState.transactions.map(row => row.id)).toEqual(['private-b-row']);
  });

  it('does not restore A transactions when an A delete fails after the account changes to B', async () => {
    const deleteResponse = deferred<ReturnType<typeof response>>();
    const scopeRef: AccountDataScopeRef = { current: { userId: 'account-a', generation: 1 } };
    api.restFetch.mockReturnValue(deleteResponse.promise);
    const { result } = mountTransactionOpsHarness(scopeRef);
    let deletePromise!: Promise<unknown>;
    act(() => { deletePromise = result.current.handleDeleteTransaction('private-a-row'); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.appState.transactions).toEqual([]);

    act(() => {
      scopeRef.current = { userId: 'account-b', generation: 2 };
      result.current.setAppState(prev => ({
        ...prev,
        user: user('account-b'),
        transactions: [transaction('private-b-row', 'account-b')],
      }));
    });
    deleteResponse.resolve(response({ message: 'temporary failure' }, false, 503));
    await act(async () => { await deletePromise; });

    expect(result.current.appState.transactions.map(row => row.id)).toEqual(['private-b-row']);
  });
});
