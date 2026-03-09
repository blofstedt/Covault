import { describe, expect, it } from 'vitest';
import { resolveBudgetIdFromRow, resolveBudgetNameForInsert, toSupabaseTransaction } from '../hooks/transactionMappers';

const budgets = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Housing' },
  { id: 'budget:groceries', name: 'Groceries' },
  { id: 'custom-id', name: 'Emergency Fund' },
];

describe('transactionMappers budget resolution', () => {
  it('resolves DB category id directly when present', () => {
    expect(resolveBudgetIdFromRow({ category_id: 'abc-123' })).toBe('abc-123');
  });

  it('maps legacy DB budget text values to stable system UUID ids', () => {
    expect(resolveBudgetIdFromRow({ budget: 'Housing' })).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('falls back to normalized budget: prefixed ids for non-system categories', () => {
    expect(resolveBudgetIdFromRow({ budget: 'Emergency Fund' })).toBe('budget:emergency-fund');
  });

  it('resolves budget name from exact id for inserts', () => {
    expect(resolveBudgetNameForInsert('custom-id', budgets)).toBe('Emergency Fund');
  });

  it('resolves budget name from budget: prefixed id for inserts', () => {
    expect(resolveBudgetNameForInsert('budget:groceries', budgets)).toBe('Groceries');
  });

  it('resolves budget name when transaction carries category name as budget_id', () => {
    expect(resolveBudgetNameForInsert('Housing', budgets)).toBe('Housing');
  });

  it('throws when no matching budget can be found', () => {
    expect(() => resolveBudgetNameForInsert('missing', budgets)).toThrow(
      'Cannot map budget_id "missing" to a valid budget name for transactions.budget',
    );
  });

  it('maps a transaction budget_id to budget name for insert payloads', () => {
    const row = toSupabaseTransaction(
      {
        id: 'tx-1',
        user_id: 'user-1',
        vendor: 'Costco',
        amount: 12.34,
        date: '2026-03-09T12:00:00.000Z',
        budget_id: 'custom-id',
        recurrence: 'Monthly',
        label: 'Manual',
        is_projected: false,
        created_at: '2026-03-09T12:00:00.000Z',
      },
      budgets,
    );

    expect(row.budget).toBe('Emergency Fund');
    expect(row.recur).toBe('Monthly');
    expect(row.type).toBe('Manual');
  });
});
