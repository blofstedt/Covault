import { log } from '../observability/log';
import type { ParsedNotification } from './deviceTransactionParser';
import { chooseNotificationFallbackCategory } from './notificationCategory';
import type { CommunityRule } from '../vendors/communityRules';
import type { VendorMapEntry } from './localNotificationMemory';
import { mostFrequentCategoryForVendor, type MerchantFrequencyRow } from '../budgets/categoryFrequency';
import { decideMerchantRuleChoice, distinctCategories, merchantRuleScope } from '../vendors/vendorRuleScope';
import { findFirstMatchingVendorRules } from '../vendors/vendorRuleMatching';
import { findVendorMapMatch } from '../vendors/vendorMapMatching';
import { scoreVendorMatch, toMatchKey } from '../vendors/vendorMatchConfidence';

export interface VendorRuleRow {
  category_id: string;
  proper_name: string | null;
  match_key: string | null;
  match_type?: string | null;
  updated_at?: string | null;
}

type ProperNameRuleRow = Pick<VendorRuleRow, 'category_id' | 'proper_name' | 'match_key'>;
type Category = { id: string; name: string };

export interface NotificationCategoryAssignmentInput {
  userId: string;
  vendor: string;
  vendorAliases: readonly string[];
  parsed: Pick<ParsedNotification, 'vendorKey' | 'vendorDisplay'>;
  availableCategories: readonly Category[];
  aiSuggestedCategory?: string | null;
  rawNotification?: string | null;
  hiddenCategoryIds?: readonly string[];
}

export interface NotificationCategoryAssignmentDependencies {
  /** This read is started earlier in the pipeline and awaited here. */
  vendorRules: PromiseLike<{ data: VendorRuleRow[] | null }>;
  readTransactionFrequencies: (
    userId: string,
    candidateNames: string[],
  ) => PromiseLike<{ data: MerchantFrequencyRow[] | null }>;
  readProperNameRule: (
    userId: string,
    name: string,
  ) => PromiseLike<{ data: ProperNameRuleRow[] | null }>;
  fetchPartnerRules: (userId: string) => Promise<VendorRuleRow[]>;
  lookupCommunityRule: (vendorKey: string) => CommunityRule | null;
  getVendorMap: () => Readonly<Record<string, VendorMapEntry>>;
}

export interface NotificationCategoryAssignmentResult {
  categoryId: string | null;
  categoryName: string | null;
  displayVendor: string;
  overrideMatchConfidence: number;
  overrideRuleConflict: boolean;
  realCategories: string[];
}

/**
 * How far back the category-frequency lookup looks when a vendor matches more
 * than one learned rule.
 *
 * Only ever queried on that rare path — most vendors match zero or one rule —
 * so this can afford to be generous. Not filtered by vendor server-side (the
 * matching is fuzzy, see `matchesCapturedVendor`), so this is the user's most
 * recent transactions in the CONFLICTING CATEGORIES ONLY, which keeps the
 * fetch small while still being enough rows to find this vendor's history in.
 */
export const MAX_FREQUENCY_ROWS = 300;

/**
 * Assign a capture's category from the household's saved rules, local vendor
 * map, and existing fallback choices.
 */
