/**
 * A category conflict still goes to review, but the household's past filings
 * can give the reviewer a sensible starting category. A failed history read
 * must leave the conflict in review rather than fail the capture.
 */
import { describe, it, expect } from 'vitest';
import {
  assignCaptureCategory,
  type NotificationCategoryAssignmentDependencies,
  type NotificationCategoryAssignmentInput,
  type VendorRuleRow,
} from '../notificationCategoryAssignment';

const CATEGORIES = [
  { id: 'budget:groceries', name: 'Groceries' },
  { id: 'budget:leisure', name: 'Leisure' },
  { id: 'budget:other', name: 'Other' },
];

const CONFLICTING_RULES: VendorRuleRow[] = [
  { category_id: 'Groceries', proper_name: 'Walmart', match_key: 'walmart', match_type: 'exact' },
  { category_id: 'Leisure', proper_name: 'Walmart', match_key: 'walmart', match_type: 'exact' },
];

function makeInput(
  overrides: Partial<NotificationCategoryAssignmentInput> = {},
): NotificationCategoryAssignmentInput {
  return {
    userId: 'user-1',
    vendor: 'Walmart',
    vendorAliases: [],
    parsed: { vendorKey: 'walmart', vendorDisplay: 'Walmart' },
    availableCategories: CATEGORIES,
    ...overrides,
  };
}

function makeDependencies(
  overrides: Partial<NotificationCategoryAssignmentDependencies> = {},
): NotificationCategoryAssignmentDependencies {
  return {
    vendorRules: Promise.resolve({ data: CONFLICTING_RULES }),
    readTransactionFrequencies: async () => ({ data: [] }),
    readProperNameRule: async () => ({ data: [] }),
    fetchPartnerRules: async () => [],
    lookupCommunityRule: () => null,
    getVendorMap: () => ({}),
    ...overrides,
  };
}

describe('the category suggestion on a conflicting vendor', () => {
  it('suggests the household category with more matching history', async () => {
    const result = await assignCaptureCategory(makeInput(), makeDependencies({
      readTransactionFrequencies: async () => ({
        data: [
          { vendor: 'Walmart', budget: 'Groceries' },
          { vendor: 'Walmart', budget: 'Groceries' },
          { vendor: 'Walmart', budget: 'Leisure' },
        ],
      }),
    }));

    expect(result.categoryName).toBe('Groceries');
    expect(result.overrideRuleConflict).toBe(true);
  });

  it('keeps confidence at zero so a suggested conflict cannot auto-file', async () => {
    const result = await assignCaptureCategory(makeInput(), makeDependencies({
      readTransactionFrequencies: async () => ({
        data: [{ vendor: 'Walmart', budget: 'Groceries' }],
      }),
    }));

    expect(result.categoryId).toBe('budget:groceries');
    expect(result.overrideMatchConfidence).toBe(0);
  });

  it('keeps the capture reviewable if the history read fails', async () => {
    await expect(assignCaptureCategory(makeInput(), makeDependencies({
      readTransactionFrequencies: async () => {
        throw new Error('history unavailable');
      },
    }))).resolves.toMatchObject({
      categoryId: 'budget:other',
      categoryName: 'Other',
      overrideMatchConfidence: 0,
      overrideRuleConflict: true,
    });
  });

  it('scopes the history read to this user and the categories in conflict', async () => {
    const calls: Array<{ userId: string; candidateNames: string[] }> = [];
    await assignCaptureCategory(makeInput(), makeDependencies({
      readTransactionFrequencies: async (userId, candidateNames) => {
        calls.push({ userId, candidateNames });
        return { data: [] };
      },
    }));

    expect(calls).toEqual([{
      userId: 'user-1',
      candidateNames: ['Groceries', 'Leisure'],
    }]);
  });
});
