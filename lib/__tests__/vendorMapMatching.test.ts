import { describe, expect, it } from 'vitest';
import { findVendorMapMatch } from '../vendorMapMatching';
import type { VendorMapEntry } from '../localNotificationMemory';

function entry(vendorKey: string, vendorDisplay: string): VendorMapEntry {
  return {
    vendor_key: vendorKey,
    vendor_display: vendorDisplay,
    budget: 'Leisure',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('findVendorMapMatch', () => {
  it('prefers the primary vendor key over aliases and fuzzy candidates', () => {
    const primary = entry('google', 'Google');
    const alias = entry('googleservices', 'Google Services');

    expect(findVendorMapMatch({
      entries: { googleservices: alias, google: primary },
      vendorKey: 'google',
      aliasKeys: ['googleservices'],
      incomingName: 'Google',
    })).toEqual({ kind: 'primary', key: 'google', entry: primary });
  });

  it('tries aliases in the supplied order before using fuzzy matching', () => {
    const firstAlias = entry('googleplay', 'Google Play');
    const secondAlias = entry('googleone', 'Google One');

    expect(findVendorMapMatch({
      entries: { googleone: secondAlias, googleplay: firstAlias },
      vendorKey: 'unmatched',
      aliasKeys: ['googleplay', 'googleone'],
      incomingName: 'Google',
    })).toEqual({ kind: 'alias', key: 'googleplay', entry: firstAlias });
  });

  it('prefers an identical first word over an abbreviation-based fuzzy match', () => {
    const abbreviated = entry('amzn', 'AMZN Prime');
    const exactWord = entry('amazon', 'Amazon Prime');

    expect(findVendorMapMatch({
      entries: { amzn: abbreviated, amazon: exactWord },
      vendorKey: 'amazonprimecapture',
      aliasKeys: [],
      incomingName: 'Amazon Prime',
    })).toEqual({ kind: 'fuzzy', key: 'amazon', entry: exactWord });
  });

  it('keeps the first entry when fuzzy candidates have equal scores', () => {
    const first = entry('staples-a', 'Staples Crowfoot');
    const second = entry('staples-b', 'Staples Olympic');

    expect(findVendorMapMatch({
      entries: { 'staples-a': first, 'staples-b': second },
      vendorKey: 'staples',
      aliasKeys: [],
      incomingName: 'Staples',
    })).toEqual({ kind: 'fuzzy', key: 'staples-a', entry: first });
  });

  it('rejects a resemblance whose first words identify different merchants', () => {
    const unrelated = entry('eservices', 'Eservices Kb Civil Marriage');

    expect(findVendorMapMatch({
      entries: { eservices: unrelated },
      vendorKey: 'services',
      aliasKeys: [],
      incomingName: 'Services',
    })).toBeNull();
  });
});
