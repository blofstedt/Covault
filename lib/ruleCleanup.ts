// lib/ruleCleanup.ts
//
// Two narrow, safe things worth flagging in a household's own learned rules —
// deliberately not a general "find anything that looks duplicated" pass. Both
// mirror a rule the capture pipeline already applies elsewhere, so surfacing
// them changes nothing about what gets categorised; it only lets the user
// remove the leftover row rather than leave it sitting there unused forever.
//
//   1. A branch was once taught Other while every OTHER rule for the same
//      merchant agrees on one real category. `notificationProcessor.ts`
//      already ignores such a row (see `realCategories` there and
//      `otherRuleIsNotADecision.test.ts`) — it is not "wrong", it is inert.
//      Two or more real categories for one merchant (Costco: Groceries +
//      Transport) is a genuine, live disagreement and is never flagged.
//
//   2. Two or more of the user's own rules for the same known chain (see
//      chainVendorKeys.ts) already agree on one category. Combining them into
//      a single chain-wide rule is tidying, not a behaviour change — a
//      `prefix` rule already matches every branch a set of `exact` ones did.
//      A chain not on that safe list, or branches that disagree with each
//      other, are never flagged: the first because generalising them isn't
//      known to be safe, the second because that is a real conflict for the
//      review screen's "these rules disagree" flow, not this one.

import { chainAwareMatchKey, isKnownChainRoot } from './chainVendorKeys';
import { toVendorKey } from './deviceTransactionParser';

/** The fields either check needs. A `VendorOverride` satisfies this shape. */
export interface CleanupRule {
  id: string;
  proper_name: string;
  match_key?: string;
  match_type?: 'exact' | 'prefix' | 'contains';
  /** DB enum name, e.g. 'Groceries', 'Other' — not the app's 'budget:x' id. */
  category_name?: string;
}

function fold(value: string | undefined | null): string {
  return String(value || '').trim().toLowerCase();
}

/**
 * A row that only exists in local state so far.
 *
 * `handleSetVendorCategory` in useVendorOverrides.ts inserts optimistically
 * under a `temp-` id and swaps in the real one when the insert answers, so
 * such a row has no id anything here can act on. Worse, the delete path falls
 * back to deleting a temp row by (proper_name, category) — and every row in a
 * chain merge group shares BOTH, so offering one for cleanup would have let
 * "combine these" delete the rule it had just kept, taking the household's
 * real rule for that merchant with it. An unsaved row is simply not a
 * candidate for either pile; the next load lists it with a real id.
 */
function isUnsaved(rule: CleanupRule): boolean {
  return String(rule?.id || '').startsWith('temp-');
}

export interface StaleOtherGroup {
  properName: string;
  /** The DB enum name every other rule for this merchant agrees on. */
  realCategoryName: string;
  /** The Other row(s) for this merchant — safe to remove. */
  staleRules: CleanupRule[];
}

/**
 * Merchants with an inert Other rule sitting beside one agreed real category.
 *
 * Grouped by display name, the same way `LearnedRulesCard` already groups
 * rules for its own list — a chain's branches share one clean `proper_name`
 * even though their `match_key`s differ, so this needs no chain-specific
 * logic of its own.
 */
export function findStaleOtherRules(rules: readonly CleanupRule[]): StaleOtherGroup[] {
  const groups = new Map<string, CleanupRule[]>();
  for (const rule of rules) {
    if (isUnsaved(rule)) continue;
    const key = fold(rule.proper_name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(rule);
  }

  const out: StaleOtherGroup[] = [];
  for (const group of groups.values()) {
    const staleRules = group.filter((r) => fold(r.category_name) === 'other');
    if (staleRules.length === 0) continue;

    const realCategoryNames = new Set(
      group
        .filter((r) => fold(r.category_name) !== 'other' && r.category_name)
        .map((r) => r.category_name!),
    );
    if (realCategoryNames.size !== 1) continue;

    out.push({
      properName: group[0].proper_name,
      realCategoryName: [...realCategoryNames][0],
      staleRules,
    });
  }
  return out.sort((a, b) => a.properName.localeCompare(b.properName));
}

export interface ChainMergeGroup {
  properName: string;
  categoryName: string;
  chainRoot: string;
  /**
   * One of these already carries the chain-wide key, if a previous combine
   * (or a hand-written prefix rule) already created one. When set, combining
   * only ever removes `branches` — this row is left untouched.
   */
  canonical?: CleanupRule;
  /** Branch-specific rules to fold into `canonical`, or into one another. */
  branches: CleanupRule[];
}

/**
 * Two or more of the user's own rules for the same known chain, agreeing on
 * one category, that are not already combined into a single rule.
 */
export function findChainMergeGroups(rules: readonly CleanupRule[]): ChainMergeGroup[] {
  interface Bucket {
    chainRoot: string;
    categoryName: string;
    canonical?: CleanupRule;
    branches: CleanupRule[];
  }
  const buckets = new Map<string, Bucket>();

  for (const rule of rules) {
    if (isUnsaved(rule)) continue;
    if (!rule.category_name || fold(rule.category_name) === 'other') continue;

    const rawKey = toVendorKey(rule.match_key || rule.proper_name);
    let chainRoot: string | null = null;
    let isCanonical = false;

    if (rule.match_type === 'prefix' && isKnownChainRoot(rawKey)) {
      // Already a chain-wide rule — its own key already IS the root.
      chainRoot = rawKey;
      isCanonical = true;
    } else {
      const generalised = chainAwareMatchKey(rawKey);
      if (generalised.matchType === 'prefix') {
        chainRoot = generalised.matchKey;
      } else if (isKnownChainRoot(rawKey)) {
        // The bare chain name, with nothing appended — `chainAwareMatchKey`
        // correctly leaves this alone as `exact` (there's nothing to
        // generalise away), but it is still only an ordinary branch here: an
        // `exact` "mcdonalds" row matches nothing else the chain sends, the
        // same as an `exact` "mcdonaldsqo4" one. Folding it in as a branch
        // (rather than treating it as already canonical) means the merge
        // still upgrades its match_type to `prefix` — skipping that left a
        // real household's bare "mcdonalds" and branch-specific
        // "mcdonaldsqo4" rows in two separate, unmerged groups.
        chainRoot = rawKey;
      }
    }
    if (!chainRoot) continue;

    const bucketKey = `${chainRoot}::${fold(rule.category_name)}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { chainRoot, categoryName: rule.category_name, branches: [] });
    }
    const bucket = buckets.get(bucketKey)!;
    if (isCanonical) {
      bucket.canonical = rule;
    } else {
      bucket.branches.push(rule);
    }
  }

  const out: ChainMergeGroup[] = [];
  for (const bucket of buckets.values()) {
    const rowCount = bucket.branches.length + (bucket.canonical ? 1 : 0);
    if (rowCount < 2) continue;
    const properName = (bucket.canonical ?? bucket.branches[0]).proper_name;
    out.push({
      properName,
      categoryName: bucket.categoryName,
      chainRoot: bucket.chainRoot,
      canonical: bucket.canonical,
      branches: bucket.branches,
    });
  }
  return out.sort((a, b) => a.properName.localeCompare(b.properName));
}
