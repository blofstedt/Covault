import { describe, it, expect } from 'vitest';
import { isRefund, matchRefundsToExpenses, findMatchingExpense, REFUND_MATCH_WINDOW_DAYS } from '../refundMatching';
import type { Transaction } from '../../types';

const baseTx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'test-id',
  user_id: 'user-1',
  vendor: 'Test',
  amount: 10,
  date: '2026-07-10T12:00:00.000Z',
  budget_id: 'transport',
  recurrence: 'One-time',
  label: 'Manual',
  is_projected: false,
  created_at: '2026-07-10T12:00:00.000Z',
  ...overrides,
} as Transaction);

describe('isRefund', () => {
  it('returns true for negative amount, non-income', () => {
    expect(isRefund({ amount: -50, is_income: false })).toBe(true);
  });
  it('returns false for positive amount', () => {
    expect(isRefund({ amount: 50, is_income: false })).toBe(false);
  });
  it('returns false for negative amount when is_income=true', () => {
    // Income is also negative-amount but tagged explicitly as income
    expect(isRefund({ amount: -1000, is_income: true })).toBe(false);
  });
});

describe('matchRefundsToExpenses', () => {
  it('matches a refund to an expense with same vendor + amount + budget within window', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50, date: '2026-07-10T12:00:00.000Z' });
    const refund = baseTx({ id: 'ref-1', vendor: 'Amazon', amount: -50, date: '2026-07-12T12:00:00.000Z' });
    const { matchedExpenseIds, unmatchedRefunds } = matchRefundsToExpenses([expense, refund]);
    expect(matchedExpenseIds.has('exp-1')).toBe(true);
    expect(unmatchedRefunds.length).toBe(0);
  });

  it('does not match a refund outside the 60-day window', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50, date: '2026-05-01T12:00:00.000Z' });
    const refund = baseTx({
      id: 'ref-1', vendor: 'Amazon', amount: -50,
      // 70 days after the expense — outside the 60-day window
      date: `2026-07-10T12:00:00.000Z`,
    });
    const { matchedExpenseIds, unmatchedRefunds } = matchRefundsToExpenses([expense, refund]);
    expect(matchedExpenseIds.has('exp-1')).toBe(false);
    expect(unmatchedRefunds.length).toBe(1);
  });

  it('does not match refunds across different vendors', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50 });
    const refund = baseTx({ id: 'ref-1', vendor: 'Apple', amount: -50 });
    const { matchedExpenseIds, unmatchedRefunds } = matchRefundsToExpenses([expense, refund]);
    expect(matchedExpenseIds.has('exp-1')).toBe(false);
    expect(unmatchedRefunds.length).toBe(1);
  });

  it('does not match refunds across different budgets', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50, budget_id: 'shopping' });
    const refund = baseTx({ id: 'ref-1', vendor: 'Amazon', amount: -50, budget_id: 'transport' });
    const { matchedExpenseIds, unmatchedRefunds } = matchRefundsToExpenses([expense, refund]);
    expect(matchedExpenseIds.has('exp-1')).toBe(false);
    expect(unmatchedRefunds.length).toBe(1);
  });

  it('does not match positive-amount transactions as refunds', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50 });
    const positiveRefund = baseTx({ id: 'ref-1', vendor: 'Amazon', amount: 50 });
    const { matchedExpenseIds, unmatchedRefunds } = matchRefundsToExpenses([expense, positiveRefund]);
    expect(matchedExpenseIds.has('exp-1')).toBe(false);
    expect(unmatchedRefunds.length).toBe(0);
  });

  it('ignores projected transactions entirely', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50, is_projected: true });
    const refund = baseTx({ id: 'ref-1', vendor: 'Amazon', amount: -50, is_projected: true });
    const { matchedExpenseIds, unmatchedRefunds } = matchRefundsToExpenses([expense, refund]);
    expect(matchedExpenseIds.has('exp-1')).toBe(false);
    expect(unmatchedRefunds.length).toBe(0);
  });

  it('one expense can be matched by only one refund (first claim wins)', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50 });
    const refund1 = baseTx({ id: 'ref-1', vendor: 'Amazon', amount: -50, date: '2026-07-12T12:00:00.000Z' });
    const refund2 = baseTx({ id: 'ref-2', vendor: 'Amazon', amount: -50, date: '2026-07-13T12:00:00.000Z' });
    const { matchedExpenseIds, unmatchedRefunds } = matchRefundsToExpenses([expense, refund1, refund2]);
    expect(matchedExpenseIds.has('exp-1')).toBe(true);
    // The other refund is unmatched
    expect(unmatchedRefunds.length).toBe(1);
    expect(unmatchedRefunds[0].id).toBe('ref-2');
  });

  it('picks the closest expense when multiple candidates exist', () => {
    const farExpense = baseTx({ id: 'exp-far', vendor: 'Amazon', amount: 50, date: '2026-07-01T12:00:00.000Z' });
    const nearExpense = baseTx({ id: 'exp-near', vendor: 'Amazon', amount: 50, date: '2026-07-12T12:00:00.000Z' });
    const refund = baseTx({ id: 'ref-1', vendor: 'Amazon', amount: -50, date: '2026-07-13T12:00:00.000Z' });
    const { matchedExpenseIds } = matchRefundsToExpenses([farExpense, nearExpense, refund]);
    expect(matchedExpenseIds.has('exp-near')).toBe(true);
    expect(matchedExpenseIds.has('exp-far')).toBe(false);
  });

  it('uses REFUND_MATCH_WINDOW_DAYS = 60 as the matching window', () => {
    // Bumped from 30 to 60 to cover longer card refund windows
    // (statement-end timing, post-purchase price adjustments, etc.)
    expect(REFUND_MATCH_WINDOW_DAYS).toBe(60);
  });

  it('matches a refund up to 60 days after the original expense', () => {
    // 55-day gap used to fall outside the 30-day window; now matches.
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50, date: '2026-05-01T12:00:00.000Z' });
    const refund = baseTx({ id: 'ref-1', vendor: 'Amazon', amount: -50, date: '2026-06-25T12:00:00.000Z' });
    const { matchedExpenseIds } = matchRefundsToExpenses([expense, refund]);
    expect(matchedExpenseIds.has('exp-1')).toBe(true);
  });

  it('does not match a refund 61 days after the original expense', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50, date: '2026-05-01T12:00:00.000Z' });
    const refund = baseTx({ id: 'ref-1', vendor: 'Amazon', amount: -50, date: '2026-07-01T12:00:00.000Z' });
    const { matchedExpenseIds } = matchRefundsToExpenses([expense, refund]);
    expect(matchedExpenseIds.has('exp-1')).toBe(false);
  });
});

