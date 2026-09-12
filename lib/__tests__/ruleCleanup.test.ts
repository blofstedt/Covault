/**
 * `findStaleOtherRules` and `findChainMergeGroups` decide what the "Needs
 * attention" section of LearnedRulesCard offers to clean up. Both mirror a
 * rule the capture pipeline already applies (see otherRuleIsNotADecision.test
 * and vendorRuleScope.test), so getting either wrong here means offering to
 * delete or combine something the pipeline still actually relies on.
 */
import { describe, it, expect } from 'vitest';
import { findStaleOtherRules, findChainMergeGroups, type CleanupRule } from '../ruleCleanup';

function rule(overrides: Partial<CleanupRule> & { id: string; proper_name: string }): CleanupRule {
  return { match_type: 'exact', ...overrides };
}

describe('findStaleOtherRules', () => {
  it('flags a branch taught Other when the rest of the merchant agrees on one real category', () => {
    const rules = [
      rule({ id: '1', proper_name: "Wendy's", match_key: 'wendysolympic', category_name: 'Leisure' }),
      rule({ id: '2', proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_name: 'Other' }),
      rule({ id: '3', proper_name: "Wendy's", match_key: 'wendyscochrane', category_name: 'Leisure' }),
    ];
    const groups = findStaleOtherRules(rules);
    expect(groups).toHaveLength(1);
    expect(groups[0].properName).toBe("Wendy's");
    expect(groups[0].realCategoryName).toBe('Leisure');
    expect(groups[0].staleRules.map((r) => r.id)).toEqual(['2']);
  });

  it('never flags a merchant with two real categories — a genuine split, not a leftover', () => {
    // Costco: Groceries and Transport (the gas bar) are both real answers.
    const rules = [
      rule({ id: '1', proper_name: 'Costco', match_key: 'costco', category_name: 'Groceries' }),
      rule({ id: '2', proper_name: 'Costco', match_key: 'costcogas', category_name: 'Transport' }),
    ];
    expect(findStaleOtherRules(rules)).toEqual([]);
  });

  it('never flags a merchant whose only rules are Other — that is the household\'s own consistent answer', () => {
    // Amazon: every rule is Other, every time. Nothing here is "leftover".
    const rules = [
      rule({ id: '1', proper_name: 'Amazon', match_key: 'amznmktpca', category_name: 'Other' }),
      rule({ id: '2', proper_name: 'Amazon', match_key: 'amazonca', category_name: 'Other' }),
    ];
    expect(findStaleOtherRules(rules)).toEqual([]);
  });

  it('never flags a merchant with two or more real categories plus an Other row', () => {
    const rules = [
      rule({ id: '1', proper_name: 'Costco', match_key: 'costco', category_name: 'Groceries' }),
      rule({ id: '2', proper_name: 'Costco', match_key: 'costcogas', category_name: 'Transport' }),
      rule({ id: '3', proper_name: 'Costco', match_key: 'costcowholesale', category_name: 'Other' }),
    ];
    expect(findStaleOtherRules(rules)).toEqual([]);
  });

  it('groups the display name case- and space-insensitively', () => {
    const rules = [
      rule({ id: '1', proper_name: "Wendy's", category_name: 'Leisure' }),
      rule({ id: '2', proper_name: "  wendy's ", category_name: 'Other' }),
    ];
    expect(findStaleOtherRules(rules)).toHaveLength(1);
  });

  it('does not group rules with no display name', () => {
    const rules = [
      rule({ id: '1', proper_name: '', category_name: 'Leisure' }),
      rule({ id: '2', proper_name: '', category_name: 'Other' }),
    ];
    expect(findStaleOtherRules(rules)).toEqual([]);
  });

  it('returns nothing for an empty rule set', () => {
    expect(findStaleOtherRules([])).toEqual([]);
  });
});

