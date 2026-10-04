import { describe, expect, it } from 'vitest';
import type { MerchantFrequencyRow } from '../../budgets/categoryFrequency';
import type { VendorMapEntry } from '../localNotificationMemory';
import {
  assignCaptureCategory,
  type NotificationCategoryAssignmentDependencies,
  type NotificationCategoryAssignmentInput,
  type VendorRuleRow,
} from '../notificationCategoryAssignment';

const CATEGORIES = [
  { id: 'budget:groceries', name: 'Groceries' },
  { id: 'budget:leisure', name: 'Leisure' },
  { id: 'budget:transport', name: 'Transport' },
  { id: 'budget:subscriptions', name: 'Subscriptions' },
  { id: 'budget:other', name: 'Other' },
] as const;

function makeInput(
  overrides: Partial<NotificationCategoryAssignmentInput> = {},
): NotificationCategoryAssignmentInput {
  return {
    userId: 'user-1',
    vendor: 'Costco',
    vendorAliases: [],
    parsed: { vendorKey: 'costco', vendorDisplay: 'Costco' },
    availableCategories: CATEGORIES,
    ...overrides,
  };
}

function makeDependencies(
  overrides: Partial<NotificationCategoryAssignmentDependencies> = {},
): NotificationCategoryAssignmentDependencies {
  return {
    vendorRules: Promise.resolve({ data: [] }),
    readTransactionFrequencies: async () => ({ data: [] }),
    readProperNameRule: async () => ({ data: [] }),
    fetchPartnerRules: async () => [],
    lookupCommunityRule: () => null,
    getVendorMap: () => ({}),
    ...overrides,
  };
}

