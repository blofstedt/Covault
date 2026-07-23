import { describe, expect, it, vi } from 'vitest';

// lib/supabase.ts reads `localStorage` at module load time (inside
// createClient's auth config). Vitest runs in Node, which has no
// `localStorage` by default, so we stub one before any module that
// transitively imports supabase.ts gets evaluated. ES module imports
// are hoisted, so the stub has to be installed via vi.hoisted to
// run before the import statements resolve.
vi.hoisted(() => {
  let store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  });
});

import {
  buildPersistedUpdateTransaction,
  getSourceTransactionIdFromProjectedId,
} from '../hooks/useTransactionOps';

describe('projected transaction update helpers', () => {
  it('extracts source transaction id from projected ids', () => {
    expect(
      getSourceTransactionIdFromProjectedId(
        'projected-ca0c348c-6451-4ca2-ae5d-4afb7958d263-2026-03-28',
      ),
    ).toBe('ca0c348c-6451-4ca2-ae5d-4afb7958d263');
  });

  it('returns null for non-projected ids', () => {
    expect(getSourceTransactionIdFromProjectedId('ca0c348c-6451-4ca2-ae5d-4afb7958d263')).toBeNull();
  });

  it('maps projected edits onto the persisted recurring transaction', () => {
    const sourceTx: any = {
      id: 'ca0c348c-6451-4ca2-ae5d-4afb7958d263',
      vendor: 'Amazon',
      amount: 10.49,
      date: '2026-02-28T12:00:00.000Z',
      budget_id: 'other-budget-id',
      recurrence: 'Monthly',
      label: 'Manual',
      user_id: 'user-1',
      userName: 'me',
      is_projected: false,
      created_at: '2026-02-28T12:00:00.000Z',
    };

    const projectedEdit: any = {
      ...sourceTx,
      id: 'projected-ca0c348c-6451-4ca2-ae5d-4afb7958d263-2026-03-28',
      budget_id: 'services-budget-id',
      date: '2026-03-28',
      is_projected: true,
    };

    const persisted = buildPersistedUpdateTransaction(projectedEdit, sourceTx);

    expect(persisted.id).toBe(sourceTx.id);
    expect(persisted.date).toBe(sourceTx.date);
    expect(persisted.budget_id).toBe('services-budget-id');
    expect(persisted.is_projected).toBe(false);
  });
});
