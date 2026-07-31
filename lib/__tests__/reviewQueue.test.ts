import { describe, it, expect } from 'vitest';
import { selectAwaitingReview, countAwaitingReview, countHiddenRefunds } from '../reviewQueue';
import type { Transaction } from '../../types';

/**
 * This is now the single definition of "waiting in Review", read by the list,
 * the bottom-bar badge, and the home-screen widget.
 *
 * It exists because those disagreed: the badge counted refunds that the list
 * filtered out, so a captured refund made the badge read one higher than the
 * list it pointed at. That was a cosmetic annoyance in the app. On the widget
 * it would be worse — the badge's whole job is to be trustworthy when a capture
 * notification gets dismissed by mistake, and a number that doesn't match what
 * you find when you open the app teaches you to ignore it.
 */

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: 'u1',
    vendor: 'Vendor',
    amount: 10,
    date: '2026-07-15',
    budget_id: 'b1',
    is_projected: false,
    label: 'Automatic',
    userName: 'Test',
    created_at: '2026-07-15T00:00:00Z',
    ...over,
  } as Transaction;
}

describe('selectAwaitingReview', () => {
  it('keeps captured rows that have not been filed', () => {
    const rows = [tx({ id: 'a' }), tx({ id: 'b' })];
    expect(selectAwaitingReview(rows).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('excludes manually added transactions', () => {
    expect(selectAwaitingReview([tx({ label: 'Manual' })])).toEqual([]);
  });

  it('excludes rows already filed', () => {
    expect(selectAwaitingReview([tx({ caught_cleared: true })])).toEqual([]);
  });

  it('excludes refunds', () => {
    // The specific disagreement this module was created to end.
    expect(selectAwaitingReview([tx({ amount: -25 })])).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(selectAwaitingReview([])).toEqual([]);
  });
});

describe('countAwaitingReview', () => {
  it('counts exactly what the list would render', () => {
    const rows = [
      tx({ id: 'keep-1' }),
      tx({ id: 'keep-2' }),
      tx({ id: 'refund', amount: -5 }),
      tx({ id: 'filed', caught_cleared: true }),
      tx({ id: 'manual', label: 'Manual' }),
    ];
    expect(countAwaitingReview(rows)).toBe(selectAwaitingReview(rows).length);
    expect(countAwaitingReview(rows)).toBe(2);
  });
});

describe('countHiddenRefunds', () => {
  it('counts the captured refunds the list hides', () => {
    // Surfaced in the card subtitle, so their absence is explained rather than
    // looking like captures that went missing.
    const rows = [tx({ amount: -5 }), tx({ amount: -9 }), tx({ amount: 12 })];
    expect(countHiddenRefunds(rows)).toBe(2);
  });

  it('ignores refunds that are already filed', () => {
    expect(countHiddenRefunds([tx({ amount: -5, caught_cleared: true })])).toBe(0);
  });

  it('ignores manual refunds', () => {
    expect(countHiddenRefunds([tx({ amount: -5, label: 'Manual' })])).toBe(0);
  });
});
