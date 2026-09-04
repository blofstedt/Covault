import { useMemo, useCallback } from 'react';
import { Transaction } from '../../types';
import type { VendorOverride } from '../../components/transaction_parsing/useVendorOverrides';
import { lookupCommunityRule } from '../communityRules';

// Stable identity for the omitted-prop case. A fresh `[]` here would give
// classifyAll a new identity every render, so the useMemo below memoized
// nothing.
const EMPTY_OVERRIDES: VendorOverride[] = [];

export interface VendorMatchResult {
  match: VendorOverride | null;
  state: 'exact' | 'prefix' | 'contains' | 'none';
  /**
   * WHOSE rule matched. 'own' is the only one that means "you taught this" —
   * the others are borrowed, and a borrowed rule may suggest a category but is
   * never treated as the user's own decision.
   */
  source?: 'own' | 'partner' | 'community';
}

/** How a caught transaction was categorized, for the triage UI. */
export type MatchKind = 'exact' | 'borrowed' | 'ai' | 'unmatched';

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
  /** Whose rule matched, when one did. Anything but 'own' is borrowed. */
  matchSource?: 'own' | 'partner' | 'community';
}): MatchKind {
  if (opts.hasOverrideMatch && opts.matchSource && opts.matchSource !== 'own') return 'borrowed';
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
      classifyMatch({
        hasOverrideMatch,
        confidence: tx.confidence,
        hasBudget: budget,
        // Passing the source is what keeps a BORROWED match out of the bulk
        // action. Without it a partner's or the pool's suggestion classifies as
        // 'exact' and a screenful of them could be filed in one tap — with
        // nobody having agreed to a single one, and none of them adopted as the
        // user's own. Borrowed rules are accepted one at a time, deliberately.
        matchSource: result?.source,
      }) === 'exact'
      && budget
    );
  });
}

type NormalizedOverride = { vo: VendorOverride; matchKey: string; properKey: string };

/**
 * The best rule for a vendor within ONE layer.
 *
 * Exact beats prefix beats contains, and the loop keeps going after a
 * non-exact hit in case an exact one is further down the list. Extracted so
 * the user's own rules and their partner's are matched by identical code —
 * two copies of this drifting apart would mean a badge that disagreed with
 * the category the pipeline chose.
 */
function bestMatchIn(normalized: NormalizedOverride[], vendorKey: string): VendorMatchResult {
  let best: VendorMatchResult = { match: null, state: 'none' };
  if (normalized.length === 0) return best;

  for (const { vo, matchKey, properKey } of normalized) {
    // Exact match on vendor name or match_key
    if (vendorKey === matchKey || vendorKey === properKey) {
      return { match: vo, state: 'exact' };
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
    for (const { vo, properKey: properNorm } of normalized) {
      if (properNorm.length >= 4 && vendorKey.includes(properNorm)) {
        best = { match: vo, state: 'contains' };
        break;
      }
    }
  }

  return best;
}

/**
 * Matches AI-extracted transactions against the rules available to this user.
 *
 * Three layers, asked in order and stopping at the first that answers: the
 * user's own rules, then their partner's, then the community pool. The order
 * mirrors the capture pipeline's exactly (step 5a of notificationProcessor), so
 * the badge on a review row and the category the pipeline chose can never
 * disagree about which rule was responsible.
 *
 * The pool is asked last and matches on the whole normalised key only — never
 * by prefix or "contains", which is the one shape of match that is risky when
 * the person who wrote the rule is a stranger.
 */
export function useVendorMatcher(
  vendorOverrides: VendorOverride[] | undefined,
  partnerOverrides?: VendorOverride[] | undefined,
) {
  const overrides = vendorOverrides ?? EMPTY_OVERRIDES;
  const partner = partnerOverrides ?? EMPTY_OVERRIDES;

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

  const normalizedPartner = useMemo(
    () =>
      partner.map((vo) => ({
        vo,
        matchKey: (vo.match_key ?? vo.proper_name).toLowerCase().replace(/\s+/g, ''),
        properKey: vo.proper_name.toLowerCase().replace(/\s+/g, ''),
      })),
    [partner],
  );

  const classifyAll = useCallback(
    (transactions: Transaction[]): Map<string, VendorMatchResult> => {
      const map = new Map<string, VendorMatchResult>();

      for (const tx of transactions) {
        const vendorKey = tx.vendor.toLowerCase().replace(/\s+/g, '');

        // The user's own rules first: the only layer whose match means "you
        // decided this".
        let best = bestMatchIn(normalizedOverrides, vendorKey);
        if (best.state !== 'none') {
          map.set(tx.id, { ...best, source: 'own' });
          continue;
        }

        // Then the household. Suggests only — the badge says whose rule it is,
        // and accepting the row is what turns it into one of the user's own.
        best = bestMatchIn(normalizedPartner, vendorKey);
        if (best.state !== 'none') {
          map.set(tx.id, { ...best, source: 'partner' });
          continue;
        }

        // Then the pool, on the whole key or not at all.
        const community = lookupCommunityRule(vendorKey);
        if (community) {
          map.set(tx.id, {
            match: {
              id: `community:${community.matchKey}`,
              proper_name: tx.vendor,
              match_key: community.matchKey,
              match_type: 'exact',
              category_id: `budget:${community.category.toLowerCase()}`,
              category_name: community.category,
            },
            state: 'exact',
            source: 'community',
          });
          continue;
        }

        map.set(tx.id, { match: null, state: 'none' });
      }
      return map;
    },
    [normalizedOverrides, normalizedPartner],
  );

  return useMemo(() => ({ classifyAll }), [classifyAll]);
}
