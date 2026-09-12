/**
 * "Other" is what the app writes when nobody has decided anything — never a
 * decision of its own. Three places had to agree on that for the fix to
 * actually hold:
 *
 *   1. Nothing ever WRITES an Other rule any more (persistVendorOverride,
 *      handleSetVendorCategory) — pinned in vendorOverrideWrite.test.ts and
 *      here, by source, for the hook.
 *   2. The capture pipeline's conflict check no longer counts an Other rule
 *      as a second opinion — a branch taught Other must not outvote, or
 *      "disagree with", a real answer taught elsewhere on the same merchant.
 *   3. When the narrow match for THIS capture is an Other rule but the rest
 *      of the merchant agrees on exactly one real category, that real
 *      category is used instead — at confidence 0, same treatment as a
 *      borrowed partner rule, since it did not come from a rule that matched
 *      this exact incoming slug.
 *
 * This is the fix for a real, verified household bug: a household's own
 * Costco/Walmart/Wendy's/Starbucks/Safeway/No Frills/Superstore rules were
 * each split between a real category and Other, purely because one branch or
 * one review-tap had landed on Other while every other branch agreed on
 * something real — and the stale Other rule went on filing that branch's
 * charges under Other indefinitely, with nothing on screen to say the rest of
 * the merchant disagreed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { distinctCategories, merchantRuleScope } from '../vendorRuleScope';

const WENDYS = [
  { proper_name: "Wendy's", match_key: 'wendysolympic', category_id: 'Leisure' },
  { proper_name: "Wendy's", match_key: 'wendyscrowfoot', category_id: 'Other' },
  { proper_name: "Wendy's", match_key: 'wendyscochrane', category_id: 'Leisure' },
];

describe('an Other rule is not a real opinion, for the merchant-level check', () => {
  it('does not count as a conflict against a single real category', () => {
    const merchant = merchantRuleScope([WENDYS[1]], WENDYS); // matched on the Other branch
    const allCategories = distinctCategories(merchant);
    const realCategories = allCategories.filter((c) => c !== 'other');
    expect(allCategories.sort()).toEqual(['leisure', 'other']);
    expect(realCategories).toEqual(['leisure']);
  });

  it('an all-Other merchant has no real category either', () => {
    const allOther = [
      { proper_name: 'Crown', match_key: 'crown1', category_id: 'Other' },
      { proper_name: 'Crown', match_key: 'crown2', category_id: 'Other' },
    ];
    const merchant = merchantRuleScope([allOther[0]], allOther);
    const realCategories = distinctCategories(merchant).filter((c) => c !== 'other');
    expect(realCategories).toEqual([]);
  });

  it('two REAL categories still count as a genuine conflict', () => {
    const costco = [
      { proper_name: 'Costco', match_key: 'costcowholesale', category_id: 'Groceries' },
      { proper_name: 'Costco', match_key: 'costcogas', category_id: 'Transport' },
    ];
    const merchant = merchantRuleScope([costco[0]], costco);
    const realCategories = distinctCategories(merchant).filter((c) => c !== 'other');
    expect(realCategories.sort()).toEqual(['groceries', 'transport']);
  });

  it('three-way — Other plus two real categories — is still a genuine conflict', () => {
    const mixed = [
      { proper_name: 'X', match_key: 'x1', category_id: 'Other' },
      { proper_name: 'X', match_key: 'x2', category_id: 'Groceries' },
      { proper_name: 'X', match_key: 'x3', category_id: 'Transport' },
    ];
    const merchant = merchantRuleScope([mixed[0]], mixed);
    const realCategories = distinctCategories(merchant).filter((c) => c !== 'other');
    expect(realCategories.length).toBe(2);
  });
});

describe('the capture pipeline: conflict decided on real categories only', () => {
  const source = readFileSync(resolve(__dirname, '../notificationProcessor.ts'), 'utf8');

  it('filters Other out before deciding whether there is a conflict', () => {
    expect(source).toContain(
      "realCategories = conflictingCategories.filter((c) => c !== 'other')",
    );
    expect(source).toContain('overrideRuleConflict = realCategories.length > 1');
  });

  it('never suggests Other back as the frequency-based candidate', () => {
    const block = source.slice(
      source.indexOf('const candidateNames = [...new Set('),
      source.indexOf('try {', source.indexOf('const candidateNames')),
    );
    expect(block).toContain("!== 'other'");
  });

  it('replaces a narrowly-matched Other rule with the merchant\'s one real category', () => {
    const block = source.slice(
      source.indexOf('5a-i-b: an Other answer is not a real answer'),
      source.indexOf('5a-ii: the borrowed layers'),
    );
    expect(block).toContain("(categoryName || '').toLowerCase() === 'other'");
    expect(block).toContain('realCategories.length === 1');
    expect(block).toContain('categoryId = realCat.id');
    expect(block).toContain('categoryName = realCat.name');
  });

  it('never lets the rescued category auto-file — confidence stays 0', () => {
    const block = source.slice(
      source.indexOf('5a-i-b: an Other answer is not a real answer'),
      source.indexOf('5a-ii: the borrowed layers'),
    );
    expect(block).toContain('overrideMatchConfidence = 0');
  });

  it('only fires when there is exactly one real answer, not when there is a genuine conflict', () => {
    const block = source.slice(
      source.indexOf('5a-i-b: an Other answer is not a real answer'),
      source.indexOf('5a-ii: the borrowed layers'),
    );
    expect(block).toContain('!overrideRuleConflict');
  });
});

describe('nothing writes a rule for Other', () => {
  it('the standalone write path refuses it', () => {
    const source = readFileSync(resolve(__dirname, '../vendorOverrideWrite.ts'), 'utf8');
    expect(source).toContain("categoryName.trim().toLowerCase() === 'other'");
  });

  it('the review-row categorisation path refuses it too', () => {
    const source = readFileSync(
      resolve(__dirname, '../../components/transaction_parsing/useVendorOverrides.ts'),
      'utf8',
    );
    expect(source).toContain("categoryName.trim().toLowerCase() === 'other'");
  });

  it('filing as Other still happens — only the rule is skipped', () => {
    // The guard in useVendorOverrides.ts must return before any network call,
    // never before the row itself gets filed. That filing happens in the
    // CALLER (TransactionParsing.tsx), which must not be short-circuited by
    // this guard at all — confirmed by the toast copy no longer claiming
    // anything was learned.
    const source = readFileSync(resolve(__dirname, '../../components/TransactionParsing.tsx'), 'utf8');
    expect(source).toContain("(name || '').toLowerCase() === 'other'");
    expect(source).toContain('Filed ${tx.vendor} as Other');
    expect(source).not.toContain('Learned ${tx.vendor} → Other');
  });
});
