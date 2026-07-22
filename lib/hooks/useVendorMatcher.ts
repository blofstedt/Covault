import { useMemo, useCallback } from 'react';
import { Transaction } from '../../types';
import type { VendorOverride } from '../../components/transaction_parsing/useVendorOverrides';

export interface VendorMatchResult {
  match: VendorOverride | null;
  state: 'exact' | 'prefix' | 'contains' | 'none';
}

/**
 * Matches AI-extracted transactions against user-defined vendor overrides.
 * Returns a classifyAll function that produces a Map<tx.id, matchResult>
 * for efficient lookup when rendering the transaction list.
 */
export function useVendorMatcher(vendorOverrides: VendorOverride[] | undefined) {
  const overrides = vendorOverrides ?? [];

  const classifyAll = useCallback(
    (transactions: Transaction[]): Map<string, VendorMatchResult> => {
      const map = new Map<string, VendorMatchResult>();
      if (overrides.length === 0) {
        for (const tx of transactions) {
          map.set(tx.id, { match: null, state: 'none' });
        }
        return map;
      }

      for (const tx of transactions) {
        const vendorKey = tx.vendor.toLowerCase().replace(/\s+/g, '');
        let best: VendorMatchResult = { match: null, state: 'none' };

        for (const vo of overrides) {
          const matchKey = (vo.match_key ?? vo.proper_name).toLowerCase().replace(/\s+/g, '');
          const properKey = vo.proper_name.toLowerCase().replace(/\s+/g, '');

          // Exact match on vendor name or match_key
          if (vendorKey === matchKey || vendorKey === properKey) {
            best = { match: vo, state: 'exact' };
            break;
          }

          // Prefix match
          if (vo.match_type === 'prefix' && vendorKey.startsWith(matchKey)) {
            best = { match: vo, state: 'prefix' };
            // keep looking for exact
            continue;
          }

          // Contains match
          if (vo.match_type === 'contains' && vendorKey.includes(matchKey)) {
            best = { match: vo, state: 'contains' };
            continue;
          }

          // Fallback: contains without explicit type
          if (vendorKey.includes(matchKey) || vendorKey.includes(properKey)) {
            if (best.state === 'none') {
              best = { match: vo, state: 'contains' };
            }
          }
        }

        map.set(tx.id, best);
      }
      return map;
    },
    [overrides],
  );

  return useMemo(() => ({ classifyAll }), [classifyAll]);
}
