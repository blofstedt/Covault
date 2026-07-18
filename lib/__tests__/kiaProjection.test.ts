import { describe, it, expect } from 'vitest';
import { generateProjectedTransactions } from '../projectedTransactions';
import type { Transaction } from '../../types';

const tx = (overrides: Partial<Transaction>): Transaction => ({
  id: 'kia-anchor',
  user_id: 'u',
  vendor: 'Kia',
  amount: 458.69,
  date: '2026-07-03T12:00:00.000Z',
  budget_id: 'transport',
  recurrence: 'Biweekly',
  label: 'Manual',
  is_projected: false,
  created_at: '2026-07-03T12:00:00.000Z',
  source: 'manual',
  ...overrides,
} as Transaction);

describe('KIA projection from 7/3 anchor', () => {
  it('generates future biweekly occurrences every 14 days', () => {
    const projected = generateProjectedTransactions([tx({})]);
    const dates = projected.map((p) => p.date).sort();
    // From 7/3 + 14-day biweekly: 7/17, 7/31, 8/14, 8/28, 9/11, 9/25, 10/9
    expect(dates).toContain('2026-07-17');
    expect(dates).toContain('2026-07-31');
    expect(dates).toContain('2026-08-14');
    expect(dates).toContain('2026-08-28');
    // Should not contain 7/3 (it's the real anchor)
    expect(dates).not.toContain('2026-07-03');
  });

  it('solidifies 7/3 since it is on/before today (2026-07-17)', () => {
    // 7/3 < today(7/17), so current-month and on-or-before-today entries
    // become is_projected=false (solidified).
    const projected = generateProjectedTransactions([tx({})]);
    // The "Projected" tag in the UI shows is_projected=true for future ones.
    // Past occurrences (7/3) are not projected; they are the real anchor.
    const july3 = projected.find((p) => p.date === '2026-07-03');
    expect(july3).toBeUndefined(); // anchor is not in projection list
  });

  it('marks future occurrences as projected', () => {
    const projected = generateProjectedTransactions([tx({})]);
    const future = projected.find((p) => p.date === '2026-08-14');
    expect(future).toBeDefined();
    expect(future!.is_projected).toBe(true);
  });
});
