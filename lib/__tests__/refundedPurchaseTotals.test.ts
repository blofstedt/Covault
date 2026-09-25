/**
 * A refunded purchase counts the same everywhere.
 *
 * When a refund notification matches a purchase, the capture pipeline writes no
 * negative row — it marks the original purchase `refunded` and the row is drawn
 * struck through. The vial stopped counting it; nothing else did. The headline
 * "Remaining Balance", the chart, the home-screen widget and the over-budget
 * alerts all went on summing the raw amount, so a returned purchase kept
 * lowering the balance at the top of the screen while its own vial said the
 * money was back.
 *
 * The vial had the opposite problem with a refund entered by hand (a negative
 * row): it dropped the matched purchase AND subtracted the refund, so a
 * returned $60 left the vial at -$60.
 *
 * One rule, `countedAmount`, now decides what a row adds to "spent", and these
 * tests hold every total to it.
 */
import { describe, it, expect } from 'vitest';
import { countedAmount } from '../refundMatching';
import { computeBudgetTotals } from '../discretionaryShield';
import { householdSpend, emptySummary } from '../householdSharing';
import { remainingForMonth } from '../monthWindow';
import { buildWidgetSnapshot } from '../widgetSnapshot';
import { generateProjectedTransactions } from '../projectedTransactions';
import { Recurrence, type BudgetCategory, type Transaction } from '../../types';

const ME = 'me';
const GROCERIES = 'b-groceries';
const budgets = [{ id: GROCERIES, name: 'Groceries', totalLimit: 500 }] as BudgetCategory[];

let seq = 0;
function tx(over: Partial<Transaction> & { amount: number }): Transaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    user_id: ME,
    vendor: 'Indigo',
    date: '2026-09-03',
    budget_id: GROCERIES,
    is_projected: false,
    label: 'Manual',
    userName: 'Me',
    created_at: '2026-09-03T12:00:00Z',
    ...over,
  } as Transaction;
}

describe('countedAmount', () => {
  it('counts an ordinary purchase at face value', () => {
    expect(countedAmount(tx({ amount: 42.5 }))).toBe(42.5);
  });

  it('counts a purchase the pipeline marked refunded as nothing', () => {
    expect(countedAmount(tx({ amount: 75, refunded: true }))).toBe(0);
  });

  it('counts a hand-entered refund as the negative it is', () => {
    expect(countedAmount(tx({ amount: -60 }))).toBe(-60);
  });

  it('treats an unreadable amount as nothing rather than NaN', () => {
    expect(countedAmount({ amount: Number.NaN })).toBe(0);
  });
});

describe('a purchase refunded by notification', () => {
  const refunded = tx({ amount: 75, refunded: true });
  const kept = tx({ amount: 20, vendor: 'Chapters' });
  const month = [refunded, kept];

  it('leaves the vial', () => {
    expect(computeBudgetTotals(GROCERIES, month).spent).toBe(20);
  });

  it('leaves the headline balance for this month', () => {
    expect(householdSpend(month, ME, null)).toBe(20);
  });

  it('leaves the headline balance for a month being browsed', () => {
    expect(remainingForMonth(month, 1000)).toBe(980);
  });

  it('leaves the balance when a partner shares only totals', () => {
    const summary = { ...emptySummary('totals'), total: 100 };
    expect(householdSpend(month, ME, summary)).toBe(120);
  });

  it('leaves the home-screen widget, its donut and its recent list', () => {
    const snap = buildWidgetSnapshot({
      budgets,
      currentMonthTransactions: month,
      remaining: 980,
      income: 1000,
      theme: 'dark',
      pendingReview: 0,
      monthKey: '2026-09',
      nowMs: 1,
    });
    expect(snap.totalSpent).toBe(20);
    expect(snap.slices).toEqual([expect.objectContaining({ name: 'Groceries', amount: 20 })]);
    expect(snap.recent.Groceries.map((r) => r.vendor)).toEqual(['Chapters']);
  });
});

describe('a refund entered by hand', () => {
  it('nets to zero with the purchase it matches, in the vial and the balance alike', () => {
    const spend = tx({ amount: 60, date: '2026-09-02' });
    const refund = tx({ amount: -60, date: '2026-09-05' });
    const totals = computeBudgetTotals(GROCERIES, [spend, refund]);

    expect(totals.spent).toBe(0);
    // Still struck through on screen, and the refund row itself stays hidden.
    expect(totals.refundedExpenseIds.has(spend.id)).toBe(true);
    expect(totals.visibleTransactions.map((t) => t.id)).toEqual([spend.id]);

    expect(householdSpend([spend, refund], ME, null)).toBe(0);
    expect(remainingForMonth([spend, refund], 1000)).toBe(1000);
  });
});

describe('a recurring charge whose first payment was refunded', () => {
  it('still expects every later payment in full', () => {
    const first = tx({
      id: 'sub-1',
      vendor: 'Crave',
      amount: 19.99,
      date: '2026-07-10',
      recurrence: Recurrence.MONTHLY,
      refunded: true,
    });
    const projected = generateProjectedTransactions([first], '2026-09-01');
    expect(projected.length).toBeGreaterThan(0);
    for (const occurrence of projected) {
      expect(occurrence.refunded).toBe(false);
      expect(countedAmount(occurrence)).toBe(19.99);
    }
  });

  it('leaves occurrences of an ordinary series exactly as they were', () => {
    const first = tx({
      id: 'sub-2',
      vendor: 'Spotify',
      amount: 11.99,
      date: '2026-07-12',
      recurrence: Recurrence.MONTHLY,
    });
    const projected = generateProjectedTransactions([first], '2026-09-01');
    expect(projected.length).toBeGreaterThan(0);
    for (const occurrence of projected) {
      expect('refunded' in occurrence).toBe(false);
    }
  });
});
