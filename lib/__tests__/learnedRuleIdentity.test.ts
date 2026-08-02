import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { toVendorKey } from '../deviceTransactionParser';
import { fuzzyVendorMatch } from '../formatVendorName';

/**
 * A learned rule is identified by vendor AND category, not vendor alone.
 *
 * Walmart→Groceries and Walmart→Other are both real: the same shop sells food
 * and clothing, and there is no Clothing category. The rules list has always
 * keyed its rows `properName::categoryId`; the data layer was the only place
 * that insisted a vendor had exactly one category, and it enforced that by
 * PATCHing the existing row — so teaching the second pairing silently destroyed
 * the first.
 *
 * These tests pin the three consequences that are easy to regress:
 *   1. the identity key includes the category,
 *   2. vendor matching ignores case, so "walmart" never forks a second row,
 *   3. a vendor with conflicting rules is never auto-filed.
 */

const ROOT = resolve(__dirname, '../..');

/** The uniqueness key, mirroring useVendorOverrides.handleSetVendorCategory. */
function ruleKey(vendor: string, categoryId: string): string {
  return `${toVendorKey(vendor)}::${categoryId}`;
}

describe('learned rule identity', () => {
  it('separates the same vendor in different categories', () => {
    expect(ruleKey('Walmart', 'budget:groceries')).not.toBe(
      ruleKey('Walmart', 'budget:other'),
    );
  });

  it('collapses the same pairing regardless of case or spacing', () => {
    const canonical = ruleKey('Walmart', 'budget:groceries');
    expect(ruleKey('walmart', 'budget:groceries')).toBe(canonical);
    expect(ruleKey('WALMART', 'budget:groceries')).toBe(canonical);
    expect(ruleKey('  Walmart  ', 'budget:groceries')).toBe(canonical);
  });

  it('treats distinct vendors as distinct rules', () => {
    expect(ruleKey('Walmart', 'budget:groceries')).not.toBe(
      ruleKey('Costco', 'budget:groceries'),
    );
  });
});

describe('near-match consolidation', () => {
  it('recognises a store-numbered variant as the same merchant', () => {
    // The case the inline rename confirm exists for: without it the user ends
    // up with "Walmart" and "WAL-MART #3106" as two separate merchants.
    expect(fuzzyVendorMatch('Walmart', 'WALMART #3106')).toBe(true);
  });

  it('does not conflate genuinely different merchants', () => {
    expect(fuzzyVendorMatch('Walmart', 'Costco')).toBe(false);
    expect(fuzzyVendorMatch('Tim Hortons', 'Starbucks')).toBe(false);
  });
});

/**
 * Source-level guards. The behaviours below live in async UI/pipeline code that
 * these unit tests cannot drive end to end, but each one has already been a
 * silent failure, so a regression should break the build rather than wait to be
 * noticed on a phone.
 */
describe('rule-system guards', () => {
  it('the capture pipeline refuses to guess between conflicting rules', () => {
    const source = readFileSync(join(ROOT, 'lib/notificationProcessor.ts'), 'utf8');

    expect(
      /overrideRuleConflict/.test(source),
      'notificationProcessor must detect vendors matching rules in different ' +
      'categories and route them to review.',
    ).toBe(true);

    // The old code took the most recently updated rule AND scored it as a
    // full-confidence match, so auto-accept filed it without the user ever
    // seeing the transaction. Detection has to look at every matching rule's
    // category, and the conflict has to gate which rows are used.
    expect(
      /distinctCategories/.test(source),
      'Conflict detection must compare the categories of ALL matching rules.',
    ).toBe(true);

    expect(
      /overrideRuleConflict \? \[\] : matching\.slice\(0, 1\)/.test(source),
      'A conflict must yield NO override rows, so no category is applied and ' +
      'overrideMatchConfidence stays 0 (which is what suppresses auto-accept).',
    ).toBe(true);

    // The proper_name fallback would otherwise re-apply one of the very rules
    // just judged ambiguous, at confidence 1.
    expect(
      /!overrideRuleConflict && \(!overrideRows/.test(source),
      'The proper_name fallback must be skipped on a conflict.',
    ).toBe(true);
  });

  it('teaching is not an opt-in second button any more', () => {
    const row = readFileSync(
      join(ROOT, 'components/transaction_parsing/AIEnteredRow.tsx'),
      'utf8',
    );

    expect(
      /Always use this category/.test(row),
      'The separate "Always use this category" action must be gone — every ' +
      'category choice teaches now.',
    ).toBe(false);

    expect(
      /onCreateRule/.test(row.replace(/^\s*\*.*$/gm, '')),
      'onCreateRule should no longer be wired into the row.',
    ).toBe(false);
  });

  it('deleting one rule cannot take out the vendor’s other rules', () => {
    const source = readFileSync(
      join(ROOT, 'components/transaction_parsing/useVendorOverrides.ts'),
      'utf8',
    );

    // The temp-id delete path used to filter on proper_name alone, which with
    // two Walmart rules would have deleted both.
    const deleteByName = source.includes('proper_name=eq.${encodeURIComponent(properName)}');
    const scopedByCategory = source.includes(
      'category_id=eq.${encodeURIComponent(dbCategory)}',
    );
    expect(
      !deleteByName || scopedByCategory,
      'Deleting by proper_name must also be scoped by category_id.',
    ).toBe(true);
  });
});
