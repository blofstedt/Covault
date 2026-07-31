import { useMemo, useCallback } from 'react';
import { Transaction } from '../../types';
import type { VendorOverride } from '../../components/transaction_parsing/useVendorOverrides';

// Stable identity for the omitted-prop case. A fresh `[]` here would give
// classifyAll a new identity every render, so the useMemo below memoized
// nothing.
const EMPTY_OVERRIDES: VendorOverride[] = [];

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
 * The rows a bulk "Accept" is allowed to file: those where a deterministic
 * vendor rule matched AND the row already has a category.
 *
 * Deliberately `exact` only. An exact match means a rule the user wrote fired,
 * so accepting in bulk is them ratifying their own past decision. `ai` rows are
 * a model's guess — filing a screenful of those in one tap is how a month of
 * budget data quietly goes wrong, so they stay one-at-a-time.
 *
 * `hasBudget` is required as well because Accept is only offered on rows that
 * have somewhere to go; a rule matching with no resolved category is still a
 * manual decision.
 */
export function selectBulkAcceptable(
  transactions: Transaction[],
  matchMap: Map<string, VendorMatchResult>,
  hasBudget: (tx: Transaction) => boolean,
): Transaction[] {
  return transactions.filter((tx) => {
    const result = matchMap.get(tx.id);
    const hasOverrideMatch = !!(result?.match && result.state !== 'none');
    const budget = hasBudget(tx);
    return (
      classifyMatch({ hasOverrideMatch, confidence: tx.confidence, hasBudget: budget }) === 'exact'
      && budget
    );
  });
}

/**
 * Matches AI-extracted transactions against user-defined vendor overrides.
 * Returns a classifyAll function that produces a Map<tx.id, matchResult>
 * for efficient lookup when rendering the transaction list.
 */
export function useVendorMatcher(vendorOverrides: VendorOverride[] | undefined) {
  const overrides = vendorOverrides ?? EMPTY_OVERRIDES;

  // Normalize each override's keys once. Doing it inside the transaction loop
  // meant 2 x (transactions x overrides) toLowerCase+regex passes and just as
  // many throwaway strings, even though the keys don't depend on the
  // transaction at all.
  const normalizedOverrides = useMemo(
    () =>
      overrides.map((vo) => ({
        vo,
        matchKey: (vo.match_key ?? vo.proper_name).toLowerCase().replace(/\s+/g, ''),
        properKey: vo.proper_name.toLowerCase().replace(/\s+/g, ''),
      })),
    [overrides],
  );

  const classifyAll = useCallback(
    (transactions: Transaction[]): Map<string, VendorMatchResult> => {
      const map = new Map<string, VendorMatchResult>();
      if (normalizedOverrides.length === 0) {
        for (const tx of transactions) {
          map.set(tx.id, { match: null, state: 'none' });
        }
        return map;
      }

      for (const tx of transactions) {
        const vendorKey = tx.vendor.toLowerCase().replace(/\s+/g, '');
        let best: VendorMatchResult = { match: null, state: 'none' };

        for (const { vo, matchKey, properKey } of normalizedOverrides) {
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
          for (const { vo, properKey: properNorm } of normalizedOverrides) {
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
    [normalizedOverrides],
  );

  return useMemo(() => ({ classifyAll }), [classifyAll]);
}
