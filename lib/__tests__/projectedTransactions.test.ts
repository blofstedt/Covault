import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateProjectedTransactions } from '../projectedTransactions';
import type { Transaction } from '../../types';

function makeTransaction(overrides: Partial<Transaction> & { recur?: string } = {}): Transaction {
  return {
    id: 'tx-1',
    user_id: 'user-1',
    vendor: 'Landlord',
    amount: 1800,
    date: '2026-02-01',
    budget_id: 'housing-id',
    recurrence: 'Monthly',
    label: 'Manual',
    userName: 'me',
    is_projected: false,
    created_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  } as Transaction;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('generateProjectedTransactions', () => {
  it('does not keep projected occurrences once the projected date is today or in the past', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));

    const projected = generateProjectedTransactions([
      makeTransaction({ date: '2026-02-20', recurrence: 'Monthly' }),
    ]);

    expect(projected.map((tx) => tx.date)).not.toContain('2026-03-20');
    expect(projected.map((tx) => tx.date)).toContain('2026-04-20');
  });

  it('projects a rolling three-month monthly horizon and supports legacy recur field on projected DB rows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));

    const projected = generateProjectedTransactions([
      makeTransaction({
        id: 'db-row',
        date: '2026-02-28',
        recurrence: undefined,
        recur: 'Monthly',
        is_projected: true,
      } as any),
    ]);

    expect(projected.map((tx) => tx.date)).toEqual([
      '2026-03-28',
      '2026-04-28',
      '2026-05-28',
    ]);
  });

  it('does not duplicate an occurrence when a real transaction already exists for that month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));

    const base = [
      makeTransaction({ id: 'seed-tx', date: '2026-02-01', recurrence: 'Monthly' }),
      makeTransaction({ id: 'real-march', date: '2026-03-01', recurrence: 'One-time' }),
    ];

    const projected = generateProjectedTransactions(base);

    expect(projected.map((tx) => tx.date)).not.toContain('2026-03-01');
  });
});
