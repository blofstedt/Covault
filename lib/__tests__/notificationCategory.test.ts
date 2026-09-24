import { describe, expect, it } from 'vitest';
import { chooseNotificationFallbackCategory } from '../notificationCategory';

const CATEGORIES = [
  { id: 'cat-transport', name: 'Transport' },
  { id: 'cat-restaurants', name: 'Restaurants' },
  { id: 'cat-other', name: 'Other' },
];

describe('chooseNotificationFallbackCategory', () => {
  it('keeps a useful AI choice ahead of a matching merchant signal', () => {
    expect(chooseNotificationFallbackCategory({
      availableCategories: CATEGORIES,
      aiSuggestedCategory: 'transport',
      merchantText: 'TST* LA CARNITA',
    })).toEqual({
      kind: 'ai',
      category: { id: 'cat-transport', name: 'Transport' },
    });
  });

  it('lets a merchant signal replace the AI fallback of Other', () => {
    expect(chooseNotificationFallbackCategory({
      availableCategories: CATEGORIES,
      aiSuggestedCategory: 'Other',
      merchantText: 'TST* LA CARNITA',
    })).toEqual({
      kind: 'signal',
      category: { id: 'cat-restaurants', name: 'Restaurants' },
      signal: { kind: 'dining', evidence: 'TST* (Toast)' },
    });
  });

  it('keeps Other when the signal target is hidden', () => {
    expect(chooseNotificationFallbackCategory({
      availableCategories: CATEGORIES,
      aiSuggestedCategory: 'Other',
      merchantText: 'TST* LA CARNITA',
      hiddenCategoryIds: ['cat-restaurants'],
    })).toEqual({
      kind: 'ai',
      category: { id: 'cat-other', name: 'Other' },
    });
  });

  it('tries a merchant signal when the AI suggestion is not a known category', () => {
    expect(chooseNotificationFallbackCategory({
      availableCategories: CATEGORIES,
      aiSuggestedCategory: 'Dining out',
      merchantText: 'TST* LA CARNITA',
    })).toMatchObject({
      kind: 'signal',
      category: { id: 'cat-restaurants', name: 'Restaurants' },
    });
  });

  it('uses Other when there is no usable AI choice or signal', () => {
    expect(chooseNotificationFallbackCategory({
      availableCategories: CATEGORIES,
      aiSuggestedCategory: 'Unknown',
      merchantText: 'ACME HARDWARE',
    })).toEqual({
      kind: 'fallback',
      category: { id: 'cat-other', name: 'Other' },
    });
  });

  it('uses the first available category when Other is not present', () => {
    expect(chooseNotificationFallbackCategory({
      availableCategories: [
        { id: 'cat-housing', name: 'Housing' },
        { id: 'cat-transport', name: 'Transport' },
      ],
    })).toEqual({
      kind: 'fallback',
      category: { id: 'cat-housing', name: 'Housing' },
    });
  });

  it('returns none when no categories are available', () => {
    expect(chooseNotificationFallbackCategory({ availableCategories: [] })).toEqual({ kind: 'none' });
  });
});
