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


  it('maps legacy budget name fields to matching budget IDs', () => {
    const budgets: any[] = [
      { id: 'groceries-id', name: 'Groceries', totalLimit: 1000 },
      { id: 'other-id', name: 'Other', totalLimit: 1000 },
    ];

    const transactions: any[] = [
      {
        id: 't1',
        user_id: 'u1',
        vendor: 'Costco',
        amount: '42.50',
        date: '2026-02-10T11:12:13.000Z',
        budget: 'Groceries',
      },
    ];

    const normalized = normalizeTransactions(transactions as any, budgets as any);

    expect(normalized[0].budget_id).toBe('groceries-id');
    expect(normalized[0].amount).toBe(42.5);
    expect(normalized[0].date).toBe('2026-02-10');
  });



  it('prefers transactions.budget name when budget_id is invalid', () => {
    const budgets: any[] = [
      { id: 'housing-id', name: 'Housing', totalLimit: 1000 },
      { id: 'other-id', name: 'Other', totalLimit: 1000 },
    ];

    const transactions: any[] = [
      {
        id: 't1',
        user_id: 'u1',
        vendor: 'Rent',
        amount: '1200.00',
        date: '2026-02-01T00:00:00.000Z',
        budget_id: 'legacy-missing-id',
        budget: 'Housing',
      },
    ];

    const normalized = normalizeTransactions(transactions as any, budgets as any);

    expect(normalized[0].budget_id).toBe('housing-id');
  });

  it('maps prefixed legacy budget IDs to matching budget IDs', () => {
    const budgets: any[] = [
      { id: 'groceries-id', name: 'Groceries', totalLimit: 1000 },
      { id: 'other-id', name: 'Other', totalLimit: 1000 },
    ];

    const transactions: any[] = [
      {
        id: 't1',
        user_id: 'u1',
        vendor: 'Costco',
        amount: 42.5,
        date: '2026-02-10',
        budget_id: 'budget:groceries',
      },
    ];

    const normalized = normalizeTransactions(transactions as any, budgets as any);

    expect(normalized[0].budget_id).toBe('groceries-id');
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
});
