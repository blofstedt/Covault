import { describe, expect, it } from 'vitest';
import { normalizeTransactions } from '../useNormalizedTransactions';

describe('normalizeTransactions', () => {
  it('falls back orphaned transaction budget IDs to the Other budget', () => {
    const budgets: any[] = [
      { id: 'b1', name: 'Groceries', totalLimit: 1000 },
      { id: 'other-id', name: 'Other', totalLimit: 1000 },
    ];

    const transactions: any[] = [
      {
        id: 't1',
        user_id: 'u1',
        vendor: 'Amazon',
        amount: 10,
        date: '2026-02-10',
        budget_id: 'missing-budget-id',
        is_projected: false,
        created_at: '2026-02-10T00:00:00.000Z',
      },
    ];

    const normalized = normalizeTransactions(transactions as any, budgets as any);

    expect(normalized[0].budget_id).toBe('other-id');
  });

  it('keeps valid budget IDs unchanged', () => {
    const budgets: any[] = [
      { id: 'b1', name: 'Groceries', totalLimit: 1000 },
      { id: 'other-id', name: 'Other', totalLimit: 1000 },
    ];

    const transactions: any[] = [
      {
        id: 't1',
        user_id: 'u1',
        vendor: 'Amazon',
        amount: 10,
        date: '2026-02-10',
        budget_id: 'b1',
        is_projected: false,
        created_at: '2026-02-10T00:00:00.000Z',
      },
    ];

    const normalized = normalizeTransactions(transactions as any, budgets as any);

    expect(normalized[0].budget_id).toBe('b1');
  });

  it('maps category_id directly when transactions are not yet transformed', () => {
    const budgets: any[] = [
      { id: 'housing-id', name: 'Housing', totalLimit: 1000 },
      { id: 'other-id', name: 'Other', totalLimit: 1000 },
    ];

    const transactions: any[] = [
      {
        id: 't1',
        user_id: 'u1',
        vendor: 'Landlord',
        amount: 1200,
        date: '2026-02-10',
        category_id: 'housing-id',
        is_projected: false,
        created_at: '2026-02-10T00:00:00.000Z',
      },
    ];

    const normalized = normalizeTransactions(transactions as any, budgets as any);

    expect(normalized[0].budget_id).toBe('housing-id');
  });
});
