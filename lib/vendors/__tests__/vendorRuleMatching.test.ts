import { describe, expect, it } from 'vitest';
import { findFirstMatchingVendorRules } from '../vendorRuleMatching';

describe('saved vendor rule matching', () => {
  it('matches keys case-insensitively and treats a missing type as exact', () => {
    const rule = { category_id: 'Groceries', match_key: 'COSTCO', match_type: null };

    expect(findFirstMatchingVendorRules({ rows: [rule], keys: ['costco'] })).toEqual({
      key: 'costco',
      rows: [rule],
    });
  });

  it('supports prefix and contains rules without changing row order', () => {
    const prefixRules = [
      { id: 'newest', match_key: 'costco', match_type: 'prefix' },
      { id: 'older', match_key: 'costco', match_type: 'prefix' },
    ];
    const containsRule = { id: 'coffee', match_key: 'roasters', match_type: 'contains' };

    expect(findFirstMatchingVendorRules({
      rows: prefixRules,
      keys: ['costcowholesale'],
    })?.rows.map((rule) => rule.id)).toEqual(['newest', 'older']);
    expect(findFirstMatchingVendorRules({
      rows: [containsRule],
      keys: ['localcoffeeroasters'],
    })).toEqual({ key: 'localcoffeeroasters', rows: [containsRule] });
  });

  it('tries the displayed vendor key before aliases, then keeps the first matching alias', () => {
    const rules = [
      { category_id: 'Leisure', match_key: 'googleyoutubepremium', match_type: 'exact' },
      { category_id: 'Subscriptions', match_key: 'youtubepremium', match_type: 'exact' },
    ];

    expect(findFirstMatchingVendorRules({
      rows: rules,
      keys: ['youtubepremium', 'googleyoutubepremium'],
    })).toEqual({ key: 'youtubepremium', rows: [rules[1]] });
    expect(findFirstMatchingVendorRules({
      rows: [rules[0]],
      keys: ['youtubepremium', 'googleyoutubepremium'],
    })).toEqual({ key: 'googleyoutubepremium', rows: [rules[0]] });

    const competingAliases = [
      { category_id: 'Subscriptions', match_key: 'youtubepremium', match_type: 'exact' },
      { category_id: 'Leisure', match_key: 'googleyoutubepremium', match_type: 'exact' },
    ];
    expect(findFirstMatchingVendorRules({
      rows: competingAliases,
      keys: ['unmatchedpreferredkey', 'youtubepremium', 'googleyoutubepremium'],
    })).toEqual({ key: 'youtubepremium', rows: [competingAliases[0]] });
  });

  it('does not match empty keys or unsupported match types', () => {
    const rules = [
      { id: 'empty-exact', match_key: '', match_type: 'exact' },
      { id: 'empty-prefix', match_key: '', match_type: 'prefix' },
      { id: 'empty-contains', match_key: '', match_type: 'contains' },
      { id: 'unsupported', match_key: 'coffee', match_type: 'suffix' },
    ];

    expect(findFirstMatchingVendorRules({ rows: rules, keys: ['', 'coffeeroasters'] })).toBeNull();
  });
});
