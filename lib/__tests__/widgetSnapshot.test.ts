import { describe, it, expect } from 'vitest';
import {
  buildWidgetSnapshot,
  mergeWidgetDeltas,
  monthLabelFromKey,
  type WidgetSnapshot,
} from '../widgetSnapshot';
import type { BudgetCategory, Transaction } from '../../types';

/**
 * The widget can't fetch anything — no Supabase session exists in the native
 * process — so it draws whatever this module hands it. Everything below is the
 * specification the Java renderer mirrors.
 */

const budgets = [
  { id: 'b-groceries', name: 'Groceries' },
  { id: 'b-transport', name: 'Transport' },
  { id: 'b-leisure', name: 'Leisure' },
] as BudgetCategory[];

function tx(over: Partial<Transaction> & { amount: number }): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'u1',
    vendor: 'Vendor',
    date: '2026-07-15',
    budget_id: 'b-groceries',
    is_projected: false,
    label: 'Manual',
    userName: 'Test',
    created_at: '2026-07-15T00:00:00Z',
    ...over,
  } as Transaction;
}

const base = {
  budgets,
  remaining: 1000,
  income: 5000,
  theme: 'dark' as const,
  monthKey: '2026-07',
  nowMs: 1_000_000,
};

describe('monthLabelFromKey', () => {
  it('renders the month name the header shows', () => {
    expect(monthLabelFromKey('2026-07')).toBe('July');
    expect(monthLabelFromKey('2026-01')).toBe('January');
    expect(monthLabelFromKey('2026-12')).toBe('December');
  });

  it('falls back to the raw key rather than throwing on nonsense', () => {
    expect(monthLabelFromKey('garbage')).toBe('garbage');
  });
});

describe('buildWidgetSnapshot', () => {
  it('sums by category and orders slices largest first', () => {
    const snap = buildWidgetSnapshot({
      ...base,
      currentMonthTransactions: [
        tx({ amount: 10, budget_id: 'b-groceries' }),
        tx({ amount: 50, budget_id: 'b-transport' }),
        tx({ amount: 15, budget_id: 'b-groceries' }),
      ],
    });
    expect(snap.slices.map((s) => [s.name, s.amount])).toEqual([
      ['Transport', 50],
      ['Groceries', 25],
    ]);
    expect(snap.totalSpent).toBe(75);
  });

  it('buckets an unknown or missing budget_id into Other', () => {
    // Matters because the total must always equal the sum of the slices —
    // a dropped transaction would make the donut disagree with its own centre.
    const snap = buildWidgetSnapshot({
      ...base,
      currentMonthTransactions: [
        tx({ amount: 20, budget_id: null }),
        tx({ amount: 5, budget_id: 'b-does-not-exist' }),
      ],
    });
    expect(snap.slices).toEqual([
      expect.objectContaining({ name: 'Other', amount: 25 }),
    ]);
    expect(snap.totalSpent).toBe(25);
  });

  it('keeps a refund out of the ring but inside the total', () => {
    // A negative arc is meaningless on a donut, but the money is real, so it
    // still moves totalSpent.
    const snap = buildWidgetSnapshot({
      ...base,
      currentMonthTransactions: [
        tx({ amount: 40, budget_id: 'b-transport' }),
        tx({ amount: -60, budget_id: 'b-groceries' }),
      ],
    });
    expect(snap.slices.map((s) => s.name)).toEqual(['Transport']);
    expect(snap.totalSpent).toBe(-20);
  });

  it('carries a negative remaining through unclamped', () => {
    const snap = buildWidgetSnapshot({ ...base, remaining: -250, currentMonthTransactions: [] });
    expect(snap.remaining).toBe(-250);
  });

  it('produces a valid snapshot for an empty month rather than null', () => {
    const snap = buildWidgetSnapshot({ ...base, currentMonthTransactions: [] });
    expect(snap.slices).toEqual([]);
    expect(snap.totalSpent).toBe(0);
    expect(snap.monthLabel).toBe('July');
  });

  it('uses the app palette for slice colours', () => {
    const snap = buildWidgetSnapshot({
      ...base,
      currentMonthTransactions: [tx({ amount: 10, budget_id: 'b-groceries' })],
    });
    expect(snap.slices[0].color).toBe('#6b9e6e');
  });

  it('drops zero-amount transactions without creating an empty slice', () => {
    const snap = buildWidgetSnapshot({
      ...base,
      currentMonthTransactions: [tx({ amount: 0, budget_id: 'b-leisure' })],
    });
    expect(snap.slices).toEqual([]);
  });
});

