import { describe, expect, it } from 'vitest';
import {
  resolveBudgetIdFromRow,
  resolveBudgetNameForInsert,
  shouldSolidifyProjectedTransaction,
  toSupabaseTransaction,
} from '../hooks/transactionMappers';

const budgets = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Housing' },
  { id: 'budget:groceries', name: 'Groceries' },
  { id: 'custom-id', name: 'Emergency Fund' },
];

describe('shouldSolidifyProjectedTransaction', () => {
  // Use noon UTC so the test passes in every common timezone (UTC-12
  // through UTC+14). The old `00:01:00Z` was the previous local day in
  // any negative-offset timezone (e.g. America/Chicago), which made
  // the 'solidifies ... dated today' assertion fail there. The function
  // compares the tx date to the *local* date, so the test fixture has
  // to land on the same local day regardless of where it runs.
  const now = new Date('2026-03-20T12:00:00.000Z');

  it('solidifies projected transactions dated today', () => {
    expect(shouldSolidifyProjectedTransaction(true, '2026-03-20', now)).toBe(true);
  });

  it('solidifies projected transactions dated before today', () => {
    expect(shouldSolidifyProjectedTransaction(true, '2026-03-19', now)).toBe(true);
  });

  it('does not solidify projected transactions dated after today', () => {
    expect(shouldSolidifyProjectedTransaction(true, '2026-03-21', now)).toBe(false);
  });

  it('does not solidify non-projected transactions', () => {
    expect(shouldSolidifyProjectedTransaction(false, '2026-03-19', now)).toBe(false);
  });
});

describe('transactionMappers budget resolution', () => {
  it('returns null for rows with no Budget/budget field', () => {
    // The current schema (public.transactions) uses `Budget` (enum) /
    // `budget` (legacy alias). The `category_id` fallback was removed in
    // commit 63b244f because no live row in the current schema uses it.
    // resolveBudgetIdFromRow now returns null for rows that don't carry
    // a Budget/budget value, and the caller (toSupabaseTransaction)
    // is responsible for ensuring the transaction carries a budget_id
    // before it gets here.
    expect(resolveBudgetIdFromRow({})).toBeNull();
    expect(resolveBudgetIdFromRow({ category_id: 'abc-123' })).toBeNull();
  });

  it('maps legacy DB budget text values to stable system UUID ids', () => {
    expect(resolveBudgetIdFromRow({ budget: 'Housing' })).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('prefers budget text over legacy category_id when both are present', () => {
    expect(resolveBudgetIdFromRow({ budget: 'Housing', category_id: 'stale-id' })).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
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
