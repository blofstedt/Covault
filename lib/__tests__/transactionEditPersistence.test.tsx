// @vitest-environment happy-dom
/**
 * An edit is only on screen if the database kept it.
 *
 * PostgREST answers an UPDATE that matched no row with a 200 and an empty
 * list — a row this account may not change (a partner's purchase), or one that
 * was deleted a moment ago. The save path used to raise an error for that and
 * then carry on as if it had worked: the edit stayed on screen, the row was
 * marked reviewed and the vendor was remembered under its new name, while the
 * database still held the old values. A request that never completed at all
 * left the edit on screen the same way. The next reload quietly undid both.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Transaction } from '../../types';

const apiMocks = vi.hoisted(() => ({ restFetch: vi.fn() }));
const memoryMocks = vi.hoisted(() => ({
  markReviewQueueStatus: vi.fn(),
  upsertVendorMapEntry: vi.fn(),
}));

vi.mock('../apiHelpers', () => apiMocks);
vi.mock('../localNotificationMemory', () => memoryMocks);
vi.mock('../vendorOverrideWrite', () => ({ persistVendorOverride: vi.fn() }));
vi.mock('../covaultNotification', () => ({ clearCaptureNotificationForRows: vi.fn() }));

import { useTransactionOps } from '../hooks/useTransactionOps';

const ORIGINAL: Transaction = {
  id: 'tx-1',
  user_id: 'user-1',
  vendor: 'Safeway',
  amount: 42,
  date: '2026-09-10T12:00:00.000Z',
  budget_id: 'budget:groceries',
  is_projected: false,
  label: 'Manual',
  userName: 'Avery',
} as Transaction;

const EDITED: Transaction = { ...ORIGINAL, amount: 24 };

const createAppState = (): AppState => ({
  user: {
    id: 'user-1',
    name: 'Avery',
    email: 'avery@example.com',
    hasJointAccounts: false,
    budgetingSolo: true,
    monthlyIncome: 5000,
  },
  budgets: [{ id: 'budget:groceries', name: 'Groceries', totalLimit: 500 }],
  transactions: [ORIGINAL],
  settings: {} as AppState['settings'],
});

let container: HTMLDivElement;
let root: Root;
let state: AppState;
let ops: ReturnType<typeof useTransactionOps>;
const setDbError = vi.fn<(message: string | null) => void>();

function Harness() {
  const [appState, setAppState] = useState(createAppState);
  state = appState;
  ops = useTransactionOps({ appState, setAppState, setDbError, categoriesLoaded: true });
  return null;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function edit(): Promise<boolean> {
  let result = true;
  await act(async () => {
    result = await ops.handleUpdateTransaction(EDITED);
  });
  return result;
}

describe('saving an edit', () => {
  it('keeps the edit when the database returns the changed row', async () => {
    apiMocks.restFetch.mockResolvedValueOnce(Response.json([{ id: 'tx-1', amount: 24 }]));

    expect(await edit()).toBe(true);
    expect(state.transactions[0].amount).toBe(24);
    expect(setDbError).not.toHaveBeenCalled();
    expect(memoryMocks.markReviewQueueStatus).toHaveBeenCalledWith('tx-1', 'reviewed');
  });

  it('undoes the edit when the database changed no row, and says so', async () => {
    apiMocks.restFetch.mockResolvedValueOnce(Response.json([]));

    expect(await edit()).toBe(false);
    expect(state.transactions[0].amount).toBe(42);
    expect(setDbError).toHaveBeenCalledWith('That change could not be saved. Please try again.');
    // Nothing downstream may act as though it saved.
    expect(memoryMocks.markReviewQueueStatus).not.toHaveBeenCalled();
    expect(memoryMocks.upsertVendorMapEntry).not.toHaveBeenCalled();
  });

  it('undoes the edit when the request never completes', async () => {
    apiMocks.restFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await edit()).toBe(false);
    expect(state.transactions[0].amount).toBe(42);
    expect(setDbError).toHaveBeenCalled();
  });

  it('undoes the edit when the database refuses it', async () => {
    apiMocks.restFetch.mockResolvedValueOnce(new Response('permission denied', { status: 403 }));

    expect(await edit()).toBe(false);
    expect(state.transactions[0].amount).toBe(42);
  });
});