export async function assignCaptureCategory(
  input: NotificationCategoryAssignmentInput,
  dependencies: NotificationCategoryAssignmentDependencies,
): Promise<NotificationCategoryAssignmentResult> {
  const {
    userId,
    vendor,
    vendorAliases,
    parsed,
    availableCategories,
  } = input;
  // Priority: server vendor_overrides → localStorage vendorMap → "Other" → first available
  let categoryId: string | null = null;
  let categoryName: string | null = null;
  let displayVendor: string = vendor;
  // How completely the matched rule explains the incoming vendor name, 0..1.
  // Only set by Step 5a — a localStorage or heuristic match (5b/5c) is not
  // evidence the user ever taught us this vendor, so it stays 0 and can never
  // reach the auto-accept threshold.
  let overrideMatchConfidence = 0;
  // True when the incoming vendor matches learned rules pointing at DIFFERENT
  // categories. The capture must then go to review for the user to pick, and
  // must never be auto-accepted. See the note in step 5a.
  let overrideRuleConflict = false;
  // The merchant's real (non-Other) categories, widened across every branch —
  // set inside the match_key lookup below, read afterward to decide whether a
  // narrow match that happened to be an Other rule should be overridden by the
  // one real answer the rest of the merchant agrees on. See the note beside
  // `realCategories` in step 5a: an Other rule is not a second opinion, it is
  // the absence of one.
  let realCategories: string[] = [];

  // 5a: Check server-side overrides table.
  // Schema: overrides(id, user_id, proper_name, match_key, match_type, category_id, updated_at).
  // Lookup priority:
  //   1. match_key (normalized vendor slug) with respect to match_type:
  //        - 'exact'    : incoming vendorKey === override.match_key
  //        - 'prefix'   : incoming vendorKey starts with override.match_key
  //        - 'contains' : incoming vendorKey contains override.match_key
  //      The most recently updated row wins (ORDER BY updated_at DESC).
  //   2. proper_name ilike — fallback for legacy rows that pre-date match_key.
  if (vendor) {
    const vendorKey = toMatchKey(vendor);
    // The keys the alias names reduce to, e.g. "googleyoutubepremium" for a
    // charge whose polished name is only "Youtubepremium". Tried in order,
    // and only after the polished name has found nothing — a rule written
    // against the name the app shows must always win over one written against
    // a name it merely recognises.
    const aliasKeys = vendorAliases
      .map(toMatchKey)
      .filter((key) => key && key !== vendorKey);
    // Which key actually found the rule, so the confidence score below is
    // computed against the string the match was really made on.
    let matchedKey = vendorKey;

    // 1) match_key lookup (match_type aware)
    let overrideRows: VendorRuleRow[] | null = null;
    if (vendorKey) {
      // ALL of the user's rules, not a recent slice of them.
      //
      // This asked for the 20 most recently updated and matched among those.
      // The matching happens here rather than in the query — the stored keys
      // are not reliably lowercase, so the comparison has to be
      // case-insensitive, which a server-side filter on this column is not.
      // Twenty was fine when a household had a handful of rules. At a hundred
      // and fourteen it meant a rule taught months ago was simply not in the
      // room: Costco → Groceries had matched every Costco run for a year and
      // then quietly stopped, and the charge landed in Other with no sign that
      // a rule existed. The list is small data — a few hundred short rows —
      // and this runs a few times a day, so fetching all of it costs nothing
      // that matters.
      // Issued alongside the other two reads above; this is just collecting it.
      const { data } = await dependencies.vendorRules;
      const allRows = data || [];
      // The shared matcher preserves match_type semantics and tries the
      // polished name before any parser-recognized aliases.
      const ruleMatch = findFirstMatchingVendorRules({
        rows: allRows,
        keys: [vendorKey, ...aliasKeys],
      });
      const matching = ruleMatch?.rows ?? [];
      if (ruleMatch && ruleMatch.key !== vendorKey) {
        matchedKey = ruleMatch.key;
        log.debug(`[AI pipeline] No rule for "${vendor}"; matched on alias key "${matchedKey}"`);
      }

      // A vendor may legitimately have more than one rule: Walmart→Groceries
      // and Walmart→Other are both real purchases at the same merchant. When
      // that happens the app CANNOT know which one this purchase was, so it
      // must ask rather than guess.
      //
      // This used to be `.slice(0, 1)` — most-recently-updated wins — which
      // silently picked one and, worse, handed it a full confidence score, so
      // auto-accept filed it without the user ever seeing it. Whichever rule
      // they happened to teach last would quietly swallow every purchase at
      // that merchant.
      //
      // Leaving `categoryId` unset routes the capture to review. The review UI
      // recomputes the candidate categories from the overrides it has already
      // loaded, so nothing extra needs persisting.
      //
      // The disagreement is looked for across the whole MERCHANT, not just the
      // rules whose slug fired — see lib/vendors/vendorRuleScope.ts. A chain announces
      // each branch under its own slug ("wendyscrowfoot", "wendysolympic"), so
      // comparing only the slug that matched meant a merchant could never be
      // in conflict with itself: one branch's stale rule filed silently while
      // every other branch of the same restaurant said something else.
      const ruleChoice = decideMerchantRuleChoice(matching, allRows);
      const merchantRules = ruleChoice.merchantRules;
      realCategories = ruleChoice.realCategories;
      overrideRuleConflict = ruleChoice.kind === 'conflict';
      overrideRows = ruleChoice.kind === 'matched' ? [ruleChoice.rule] : [];

      if (overrideRuleConflict) {
        log.debug(
          `[AI pipeline] ${vendor} matches ${realCategories.length} real rules ` +
          `(${realCategories.join(', ')}) — routing to review instead of auto-filing`,
        );

        // Still going to review either way — this only decides what the
        // reviewer sees when they open it. `categoryId` is set to whichever
        // of the conflicting categories this same vendor has actually been
        // filed under most often, so the row reads as a real suggestion
        // instead of defaulting to "Other". `overrideMatchConfidence` is
        // deliberately left at 0: shouldAutoAccept requires both a category
        // AND a confidence over the threshold, so setting a category here
        // can never, by itself, let this row skip review — the one property
        // the conflict check exists to guarantee.
        //
        // Other is excluded from the candidates here too — it is never one of
        // the "conflicting" answers any more (see realCategories above), and
        // suggesting it back as the frequency winner would undo the point of
        // this whole change.
        const candidateNames = [...new Set(
          merchantRules
            .map((row) => String(row.category_id || ''))
            .filter((name) => name && name.toLowerCase() !== 'other'),
        )];
        try {
          const { data: frequencyRows } = await dependencies.readTransactionFrequencies(
            userId,
            candidateNames,
          );
          const suggested = mostFrequentCategoryForVendor(
            frequencyRows || [],
            candidateNames,
            vendor,
            vendorAliases,
          );
          if (suggested) {
            const suggestedCat = availableCategories.find(
              (c) => c.name.toLowerCase() === suggested.toLowerCase(),
            );
            if (suggestedCat) {
              categoryId = suggestedCat.id;
              categoryName = suggestedCat.name;
              log.debug(
                `[AI pipeline] Suggesting ${categoryName} for ${vendor} — the more common of the ` +
                `${realCategories.length} rules in this household's own history, still routed to review`,
              );
            }
          }
        } catch (e) {
          // A suggestion is a nicety on top of a decision (routing to
          // review) that has already been made and does not depend on it —
          // failing here must never fail the capture itself.
          log.warn('[AI pipeline] Could not compute a category suggestion for the conflict:', e);
        }
      }
    }

    // 2) proper_name ilike fallback
    //
    // Skipped entirely on a conflict. Otherwise the fallback would find one of
    // the very rules we just decided were ambiguous and re-apply it with
    // confidence 1 (`matchedByProperName` scores as exact by construction),
    // reinstating the silent auto-file this change exists to prevent.
    let matchedByProperName = false;
    if (!overrideRuleConflict && (!overrideRows || overrideRows.length === 0)) {
      // Same order as the match_key lookup: the polished name first, the
      // merchant's other names only if it finds nothing.
      for (const name of [vendor, ...vendorAliases]) {
        const { data } = await dependencies.readProperNameRule(userId, name);
        if (data && data.length > 0) {
          overrideRows = data;
          matchedByProperName = true;
          break;
        }
      }
    }

    if (overrideRows && overrideRows.length > 0) {
      const row = overrideRows[0];
      const overrideBudgetName = row.category_id; // e.g. 'Groceries'
      const overrideCat = availableCategories.find(
        (c) => c.name.toLowerCase() === (overrideBudgetName || '').toLowerCase(),
      );
      if (overrideCat) {
        categoryId = overrideCat.id;
        categoryName = overrideCat.name;
        // Use the stored proper_name as the display vendor if available
        if (row.proper_name) {
          displayVendor = row.proper_name;
        }
        // Score the match for auto-accept. `ilike proper_name` is a whole-name
        // comparison, so it is exact by construction; the match_key path is
        // scored by how much of the incoming name the rule accounts for.
        overrideMatchConfidence = matchedByProperName
          ? 1
          : scoreVendorMatch(matchedKey, (row.match_key || '').toLowerCase(), row.match_type || 'exact');
        log.debug(`[AI pipeline] overrides match: ${vendor} → ${categoryName} (match_type=${row.match_type || 'exact'}, confidence=${overrideMatchConfidence.toFixed(2)})`);
      }
    }

    // ── 5a-i-b: an Other answer is not a real answer ──
    //
    // The row just resolved above matched on THIS capture's own slug — which,
    // for a chain, can be the one branch that was taught Other while every
    // other branch of the same merchant was taught something real. That
    // branch's rule is not wrong to have matched; it is just not worth
    // trusting, for the same reason `realCategories` excludes Other from the
    // conflict count above: Other is what the app writes when nobody has
    // decided anything, not a decision of its own.
    //
    // So when the narrow match came back Other and the rest of the merchant
    // agrees on exactly one real category, that real category wins instead —
    // at confidence 0, same treatment as a borrowed partner or pool rule,
    // because this answer did not come from a rule that matched the incoming
    // slug and must still earn a human's glance before it can auto-file.
    // Two or more real categories elsewhere already routed this to review
    // above (`overrideRuleConflict`), so this only ever fires on the case
    // that truly has one honest answer.
    if (
      !overrideRuleConflict &&
      (categoryName || '').toLowerCase() === 'other' &&
      realCategories.length === 1
    ) {
      const realCat = availableCategories.find(
        (c) => c.name.toLowerCase() === realCategories[0],
      );
      if (realCat) {
        // displayVendor is untouched: the row already matched shares the same
        // proper_name as every other branch, by construction of
        // merchantRuleScope, so whatever it set stays correct.
        categoryId = realCat.id;
        categoryName = realCat.name;
        overrideMatchConfidence = 0;
        log.debug(
          `[AI pipeline] ${vendor} matched an Other rule for this branch, but the rest of the ` +
          `chain agrees on ${categoryName} — using that instead, still routed to review`,
        );
      }
    }

    // ── 5a-ii: the borrowed layers — the partner's rules, then the pool ──
    //
    // Reached only when the user's own rules said nothing. A conflict in their
    // own rules deliberately does NOT fall through: the app has established
    // that this household has not settled the merchant, and answering with
    // somebody else's opinion would be worse than asking.
    //
    // Everything found here SUGGESTS and never files. `overrideMatchConfidence`
    // stays 0 — the same treatment the model's guess and the offline descriptor
    // hint already get — so nothing borrowed can clear the auto-accept
    // threshold. The row goes to Review wearing a badge saying whose rule it
    // was, and accepting it once makes it the user's own.
    if (!categoryId && !overrideRuleConflict) {
      const partnerRows = await dependencies.fetchPartnerRules(userId);
      let borrowed: { row: VendorRuleRow; from: 'partner' } | null = null;

      if (partnerRows.length > 0) {
        const ruleMatch = findFirstMatchingVendorRules({
          rows: partnerRows,
          keys: [vendorKey, ...aliasKeys],
        });
        const matching = ruleMatch?.rows ?? [];

        // The same refusal to guess, one layer down: two people in a household
        // can legitimately disagree about a merchant, and the app must ask
        // rather than pick whichever of them edited a rule most recently.
        // Scoped to the merchant for the same reason as the user's own rules
        // above — a partner's per-branch rules disagreeing with each other is
        // still a disagreement about where that restaurant goes.
        const partnerCategories = distinctCategories(merchantRuleScope(matching, partnerRows));
        if (partnerCategories.length > 1) {
          log.debug(`[AI pipeline] partner rules disagree about ${vendor} — routing to review`);
        } else if (matching.length > 0) {
          borrowed = { row: matching[0], from: 'partner' };
        }
      }

      const borrowedName = borrowed
        ? String(borrowed.row.category_id || '')
        // The pool is consulted last and matches on the whole normalised key
        // only — never by prefix or "contains". A short key from a stranger
        // matching by substring is precisely the case the confidence scoring
        // exists to distrust, and here there is nobody around to notice.
        : (dependencies.lookupCommunityRule(vendorKey)?.category || '');

      if (borrowedName) {
        const borrowedCat = availableCategories.find(
          (c) => c.name.toLowerCase() === borrowedName.toLowerCase(),
        );
        if (borrowedCat) {
          categoryId = borrowedCat.id;
          categoryName = borrowedCat.name;
          // A partner's polished name is worth taking — one household, one
          // spelling. The pool's is not: it does not store one, and a
          // stranger's wording should never rename a user's purchase.
          if (borrowed?.row.proper_name) {
            displayVendor = borrowed.row.proper_name;
          }
          log.debug(
            `[AI pipeline] ${borrowed ? 'partner' : 'community'} rule suggests ` +
            `${vendor} → ${categoryName} (suggestion only, never auto-filed)`,
          );
        }
      }
    }
  }

  // 5b: Check localStorage vendor map (exact match first, then fuzzy)
  // Exact match handles the common case (user corrected "AMZN MKTP" → "Amazon"
  // and future "AMZN MKTP" notifications hit the exact key). The fuzzy pass
  // handles the case where the same underlying merchant shows up under a
  // slightly different surface form (e.g. "AMAZON.COM" vs "AMZN MKTP" vs
  // "Amazon Prime" all map to "Amazon"). Without fuzzy matching, the user
  // would have to correct each variant separately.
  if (!categoryId && parsed.vendorKey) {
    const vendorMapMatch = findVendorMapMatch({
      entries: dependencies.getVendorMap(),
      vendorKey: parsed.vendorKey,
      aliasKeys: vendorAliases.map(toMatchKey),
      incomingName: parsed.vendorDisplay || parsed.vendorKey,
    });
    if (vendorMapMatch?.kind === 'fuzzy') {
      log.debug(
        `[AI pipeline] vendorMap fuzzy match: "${parsed.vendorDisplay}" → ` +
        `"${vendorMapMatch.entry.vendor_display}" (key=${vendorMapMatch.key})`,
      );
    }

    const vendorMapEntry = vendorMapMatch?.entry;
    if (vendorMapEntry) {
      displayVendor = vendorMapEntry.vendor_display || displayVendor;
      const matchedCategory = availableCategories.find(
        (c) => c.name.toLowerCase() === vendorMapEntry.budget.toLowerCase(),
      );
      if (matchedCategory) {
        categoryId = matchedCategory.id;
        categoryName = matchedCategory.name;
      }
    }
  }

  // 5c: Fallback category — try AI suggestion first, then "Other"
  if (!categoryId && availableCategories.length > 0) {
    const choice = chooseNotificationFallbackCategory({
      availableCategories,
      aiSuggestedCategory: input.aiSuggestedCategory,
      merchantText: `${vendor || ''} ${input.rawNotification || ''}`,
      hiddenCategoryIds: input.hiddenCategoryIds,
    });

    switch (choice.kind) {
      case 'ai':
        categoryId = choice.category.id;
        categoryName = choice.category.name;
        log.debug(`[AI pipeline] AI suggested category: ${categoryName}`);
        break;
      case 'signal':
        categoryId = choice.category.id;
        categoryName = choice.category.name;
        log.debug(
          `[AI pipeline] merchant signal ${choice.signal.kind} (${choice.signal.evidence}) → ${categoryName}`,
        );
        break;
      case 'fallback':
        categoryId = choice.category.id;
        categoryName = choice.category.name;
        log.debug(`[AI pipeline] Fallback category: ${categoryName}`);
        break;
      case 'none':
        break;
      default: {
        const unreachableChoice: never = choice;
        throw new Error(`Unhandled notification category choice: ${String(unreachableChoice)}`);
      }
    }
  }

  return {
    categoryId,
    categoryName,
    displayVendor,
    overrideMatchConfidence,
    overrideRuleConflict,
    realCategories,
  };
}
