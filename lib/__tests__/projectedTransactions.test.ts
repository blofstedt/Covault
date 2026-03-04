import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateProjectedTransactions } from '../projectedTransactions';
import type { Transaction } from '../../types';

function makeTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-1',
    user_id: 'user-1',
    vendor: 'Landlord',
    amount: 1800,
    date: '2026-02-01',
    budget_id: 'housing-id',
    recurrence: 'Monthly',
    label: 'Manual',
    type: 'debit',
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
  it('keeps a monthly projected occurrence visible for the current month even if date is earlier than today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'));

    const projected = generateProjectedTransactions([
      makeTransaction({ date: '2026-02-01', recurrence: 'Monthly' }),
    ]);

    expect(projected.map((tx) => tx.date)).toContain('2026-03-01');
  });

  it('does not duplicate a current-month projected transaction when a real transaction already exists for that occurrence', () => {
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
