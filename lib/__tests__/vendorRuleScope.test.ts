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
import { merchantRuleScope, distinctCategories, dedupeByCategory } from '../vendorRuleScope';

const WENDYS = [
  { proper_name: "Wendy's", match_key: 'wendysolympic', category_id: 'Leisure' },
  { proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_id: 'Other' },
  { proper_name: "Wendy's", match_key: 'wendyscochrane', category_id: 'Leisure' },
  { proper_name: 'Costco', match_key: 'costco', category_id: 'Groceries' },
];

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
  const source = readFileSync(resolve(__dirname, '../notificationProcessor.ts'), 'utf8');

  it('decides the conflict on the merchant, not on the slug that matched', () => {
    expect(source).toContain('const merchantRules = merchantRuleScope(matching, allRows)');
    expect(source).toContain('const conflictingCategories = distinctCategories(merchantRules)');
    expect(source).toContain('overrideRuleConflict = conflictingCategories.length > 1');
  });

  it('still applies only a rule that actually matched this capture', () => {
    // Widening decides WHETHER to ask. It must never change which rule gets
    // applied when there is nothing to ask about, or a capture could be filed
    // under a branch whose slug the bank never sent.
    expect(source).toContain('overrideRows = overrideRuleConflict ? [] : matching.slice(0, 1)');
  });

  it('offers every conflicting category as a suggestion candidate', () => {
    expect(source).toContain(
      'const candidateNames = [...new Set(merchantRules.map',
    );
  });

  it("applies the same scope to the partner's rules", () => {
    expect(source).toContain(
      'const partnerCategories = distinctCategories(merchantRuleScope(matching, partnerRows))',
    );
  });
});

describe('the review picker uses the deduped scope', () => {
  const source = readFileSync(
    resolve(__dirname, '../../components/TransactionParsing.tsx'),
    'utf8',
  );

  it('collapses the rules it offers to one per category', () => {
    expect(source).toContain('dedupeByCategory(matching, (rule) => rule.categoryId)');
  });
});