describe('an unsaved (temp-) row is never a cleanup candidate', () => {
  // The one that would have cost a real rule. `handleSetVendorCategory`
  // inserts optimistically under a `temp-` id, and the delete path falls back
  // to deleting a temp row by (proper_name, category) — which every row in a
  // chain merge group shares. Offering the temp row for combining meant
  // "combine these" PATCHed one row and then deleted every Wendy's → Leisure
  // row in the table, the kept one included.
  it('leaves a chain group alone when the only sibling is an unsaved row', () => {
    const rules = [
      rule({ id: 'real', proper_name: "Wendy's", match_key: 'wendysolympic', category_name: 'Leisure' }),
      rule({ id: 'temp-abc', proper_name: "Wendy's", match_key: undefined, category_name: 'Leisure' }),
    ];
    expect(findChainMergeGroups(rules)).toEqual([]);
  });

  it('omits an unsaved row from a chain group that stands on its own', () => {
    const rules = [
      rule({ id: 'a', proper_name: "Wendy's", match_key: 'wendysolympic', category_name: 'Leisure' }),
      rule({ id: 'b', proper_name: "Wendy's", match_key: 'wendyscochrane', category_name: 'Leisure' }),
      rule({ id: 'temp-abc', proper_name: "Wendy's", match_key: undefined, category_name: 'Leisure' }),
    ];
    const groups = findChainMergeGroups(rules);
    expect(groups).toHaveLength(1);
    expect(groups[0].branches.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('never offers an unsaved Other row for removal', () => {
    const rules = [
      rule({ id: 'real', proper_name: 'Walmart', match_key: 'walmart', category_name: 'Groceries' }),
      rule({ id: 'temp-abc', proper_name: 'Walmart', match_key: undefined, category_name: 'Other' }),
    ];
    expect(findStaleOtherRules(rules)).toEqual([]);
  });

  it('does not let an unsaved row supply the one real category that makes an Other row stale', () => {
    const rules = [
      rule({ id: 'real', proper_name: 'Walmart', match_key: 'walmart', category_name: 'Other' }),
      rule({ id: 'temp-abc', proper_name: 'Walmart', match_key: undefined, category_name: 'Groceries' }),
    ];
    expect(findStaleOtherRules(rules)).toEqual([]);
  });
});

describe('findChainMergeGroups', () => {
  it('groups branches of a known chain that already agree on one category', () => {
    const rules = [
      rule({ id: '1', proper_name: "Wendy's", match_key: 'wendysolympic', category_name: 'Leisure' }),
      rule({ id: '2', proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_name: 'Leisure' }),
      rule({ id: '3', proper_name: "Wendy's", match_key: 'wendyscochrane', category_name: 'Leisure' }),
    ];
    const groups = findChainMergeGroups(rules);
    expect(groups).toHaveLength(1);
    expect(groups[0].chainRoot).toBe('wendys');
    expect(groups[0].categoryName).toBe('Leisure');
    expect(groups[0].canonical).toBeUndefined();
    expect(groups[0].branches.map((r) => r.id).sort()).toEqual(['1', '2', '3']);
  });

  it('never offers a chain not on the safe list, even with several matching-category branches', () => {
    // Costco is deliberately excluded — a blanket "costco" rule would risk
    // folding the gas-bar charge into whatever the warehouse run was taught.
    const rules = [
      rule({ id: '1', proper_name: 'Costco', match_key: 'costcodowntown', category_name: 'Groceries' }),
      rule({ id: '2', proper_name: 'Costco', match_key: 'costcocrowfoot', category_name: 'Groceries' }),
    ];
    expect(findChainMergeGroups(rules)).toEqual([]);
  });

  it('never offers Other rows for merging', () => {
    const rules = [
      rule({ id: '1', proper_name: "Wendy's", match_key: 'wendysolympic', category_name: 'Other' }),
      rule({ id: '2', proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_name: 'Other' }),
    ];
    expect(findChainMergeGroups(rules)).toEqual([]);
  });

  it('never offers a lone branch — nothing to combine with', () => {
    const rules = [
      rule({ id: '1', proper_name: "Wendy's", match_key: 'wendysolympic', category_name: 'Leisure' }),
    ];
    expect(findChainMergeGroups(rules)).toEqual([]);
  });

  it('only groups branches that agree — a disagreeing branch starts its own group', () => {
    const rules = [
      rule({ id: '1', proper_name: "Wendy's", match_key: 'wendysolympic', category_name: 'Leisure' }),
      rule({ id: '2', proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_name: 'Leisure' }),
      rule({ id: '3', proper_name: "Wendy's", match_key: 'wendyscochrane', category_name: 'Services' }),
    ];
    const groups = findChainMergeGroups(rules);
    expect(groups).toHaveLength(1);
    expect(groups[0].categoryName).toBe('Leisure');
    expect(groups[0].branches.map((r) => r.id).sort()).toEqual(['1', '2']);
  });

  it('recognises an already-combined chain rule as the canonical row, not a fourth branch', () => {
    const rules = [
      rule({ id: 'canon', proper_name: "Wendy's", match_key: 'wendys', match_type: 'prefix', category_name: 'Leisure' }),
      rule({ id: '1', proper_name: "Wendy's", match_key: 'wendysnew', category_name: 'Leisure' }),
    ];
    const groups = findChainMergeGroups(rules);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical?.id).toBe('canon');
    expect(groups[0].branches.map((r) => r.id)).toEqual(['1']);
  });

  it('does not offer an already-combined chain rule with no remaining branches', () => {
    const rules = [
      rule({ id: 'canon', proper_name: "Wendy's", match_key: 'wendys', match_type: 'prefix', category_name: 'Leisure' }),
    ];
    expect(findChainMergeGroups(rules)).toEqual([]);
  });

  it('does not mistake an unrelated hand-made prefix rule for a chain rule', () => {
    // match_type 'prefix' alone is not enough — the key itself has to be a
    // known chain root, or an ordinary vendor's own prefix rule would be
    // swept into a "chain" that does not exist.
    const rules = [
      rule({ id: '1', proper_name: 'Local Cafe', match_key: 'localcafe', match_type: 'prefix', category_name: 'Leisure' }),
      rule({ id: '2', proper_name: 'Local Cafe', match_key: 'localcafedowntown', category_name: 'Leisure' }),
    ];
    expect(findChainMergeGroups(rules)).toEqual([]);
  });

  it('is safe on empty input', () => {
    expect(findChainMergeGroups([])).toEqual([]);
  });

  // A real shape from a live household: one rule keyed to the bare chain
  // name ("mcdonalds", nothing appended) and one keyed to a branch
  // ("mcdonaldsqo4"). `chainAwareMatchKey` correctly leaves the bare one as
  // `exact` — there's nothing to generalise away — but that made it
  // invisible to this function entirely, so the two never merged.
  it('groups a bare chain-name exact rule together with a branch-specific one', () => {
    const rules = [
      rule({ id: 'bare', proper_name: "McDonald's", match_key: 'mcdonalds', category_name: 'Leisure' }),
      rule({ id: 'branch', proper_name: "McDonald's", match_key: 'mcdonaldsqo4', category_name: 'Leisure' }),
    ];
    const groups = findChainMergeGroups(rules);
    expect(groups).toHaveLength(1);
    expect(groups[0].chainRoot).toBe('mcdonalds');
    expect(groups[0].canonical).toBeUndefined();
    expect(groups[0].branches.map((r) => r.id).sort()).toEqual(['bare', 'branch']);
  });

  it('groups two bare chain-name rules that only differ by a null match_key falling back to proper_name', () => {
    const rules = [
      rule({ id: 'a', proper_name: 'Krispy Kreme', match_key: 'krispykreme', category_name: 'Leisure' }),
      rule({ id: 'b', proper_name: 'Krispy Kreme', match_key: undefined, category_name: 'Leisure' }),
    ];
    const groups = findChainMergeGroups(rules);
    expect(groups).toHaveLength(1);
    expect(groups[0].chainRoot).toBe('krispykreme');
    expect(groups[0].branches.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
});
