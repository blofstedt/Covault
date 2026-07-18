import { describe, it, expect } from 'vitest';
import { isRefund, matchRefundsToExpenses, REFUND_MATCH_WINDOW_DAYS } from '../refundMatching';
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

  it('does not match a refund outside the date window', () => {
    const expense = baseTx({ id: 'exp-1', vendor: 'Amazon', amount: 50, date: '2026-06-01T12:00:00.000Z' });
    const refund = baseTx({
      id: 'ref-1', vendor: 'Amazon', amount: -50,
      // > REFUND_MATCH_WINDOW_DAYS days after the expense
      date: `2026-07-15T12:00:00.000Z`,
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

  it('uses REFUND_MATCH_WINDOW_DAYS = 30 as the matching window', () => {
    expect(REFUND_MATCH_WINDOW_DAYS).toBe(30);
  });
});
