import { describe, it, expect } from 'vitest';
import { selectBulkAcceptable, type VendorMatchResult } from '../hooks/useVendorMatcher';
import type { Transaction } from '../../types';
import type { VendorOverride } from '../../components/transaction_parsing/useVendorOverrides';

/**
 * "Accept N known vendors" files a screenful of rows in one tap, so what it is
 * allowed to pick up matters more than how it looks.
 *
 * The rule: only rows where a vendor override the *user wrote* matched, and
 * which already have a category. An AI-guessed row swept up by bulk accept is
 * a mis-categorisation the user never saw — and unlike the per-row Accept,
 * they'd have no moment to notice it before it lands in their budget.
 */

const override: VendorOverride = {
  id: 'o1',
  proper_name: 'Tim Hortons',
  match_key: 'timhortons',
  match_type: 'exact',
  category_id: 'Leisure',
} as VendorOverride;

function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    user_id: 'u1',
    vendor: 'Vendor',
    amount: 10,
    date: '2026-07-31',
    budget_id: 'b1',
    is_projected: false,
    label: 'Automatic',
    userName: 'Test',
    created_at: '2026-07-31T00:00:00Z',
    ...over,
  } as Transaction;
}

const matched: VendorMatchResult = { match: override, state: 'exact' };
const unmatched: VendorMatchResult = { match: null, state: 'none' };

/** Stand-in for the card's budget lookup: any row pointing at 'b1' has one. */
const hasBudget = (t: Transaction) => t.budget_id === 'b1';

describe('selectBulkAcceptable', () => {
  it('picks rows where a user rule matched and a category is set', () => {
    const rows = [tx({ id: 'a' }), tx({ id: 'b' })];
    const map = new Map([['a', matched], ['b', matched]]);
    expect(selectBulkAcceptable(rows, map, hasBudget).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('excludes AI-guessed rows even at high confidence', () => {
    // The whole point of the restriction. A 0.99 guess is still a guess.
    const rows = [tx({ id: 'rule' }), tx({ id: 'guess', confidence: 0.99 })];
    const map = new Map([['rule', matched], ['guess', unmatched]]);
    expect(selectBulkAcceptable(rows, map, hasBudget).map((t) => t.id)).toEqual(['rule']);
  });

  it('excludes rows with no category, even when a rule matched', () => {
    // Accept isn't offered on these in the row UI either; there is nowhere to
    // file them, so they are still a manual decision.
    const rows = [tx({ id: 'nobudget', budget_id: null })];
    const map = new Map([['nobudget', matched]]);
    expect(selectBulkAcceptable(rows, map, hasBudget)).toEqual([]);
  });

  it('excludes rows missing from the match map', () => {
    const rows = [tx({ id: 'ghost' })];
    expect(selectBulkAcceptable(rows, new Map(), hasBudget)).toEqual([]);
  });

  it('treats a match entry with state none as no match', () => {
    // classifyAll writes { match: null, state: 'none' } for every row when the
    // user has no overrides at all, so this is the common empty case.
    const rows = [tx({ id: 'a', confidence: 0.8 })];
    const map = new Map([['a', unmatched]]);
    expect(selectBulkAcceptable(rows, map, hasBudget)).toEqual([]);
  });

  it('returns nothing for an empty list', () => {
    expect(selectBulkAcceptable([], new Map(), hasBudget)).toEqual([]);
  });
});
