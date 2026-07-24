import { useMemo, useCallback } from 'react';
import { Transaction } from '../../types';
import type { VendorOverride } from '../../components/transaction_parsing/useVendorOverrides';

export interface VendorMatchResult {
  match: VendorOverride | null;
  state: 'exact' | 'prefix' | 'contains' | 'none';
}

/** How a caught transaction was categorized, for the triage UI. */
export type MatchKind = 'exact' | 'ai' | 'unmatched';

/**
 * Classify a caught transaction:
 *   - `exact`  — a deterministic vendor-override rule matches now.
 *   - `ai`     — no rule, but the pipeline assigned a category (with or
 *                without a confidence score, i.e. it has a budget).
 *   - `unmatched` — no rule, no confidence, and no budget → needs a category.
 */
export function classifyMatch(opts: {
  hasOverrideMatch: boolean;
  confidence: number | null | undefined;
  hasBudget: boolean;
}): MatchKind {
  if (opts.hasOverrideMatch) return 'exact';
  if (opts.confidence != null) return 'ai';
  return opts.hasBudget ? 'ai' : 'unmatched';
}

/**
 * UI categorization state for an AI-entered row. Superset of the values
 * currently produced by the matcher (`VendorMatchResult['state']`) and the
 * legacy labels still referenced by `AIEnteredRow` — typed as a union so the
 * component compiles without changing its runtime branching.
 */
export type AICategorizationState =
  | VendorMatchResult['state']
  | 'auto'
  | 'suggested'
  | 'other';

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

        // Extra fallback: if the transaction vendor contains the proper_name as a substring
        if (best.state === 'none') {
          for (const vo of overrides) {
            const properNorm = vo.proper_name.toLowerCase().replace(/\s+/g, '');
            if (properNorm.length >= 4 && vendorKey.includes(properNorm)) {
              best = { match: vo, state: 'contains' };
              break;
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
