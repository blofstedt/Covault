import { describe, it, expect, beforeEach, vi } from 'vitest';

// firstPaintCache reads window.localStorage, so give it one.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
const storage = new MemoryStorage();
vi.stubGlobal('window', { localStorage: storage });

import {
  readFirstPaintCache,
  writeFirstPaintCache,
  clearFirstPaintCache,
} from '../firstPaintCache';
import { sortBudgets } from '../budgetOrder';
import type { Transaction, BudgetCategory } from '../../types';

const tx = (id: string, date: string): Transaction => ({
  id,
  user_id: 'u1',
  vendor: `Vendor ${id}`,
  amount: 10,
  date,
  budget_id: 'budget:groceries',
  label: 'Automatic',
  is_projected: false,
  created_at: `${date}T12:00:00.000Z`,
});

const budgets: BudgetCategory[] = [
  { id: 'budget:other', name: 'Other', totalLimit: 100 },
  { id: 'budget:groceries', name: 'Groceries', totalLimit: 500 },
];

const snapshot = (over: Partial<Parameters<typeof writeFirstPaintCache>[0]> = {}) => ({
  userId: 'u1',
  savedAt: Date.now(),
  transactions: [tx('a', '2026-08-01')],
  budgets,
  hiddenCategories: ['budget:other'],
  monthlyIncome: 4200,
  ...over,
});

describe('first-paint cache', () => {
  beforeEach(() => storage.clear());

  it('round-trips what the app was last showing', () => {
    writeFirstPaintCache(snapshot());
    const read = readFirstPaintCache('u1');

    expect(read).not.toBeNull();
    expect(read!.transactions.map((t) => t.id)).toEqual(['a']);
    expect(read!.monthlyIncome).toBe(4200);
    expect(read!.hiddenCategories).toEqual(['budget:other']);
  });

  // The point of the user-id check: signing in as someone else on the same
  // phone must not paint the previous person's spending, however briefly.
  it('is a miss for a different user', () => {
    writeFirstPaintCache(snapshot());
    expect(readFirstPaintCache('someone-else')).toBeNull();
  });

  it('is a miss after sign-out clears it', () => {
    writeFirstPaintCache(snapshot());
    clearFirstPaintCache();
    expect(readFirstPaintCache('u1')).toBeNull();
  });

  // This runs on the launch path. A corrupt payload has to degrade to "no
  // cache" — i.e. the behaviour the app had before this existed — rather than
  // throwing on the way to first paint.
  it('is a miss, not a throw, on a corrupt payload', () => {
    storage.setItem('covault_first_paint_v1', '{not json');
    expect(() => readFirstPaintCache('u1')).not.toThrow();
    expect(readFirstPaintCache('u1')).toBeNull();

    storage.setItem('covault_first_paint_v1', JSON.stringify({ userId: 'u1' }));
    expect(readFirstPaintCache('u1')).toBeNull();
  });

  // localStorage is a synchronous main-thread write with a hard quota, so the
  // list is bounded — newest kept, because that is what any screen reads.
  it('keeps the newest rows and drops the oldest beyond the cap', () => {
    // One row per day, oldest first, so "newest 1000" is unambiguous.
    const day = (i: number) =>
      new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
    const many = Array.from({ length: 1200 }, (_, i) => tx(`t${i}`, day(i)));
    writeFirstPaintCache(snapshot({ transactions: many }));

    const read = readFirstPaintCache('u1')!;
    expect(read.transactions.length).toBe(1000);
    // Newest first, and it is the 200 oldest that were dropped.
    expect(read.transactions[0].id).toBe('t1199');
    const keptIds = new Set(read.transactions.map((t) => t.id));
    expect(keptIds.has('t199')).toBe(false);
    expect(keptIds.has('t200')).toBe(true);
  });

  // The budget order is fixed in code, never taken from storage — a snapshot
  // written by an older build must not reintroduce a different order. See
  // lib/budgetOrder.ts.
  it('re-sorts budgets on read rather than trusting the stored order', () => {
    writeFirstPaintCache(snapshot());
    const read = readFirstPaintCache('u1')!;

    expect(read.budgets.map((b) => b.name)).toEqual(
      sortBudgets(budgets).map((b) => b.name),
    );
  });
});