describe('findMatchingExpense', () => {
  const baseExpense = (overrides: Partial<Transaction>): Transaction => ({
    id: 'exp-id',
    user_id: 'user-1',
    vendor: 'Amazon',
    amount: 50,
    date: '2026-07-10T12:00:00.000Z',
    budget_id: 'shopping',
    recurrence: 'One-time',
    label: 'Manual',
    is_projected: false,
    created_at: '2026-07-10T12:00:00.000Z',
    ...overrides,
  } as Transaction);

  it('finds the closest matching expense for a refund', () => {
    const expense = baseExpense({ id: 'exp-1', date: '2026-07-12T12:00:00.000Z' });
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match?.id).toBe('exp-1');
  });

  it('requires exact vendor (case-insensitive)', () => {
    const expense = baseExpense({ id: 'exp-1', vendor: 'Amazon' });
    const refund = { vendor: 'Amzn', amount: -50, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    // Strict equality after lowercase + trim normalization. "Amzn" !== "amazon".
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match).toBeNull();
  });

  it('requires exact amount (within $0.01 tolerance)', () => {
    // $0.02 difference is outside the $0.01 tolerance — must not match.
    const expense = baseExpense({ id: 'exp-1', amount: 50 });
    const refund = { vendor: 'Amazon', amount: -50.02, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match).toBeNull();
  });

  it('accepts amounts within $0.01 tolerance', () => {
    // Tiny rounding difference (currency conversion etc.) is allowed.
    const expense = baseExpense({ id: 'exp-1', amount: 50 });
    const refund = { vendor: 'Amazon', amount: -50.005, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match?.id).toBe('exp-1');
  });

  it('skips already-refunded expenses', () => {
    const expense = baseExpense({ id: 'exp-1', refunded: true });
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match).toBeNull();
  });

  it('skips projected expenses', () => {
    const expense = baseExpense({ id: 'exp-1', is_projected: true });
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match).toBeNull();
  });

  it('skips negative-amount "expenses"', () => {
    const expense = baseExpense({ id: 'exp-1', amount: -50 });
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match).toBeNull();
  });

  it('returns null when no candidate matches', () => {
    const expense = baseExpense({ id: 'exp-1', vendor: 'Walmart', amount: 50 });
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match).toBeNull();
  });

  it('matches refunds up to 60 days after the expense', () => {
    const expense = baseExpense({ id: 'exp-1', date: '2026-05-01T12:00:00.000Z' });
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-06-30T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match?.id).toBe('exp-1');
  });

  it('returns null for refunds beyond 60 days', () => {
    const expense = baseExpense({ id: 'exp-1', date: '2026-05-01T12:00:00.000Z' });
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-07-01T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match).toBeNull();
  });

  it('picks the closest expense by date when multiple candidates exist', () => {
    const far = baseExpense({ id: 'exp-far', date: '2026-05-01T12:00:00.000Z' });
    const near = baseExpense({ id: 'exp-near', date: '2026-07-10T12:00:00.000Z' });
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-07-12T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [far, near]);
    expect(match?.id).toBe('exp-near');
  });

  it('returns null for empty candidates', () => {
    const refund = { vendor: 'Amazon', amount: -50, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, []);
    expect(match).toBeNull();
  });

  it('returns null for empty refund vendor', () => {
    const expense = baseExpense({ id: 'exp-1' });
    const refund = { vendor: '', amount: -50, date: '2026-07-13T12:00:00.000Z', budget_id: '' };
    const match = findMatchingExpense(refund as any, [expense]);
    expect(match).toBeNull();
  });
});