/** Deltas land in July unless the test says otherwise. */
const julyMonth = (atMs: number) => (atMs >= 9_000_000 ? '2026-08' : '2026-07');

function snapshotWith(slices: WidgetSnapshot['slices'], totalSpent: number): WidgetSnapshot {
  return {
    ...buildWidgetSnapshot({ ...base, currentMonthTransactions: [] }),
    slices,
    totalSpent,
  };
}

describe('mergeWidgetDeltas', () => {
  const snapshot = snapshotWith(
    [{ name: 'Groceries', amount: 25, color: '#6b9e6e' }],
    25,
  );

  it('adds a delta captured after the snapshot', () => {
    const merged = mergeWidgetDeltas(
      snapshot,
      [{ amount: 30, category: 'Transport', atMs: 2_000_000 }],
      julyMonth,
    );
    expect(merged.totalSpent).toBe(55);
    expect(merged.slices.map((s) => s.name)).toEqual(['Transport', 'Groceries']);
  });

  it('ignores a delta the snapshot already accounts for', () => {
    // The self-healing rule. Once the app writes an authoritative snapshot,
    // every optimistic guess before it is discarded — including ones the JS
    // pipeline rejected as not-a-transaction or deduped away.
    const merged = mergeWidgetDeltas(
      snapshot,
      [{ amount: 30, category: 'Transport', atMs: 999_999 }],
      julyMonth,
    );
    expect(merged).toBe(snapshot);
  });

  it('ignores a delta from a different month', () => {
    // A purchase captured at 00:05 on the 1st must not land on last month's donut.
    const merged = mergeWidgetDeltas(
      snapshot,
      [{ amount: 30, category: 'Transport', atMs: 9_500_000 }],
      julyMonth,
    );
    expect(merged).toBe(snapshot);
  });

  it('returns the snapshot untouched when there are no deltas', () => {
    expect(mergeWidgetDeltas(snapshot, [], julyMonth)).toBe(snapshot);
  });

  it('merges a delta into an existing category rather than duplicating it', () => {
    const merged = mergeWidgetDeltas(
      snapshot,
      [{ amount: 5, category: 'Groceries', atMs: 2_000_000 }],
      julyMonth,
    );
    expect(merged.slices).toHaveLength(1);
    expect(merged.slices[0]).toMatchObject({ name: 'Groceries', amount: 30, color: '#6b9e6e' });
  });

  it('reduces remaining by exactly what it added', () => {
    const merged = mergeWidgetDeltas(
      snapshot,
      [{ amount: 30, category: 'Transport', atMs: 2_000_000 }],
      julyMonth,
    );
    expect(merged.remaining).toBe(snapshot.remaining - 30);
  });

  it('colours a category the snapshot had never seen', () => {
    const merged = mergeWidgetDeltas(
      snapshot,
      [{ amount: 40, category: 'Leisure', atMs: 2_000_000 }],
      julyMonth,
    );
    expect(merged.slices.find((s) => s.name === 'Leisure')?.color).toBe('#9a7bbf');
  });

  it('applies several deltas at once', () => {
    const merged = mergeWidgetDeltas(
      snapshot,
      [
        { amount: 10, category: 'Transport', atMs: 2_000_000 },
        { amount: 20, category: 'Transport', atMs: 3_000_000 },
        { amount: 1, category: 'Groceries', atMs: 4_000_000 },
      ],
      julyMonth,
    );
    expect(merged.totalSpent).toBe(56);
    expect(merged.slices.map((s) => [s.name, s.amount])).toEqual([
      ['Transport', 30],
      ['Groceries', 26],
    ]);
  });
});
