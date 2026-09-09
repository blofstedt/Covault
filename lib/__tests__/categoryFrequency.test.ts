/**
 * "Walmart→Groceries and Walmart→Other are both real purchases at the same
 * merchant" — when a vendor matches more than one rule the app has learned,
 * it cannot know which this purchase was and has to ask. What it can do is
 * ask with a sensible starting point instead of a blank field: whichever of
 * the conflicting categories this same vendor has actually been filed under
 * most often. These tests are about the plurality logic alone, not about
 * whether the row still goes to review — that guarantee comes from
 * `overrideMatchConfidence` staying 0, which lib/notificationProcessor.ts
 * never touches here, and is out of scope for a pure function.
 */
import { describe, it, expect } from 'vitest';
import { mostFrequentCategory } from '../categoryFrequency';

const rows = (...budgets: string[]) => budgets.map((budget) => ({ budget }));

describe('mostFrequentCategory', () => {
  it('picks the category with strictly more history', () => {
    const result = mostFrequentCategory(
      rows('Groceries', 'Groceries', 'Groceries', 'Other'),
      ['Groceries', 'Other'],
    );
    expect(result).toBe('Groceries');
  });

  it('returns the candidate\'s own casing, not the row\'s', () => {
    const result = mostFrequentCategory(
      [{ budget: 'groceries' }, { budget: 'groceries' }, { budget: 'other' }],
      ['Groceries', 'Other'],
    );
    expect(result).toBe('Groceries');
  });

  it('returns null on a tie — a coin flip is worse than no suggestion', () => {
    const result = mostFrequentCategory(rows('Groceries', 'Other'), ['Groceries', 'Other']);
    expect(result).toBeNull();
  });

  it('returns null with no matching history at all', () => {
    expect(mostFrequentCategory([], ['Groceries', 'Other'])).toBeNull();
    expect(mostFrequentCategory(rows('Leisure', 'Leisure'), ['Groceries', 'Other'])).toBeNull();
  });

  it('ignores rows outside the candidate set entirely', () => {
    // A vendor conflict between Groceries and Other must not be swayed by
    // unrelated Leisure purchases at the same merchant.
    const result = mostFrequentCategory(
      rows('Leisure', 'Leisure', 'Leisure', 'Groceries', 'Other'),
      ['Groceries', 'Other'],
    );
    expect(result).toBeNull();
  });

  it('handles three or more conflicting categories, not just two', () => {
    const result = mostFrequentCategory(
      rows('Groceries', 'Other', 'Other', 'Other', 'Leisure'),
      ['Groceries', 'Other', 'Leisure'],
    );
    expect(result).toBe('Other');
  });

  it('handles rows with no budget at all', () => {
    const result = mostFrequentCategory(
      [{ budget: null }, { budget: undefined }, { budget: '' }, { budget: 'Groceries' }],
      ['Groceries', 'Other'],
    );
    expect(result).toBe('Groceries');
  });

  it('returns null with no candidates', () => {
    expect(mostFrequentCategory(rows('Groceries'), [])).toBeNull();
  });
});
