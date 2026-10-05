/**
 * A chain writes one rule per branch, and those rules have to be read as one
 * merchant's opinion rather than three unrelated ones.
 *
 * The failure these pin is a real one. A household had three Wendy's rules —
 * `wendyscrowfoot → Other`, `wendysolympic → Leisure`,
 * `wendyscochrane → Leisure`, all displayed as "Wendy's". A capture from the
 * Crowfoot branch matched exactly one of them, so the pipeline's "these rules
 * disagree, ask rather than guess" check found nothing to disagree about and
 * silently filed a restaurant under Other — months after every other Wendy's
 * had been put in Leisure. Meanwhile the review screen, which groups by
 * display name, offered the choice as "Wendy's · Leisure", "Wendy's · Leisure"
 * and "Wendy's · Other": the same answer twice, indistinguishable on screen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decideMerchantRuleChoice,
  merchantRuleScope,
  distinctCategories,
  dedupeByCategory,
} from '../vendorRuleScope';
import {
  assignCaptureCategory,
  type NotificationCategoryAssignmentDependencies,
  type NotificationCategoryAssignmentInput,
  type VendorRuleRow,
} from '../../capture/notificationCategoryAssignment';

const WENDYS = [
  { proper_name: "Wendy's", match_key: 'wendysolympic', category_id: 'Leisure' },
  { proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_id: 'Other' },
  { proper_name: "Wendy's", match_key: 'wendyscochrane', category_id: 'Leisure' },
  { proper_name: 'Costco', match_key: 'costco', category_id: 'Groceries' },
];

const ASSIGNMENT_CATEGORIES = [
  { id: 'budget:groceries', name: 'Groceries' },
  { id: 'budget:leisure', name: 'Leisure' },
  { id: 'budget:transport', name: 'Transport' },
  { id: 'budget:other', name: 'Other' },
];

function makeAssignmentInput(
  overrides: Partial<NotificationCategoryAssignmentInput> = {},
): NotificationCategoryAssignmentInput {
  return {
    userId: 'user-1',
    vendor: "Wendy's Crowfoot",
    vendorAliases: [],
    parsed: { vendorKey: 'wendyscrowfoot', vendorDisplay: "Wendy's Crowfoot" },
    availableCategories: ASSIGNMENT_CATEGORIES,
    ...overrides,
  };
}

function makeAssignmentDependencies(
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

describe('merchantRuleScope', () => {
  it('pulls in the other branches of the same merchant', () => {
    const matched = [WENDYS[1]]; // only the Crowfoot slug fires on this capture
    const scoped = merchantRuleScope(matched, WENDYS);
    expect(scoped).toHaveLength(3);
    expect(scoped.map((r) => r.match_key).sort()).toEqual([
      'wendyscochrane',
      'wendyscrowfoot',
      'wendysolympic',
    ]);
  });

  it('turns a one-branch match into a conflict the pipeline can see', () => {
    // The whole point. Before this, one slug matched one rule, so
    // distinctCategories was {Other} and the capture filed itself.
    expect(distinctCategories([WENDYS[1]])).toEqual(['other']);
    expect(distinctCategories(merchantRuleScope([WENDYS[1]], WENDYS)).sort()).toEqual([
      'leisure',
      'other',
    ]);
  });

  it('leaves a merchant whose rules agree exactly as it was', () => {
    const agreeing = [
      { proper_name: 'Costco', match_key: 'costco', category_id: 'Groceries' },
      { proper_name: 'Costco', match_key: 'costcogas', category_id: 'Groceries' },
    ];
    expect(distinctCategories(merchantRuleScope([agreeing[0]], agreeing))).toEqual(['groceries']);
  });

  it('never widens to a different merchant', () => {
    const scoped = merchantRuleScope([WENDYS[3]], WENDYS);
    expect(scoped).toEqual([WENDYS[3]]);
  });

  it('does not group rules that simply have no display name', () => {
    // An empty proper_name is missing data, not a merchant every other
    // nameless rule belongs to. Grouping on it would make one bad row put the
    // whole rules table in conflict with itself.
    const nameless = [
      { proper_name: '', match_key: 'a', category_id: 'Groceries' },
      { proper_name: '', match_key: 'b', category_id: 'Leisure' },
    ];
    expect(merchantRuleScope([nameless[0]], nameless)).toEqual([nameless[0]]);
  });

  it('matches the display name case- and space-insensitively', () => {
    const mixed = [
      { proper_name: "Wendy's", match_key: 'wendysa', category_id: 'Leisure' },
      { proper_name: "  wendy's ", match_key: 'wendysb', category_id: 'Other' },
    ];
    expect(merchantRuleScope([mixed[0]], mixed)).toHaveLength(2);
  });

  it('returns nothing when nothing matched', () => {
    expect(merchantRuleScope([], WENDYS)).toEqual([]);
  });

  it('never returns the same rule twice', () => {
    const scoped = merchantRuleScope([WENDYS[0], WENDYS[1]], WENDYS);
    expect(scoped).toHaveLength(3);
  });
});

describe('choosing among a merchant\'s learned rules', () => {
  it('asks for review when sibling branches point to different real categories', () => {
    const costcoRules = [
      { proper_name: 'Costco', match_key: 'costcowholesale', category_id: 'Groceries' },
      { proper_name: 'Costco', match_key: 'costcogas', category_id: 'Transport' },
    ];

    expect(decideMerchantRuleChoice([costcoRules[0]], costcoRules)).toEqual({
      kind: 'conflict',
      merchantRules: costcoRules,
      realCategories: ['groceries', 'transport'],
    });
  });

  it('ignores Other as an opinion but only returns the branch that matched', () => {
    const choice = decideMerchantRuleChoice([WENDYS[1]], WENDYS);

    expect(choice.kind).toBe('matched');
    expect(choice.realCategories).toEqual(['leisure']);
    expect(choice.merchantRules.map(rule => rule.match_key)).toEqual([
      'wendyscrowfoot',
      'wendysolympic',
      'wendyscochrane',
    ]);
    if (choice.kind === 'matched') {
      expect(choice.rule.match_key).toBe('wendyscrowfoot');
    }
  });

  it('distinguishes an unmatched merchant from a rule that can be applied', () => {
    expect(decideMerchantRuleChoice([], WENDYS)).toEqual({
      kind: 'no-match',
      merchantRules: [],
      realCategories: [],
    });
  });
});

describe('dedupeByCategory', () => {
  const rules = [
    { properName: "Wendy's", categoryId: 'budget:leisure' },
    { properName: "Wendy's", categoryId: 'budget:leisure' },
    { properName: "Wendy's", categoryId: 'budget:other' },
  ];

  it('offers one entry per category, not one per stored rule', () => {
    const offered = dedupeByCategory(rules, (r) => r.categoryId);
    expect(offered.map((r) => r.categoryId)).toEqual(['budget:leisure', 'budget:other']);
  });

  it('keeps the caller order', () => {
    const offered = dedupeByCategory(
      [rules[2], rules[0], rules[1]],
      (r) => r.categoryId,
    );
    expect(offered.map((r) => r.categoryId)).toEqual(['budget:other', 'budget:leisure']);
  });

  it('keeps rows with no category rather than collapsing them together', () => {
    const broken = [{ categoryId: '' }, { categoryId: '' }];
    expect(dedupeByCategory(broken, (r) => r.categoryId)).toHaveLength(2);
  });
});

describe('the capture pipeline uses the merchant scope', () => {
  it('offers every merchant-wide conflicting category to the frequency read', async () => {
    const rules: VendorRuleRow[] = [
      { proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_id: 'Leisure', match_type: 'exact' },
      { proper_name: "Wendy's", match_key: 'wendysolympic', category_id: 'Groceries', match_type: 'exact' },
      { proper_name: "Wendy's", match_key: 'wendyscochrane', category_id: 'Transport', match_type: 'exact' },
    ];
    let candidates: string[] = [];
    await assignCaptureCategory(makeAssignmentInput({
      availableCategories: [],
    }), makeAssignmentDependencies({
      vendorRules: Promise.resolve({ data: rules }),
      readTransactionFrequencies: async (_userId, candidateNames) => {
        candidates = candidateNames;
        return { data: [] };
      },
    }));

    expect(candidates.sort()).toEqual(['Groceries', 'Leisure', 'Transport']);
  });

  it("does not suggest a partner rule when sibling branches disagree", async () => {
    const partnerRules: VendorRuleRow[] = [
      { proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_id: 'Leisure', match_type: 'exact' },
      { proper_name: "Wendy's", match_key: 'wendysolympic', category_id: 'Groceries', match_type: 'exact' },
    ];
    const result = await assignCaptureCategory(makeAssignmentInput({
      availableCategories: [],
    }), makeAssignmentDependencies({
      fetchPartnerRules: async () => partnerRules,
    }));

    expect(result.categoryId).toBeNull();
    expect(result.categoryName).toBeNull();
    expect(result.overrideMatchConfidence).toBe(0);
  });
});

describe('the review picker uses the deduped scope', () => {
  const source = readFileSync(
    resolve(__dirname, '../../../components/review/TransactionParsing/TransactionParsing.tsx'),
    'utf8',
  );

  it('collapses the rules it offers to one per category', () => {
    expect(source).toContain('dedupeByCategory(matching, (rule) => rule.categoryId)');
  });
});