describe('assignCaptureCategory', () => {
  it('uses the household rule that exactly matches the polished vendor key', async () => {
    const rules: VendorRuleRow[] = [{
      category_id: 'Groceries',
      proper_name: 'Costco',
      match_key: 'costco',
      match_type: 'exact',
    }];

    const result = await assignCaptureCategory(makeInput(), makeDependencies({
      vendorRules: Promise.resolve({ data: rules }),
    }));

    expect(result).toMatchObject({
      categoryId: 'budget:groceries',
      categoryName: 'Groceries',
      displayVendor: 'Costco',
      overrideMatchConfidence: 1,
      overrideRuleConflict: false,
    });
  });

  it('tries an alias only after the polished key and scores confidence on the alias key', async () => {
    const rules: VendorRuleRow[] = [{
      category_id: 'Subscriptions',
      proper_name: 'Google',
      match_key: 'google',
      match_type: 'prefix',
    }];

    const result = await assignCaptureCategory(makeInput({
      vendor: 'YouTube Premium',
      vendorAliases: ['Google YouTube Premium'],
      parsed: { vendorKey: 'youtube premium', vendorDisplay: 'YouTube Premium' },
    }), makeDependencies({
      vendorRules: Promise.resolve({ data: rules }),
    }));

    expect(result.categoryName).toBe('Subscriptions');
    expect(result.displayVendor).toBe('Google');
    expect(result.overrideMatchConfidence).toBe(0.3);

    const polishedRule: VendorRuleRow = {
      category_id: 'Groceries',
      proper_name: 'YouTube Premium',
      match_key: 'youtubepremium',
      match_type: 'exact',
    };
    const polishedResult = await assignCaptureCategory(makeInput({
      vendor: 'YouTube Premium',
      vendorAliases: ['Google YouTube Premium'],
      parsed: { vendorKey: 'youtubepremium', vendorDisplay: 'YouTube Premium' },
    }), makeDependencies({
      vendorRules: Promise.resolve({ data: [...rules, polishedRule] }),
    }));

    expect(polishedResult.categoryName).toBe('Groceries');
    expect(polishedResult.overrideMatchConfidence).toBe(1);
  });

  it('suggests the most common real category on a merchant-wide conflict without auto-filing', async () => {
    const rules: VendorRuleRow[] = [
      {
        category_id: 'Groceries',
        proper_name: "Wendy's",
        match_key: 'wendys',
        match_type: 'exact',
      },
      {
        category_id: 'Leisure',
        proper_name: "Wendy's",
        match_key: 'wendysolympic',
        match_type: 'prefix',
      },
      {
        category_id: 'Other',
        proper_name: "Wendy's",
        match_key: 'wendyscrowfoot',
        match_type: 'prefix',
      },
    ];
    const frequencyCalls: Array<{ userId: string; candidateNames: string[] }> = [];
    const frequencyRows: MerchantFrequencyRow[] = [
      ...Array.from({ length: 4 }, () => ({ vendor: "Wendy's", budget: 'Groceries' })),
      { vendor: "Wendy's", budget: 'Leisure' },
      ...Array.from({ length: 8 }, () => ({ vendor: "Wendy's", budget: 'Other' })),
    ];

    const result = await assignCaptureCategory(makeInput({
      vendor: "Wendy's",
      parsed: { vendorKey: 'wendys', vendorDisplay: "Wendy's" },
    }), makeDependencies({
      vendorRules: Promise.resolve({ data: rules }),
      readTransactionFrequencies: async (userId, candidateNames) => {
        frequencyCalls.push({ userId, candidateNames });
        return { data: frequencyRows };
      },
    }));

    expect(frequencyCalls).toEqual([{
      userId: 'user-1',
      candidateNames: ['Groceries', 'Leisure'],
    }]);
    expect(result).toMatchObject({
      categoryId: 'budget:groceries',
      categoryName: 'Groceries',
      overrideMatchConfidence: 0,
      overrideRuleConflict: true,
    });
  });

  it('keeps a conflict when the household frequency read throws', async () => {
    const rules: VendorRuleRow[] = [
      { category_id: 'Groceries', proper_name: 'Walmart', match_key: 'walmart', match_type: 'exact' },
      { category_id: 'Transport', proper_name: 'Walmart', match_key: 'walmart', match_type: 'exact' },
    ];

    const result = await assignCaptureCategory(makeInput({
      vendor: 'Walmart',
      parsed: { vendorKey: 'walmart', vendorDisplay: 'Walmart' },
      availableCategories: [],
    }), makeDependencies({
      vendorRules: Promise.resolve({ data: rules }),
      readTransactionFrequencies: async () => {
        throw new Error('history unavailable');
      },
    }));

    expect(result).toMatchObject({
      categoryId: null,
      categoryName: null,
      overrideMatchConfidence: 0,
      overrideRuleConflict: true,
    });
  });

  it('uses a proper-name rule at full confidence when no key rule matches', async () => {
    const properNameReads: string[] = [];

    const result = await assignCaptureCategory(makeInput({
      vendor: 'Unknown Costco format',
      parsed: { vendorKey: 'unknowncostcoformat', vendorDisplay: 'Unknown Costco format' },
    }), makeDependencies({
      readProperNameRule: async (_userId, name) => {
        properNameReads.push(name);
        return {
          data: name === 'Unknown Costco format'
            ? [{ category_id: 'Groceries', proper_name: 'Costco', match_key: null }]
            : [],
        };
      },
    }));

    expect(properNameReads).toEqual(['Unknown Costco format']);
    expect(result).toMatchObject({
      categoryName: 'Groceries',
      displayVendor: 'Costco',
      overrideMatchConfidence: 1,
    });
  });

  it('skips proper-name lookup when the matched merchant has conflicting rules', async () => {
    const rules: VendorRuleRow[] = [
      { category_id: 'Groceries', proper_name: 'Walmart', match_key: 'walmart', match_type: 'exact' },
      { category_id: 'Transport', proper_name: 'Walmart', match_key: 'walmart', match_type: 'exact' },
    ];
    let properNameReads = 0;

    const result = await assignCaptureCategory(makeInput({
      vendor: 'Walmart',
      parsed: { vendorKey: 'walmart', vendorDisplay: 'Walmart' },
    }), makeDependencies({
      vendorRules: Promise.resolve({ data: rules }),
      readProperNameRule: async () => {
        properNameReads += 1;
        return { data: [{ category_id: 'Groceries', proper_name: 'Walmart', match_key: null }] };
      },
    }));

    expect(properNameReads).toBe(0);
    expect(result.overrideRuleConflict).toBe(true);
    expect(result.overrideMatchConfidence).toBe(0);
  });

  it('rescues a narrow Other rule to the merchant single real category at zero confidence', async () => {
    const rules: VendorRuleRow[] = [
      {
        category_id: 'Other',
        proper_name: "Wendy's",
        match_key: 'wendyscrowfoot',
        match_type: 'exact',
      },
      {
        category_id: 'Leisure',
        proper_name: "Wendy's",
        match_key: 'wendysolympic',
        match_type: 'exact',
      },
    ];

    const result = await assignCaptureCategory(makeInput({
      vendor: "Wendy's Crowfoot",
      parsed: { vendorKey: 'wendyscrowfoot', vendorDisplay: "Wendy's Crowfoot" },
    }), makeDependencies({
      vendorRules: Promise.resolve({ data: rules }),
    }));

    expect(result).toMatchObject({
      categoryId: 'budget:leisure',
      categoryName: 'Leisure',
      displayVendor: "Wendy's",
      overrideMatchConfidence: 0,
      overrideRuleConflict: false,
    });
  });

  it('uses a partner rule only as a zero-confidence suggestion and adopts its proper name', async () => {
    const partnerRules: VendorRuleRow[] = [{
      category_id: 'Groceries',
      proper_name: 'Costco Wholesale',
      match_key: 'costco',
      match_type: 'prefix',
    }];

    const result = await assignCaptureCategory(makeInput(), makeDependencies({
      fetchPartnerRules: async () => partnerRules,
    }));

    expect(result).toMatchObject({
      categoryId: 'budget:groceries',
      categoryName: 'Groceries',
      displayVendor: 'Costco Wholesale',
      overrideMatchConfidence: 0,
    });
  });

  it('does not suggest either side of a partner-rule disagreement', async () => {
    const partnerRules: VendorRuleRow[] = [
      { category_id: 'Groceries', proper_name: 'Costco', match_key: 'costco', match_type: 'exact' },
      { category_id: 'Transport', proper_name: 'Costco', match_key: 'costco', match_type: 'exact' },
    ];

    const result = await assignCaptureCategory(makeInput({
      availableCategories: [],
    }), makeDependencies({
      fetchPartnerRules: async () => partnerRules,
    }));

    expect(result).toMatchObject({
      categoryId: null,
      categoryName: null,
      displayVendor: 'Costco',
      overrideMatchConfidence: 0,
    });
  });

  it('uses a community category as a zero-confidence suggestion without renaming the merchant', async () => {
    const result = await assignCaptureCategory(makeInput({
      vendor: 'Costco Warehouse',
      parsed: { vendorKey: 'costcowarehouse', vendorDisplay: 'Costco Warehouse' },
    }), makeDependencies({
      lookupCommunityRule: (vendorKey) =>
        vendorKey === 'costcowarehouse'
          ? { matchKey: 'costcowarehouse', category: 'Groceries' }
          : null,
    }));

    expect(result).toMatchObject({
      categoryId: 'budget:groceries',
      categoryName: 'Groceries',
      displayVendor: 'Costco Warehouse',
      overrideMatchConfidence: 0,
    });
  });

  it('does not consult borrowed layers after the household has a conflict', async () => {
    const rules: VendorRuleRow[] = [
      { category_id: 'Groceries', proper_name: 'Costco', match_key: 'costco', match_type: 'exact' },
      { category_id: 'Transport', proper_name: 'Costco', match_key: 'costco', match_type: 'exact' },
    ];
    let partnerReads = 0;
    let communityReads = 0;

    const result = await assignCaptureCategory(makeInput(), makeDependencies({
      vendorRules: Promise.resolve({ data: rules }),
      fetchPartnerRules: async () => {
        partnerReads += 1;
        return [{ category_id: 'Groceries', proper_name: 'Costco', match_key: 'costco' }];
      },
      lookupCommunityRule: () => {
        communityReads += 1;
        return { matchKey: 'costco', category: 'Groceries' };
      },
    }));

    expect(result.overrideRuleConflict).toBe(true);
    expect(result.overrideMatchConfidence).toBe(0);
    expect(partnerReads).toBe(0);
    expect(communityReads).toBe(0);
  });

  it('prefers the exact vendor-map entry', async () => {
    const exact: VendorMapEntry = {
      vendor_key: 'amazon',
      vendor_display: 'Amazon',
      budget: 'Groceries',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const fuzzy: VendorMapEntry = {
      vendor_key: 'amazonprime',
      vendor_display: 'Amazon Prime',
      budget: 'Subscriptions',
      updated_at: '2026-01-02T00:00:00Z',
    };

    const result = await assignCaptureCategory(makeInput({
      vendor: 'Amazon',
      parsed: { vendorKey: 'amazon', vendorDisplay: 'Amazon' },
    }), makeDependencies({
      getVendorMap: () => ({ amazon: exact, amazonprime: fuzzy }),
    }));

    expect(result).toMatchObject({
      categoryId: 'budget:groceries',
      categoryName: 'Groceries',
      displayVendor: 'Amazon',
      overrideMatchConfidence: 0,
    });
  });

  it('uses a fuzzy vendor-map entry when no exact key exists', async () => {
    const entry: VendorMapEntry = {
      vendor_key: 'amazon-prime',
      vendor_display: 'Amazon Prime',
      budget: 'Subscriptions',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const result = await assignCaptureCategory(makeInput({
      vendor: 'Amazon Prime',
      parsed: { vendorKey: 'amazonprimecapture', vendorDisplay: 'Amazon Prime' },
    }), makeDependencies({
      getVendorMap: () => ({ 'amazon-prime': entry }),
    }));

    expect(result).toMatchObject({
      categoryId: 'budget:subscriptions',
      categoryName: 'Subscriptions',
      displayVendor: 'Amazon Prime',
      overrideMatchConfidence: 0,
    });
  });

  it('preserves the AI, merchant-signal, and fallback choice kinds', async () => {
    const ai = await assignCaptureCategory(makeInput({
      vendor: 'Unknown Merchant',
      aiSuggestedCategory: 'Groceries',
    }), makeDependencies());
    expect(ai.categoryName).toBe('Groceries');

    const signal = await assignCaptureCategory(makeInput({
      vendor: 'TST* PIZZA',
      parsed: { vendorKey: 'tstpizza', vendorDisplay: 'TST* PIZZA' },
      availableCategories: [
        { id: 'budget:leisure', name: 'Leisure' },
        { id: 'budget:other', name: 'Other' },
      ],
    }), makeDependencies());
    expect(signal.categoryName).toBe('Leisure');

    const fallback = await assignCaptureCategory(makeInput({
      vendor: 'Unlisted Merchant',
      parsed: { vendorKey: 'unlistedmerchant', vendorDisplay: 'Unlisted Merchant' },
    }), makeDependencies());
    expect(fallback.categoryName).toBe('Other');
  });

  it('returns null when no categories are available', async () => {
    const result = await assignCaptureCategory(makeInput({
      availableCategories: [],
    }), makeDependencies());

    expect(result.categoryId).toBeNull();
    expect(result.categoryName).toBeNull();
  });
});
