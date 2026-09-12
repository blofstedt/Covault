// lib/vendorOverrideWrite.ts
//
// Persist a learned vendor→category override to the `overrides` table.
//
// Extracted from the two identical copies that lived in useTransactionOps
// (the AI-rename path and the approve-pending path). The write is an upsert:
//   1. PATCH by match_key (the vendor slug survives display-name variants)
//   2. fall back to PATCH by proper_name (ilike) if no match_key row matched
//   3. if neither PATCH touched a row, POST a new row, ignoring duplicate
//      conflicts from concurrent writes
//
// `categoryName` is stored in the `category_id` column, which holds the
// Budgets enum *name* (e.g. "Groceries"), not a uuid — see SUPABASE_AUDIT.md.
//
// A successful write ANNOUNCES itself (see `onVendorOverrideWritten` below).
// The rule the user teaches by renaming a caught row is written from here,
// while the "rules you've taught" list is loaded once, in a different tree
// (components/transaction_parsing/useVendorOverrides). Nothing joined the two,
// so a rename landed a rule in the database and the list went on showing what
// it had fetched at launch — indistinguishable, on screen, from the rename
// having taught nothing at all. The same stale copy is what gets mirrored to
// the home-screen widget's native matcher, so the new rule also sat unused
// there until the next launch.

import { log } from './log';
import { restFetch } from './apiHelpers';
import { chainAwareMatchKey } from './chainVendorKeys';

/** Called after a vendor rule is successfully written. */
type VendorOverrideListener = () => void;

const listeners = new Set<VendorOverrideListener>();

/**
 * Subscribe to "a vendor rule was just written". Returns an unsubscribe.
 *
 * A subject rather than a callback threaded through the props: a rename can be
 * started from the review row, the transaction sheet or the edit form, and all
 * three end up here. One announcement at the write covers every entry point,
 * and no caller can forget to make it.
 */
export function onVendorOverrideWritten(listener: VendorOverrideListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tell every listener. One throwing listener must not stop the others. */
function announceVendorOverrideWritten(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err: any) {
      log.warn('[persistVendorOverride] listener failed:', err?.message || err);
    }
  }
}

export interface PersistVendorOverrideParams {
  userId: string;
  /** Display name saved on the override. */
  properName: string;
  /** Normalized vendor slug used as the primary match key. */
  matchKey: string;
  /** Budgets enum name stored in `category_id`. */
  categoryName: string;
  /** Name to match with `proper_name=ilike` when the match_key PATCH misses. */
  ilikeFallbackName: string;
}

export async function persistVendorOverride({
  userId,
  properName,
  matchKey,
  categoryName,
  ilikeFallbackName,
}: PersistVendorOverrideParams): Promise<void> {
  // Other is the app's own shrug, not a decision — see the note beside
  // `realCategories` in notificationProcessor.ts. Writing it as a rule would
  // let today's non-answer silently outlive the purchase it was never really
  // about, and reapply itself to the vendor's next charge with full
  // confidence. The transaction itself is filed by the caller regardless;
  // only the "remember this" side effect is skipped.
  if (categoryName.trim().toLowerCase() === 'other') {
    log.debug(`[persistVendorOverride] not teaching a rule for "${properName}" → Other`);
    return;
  }

  // Teach the CHAIN when this is a known one with a branch, store number or
  // city appended — see lib/chainVendorKeys.ts for exactly which chains and
  // why the list stays short. Everything else keeps its own exact key,
  // unchanged.
  const { matchKey: effectiveMatchKey, matchType } = chainAwareMatchKey(matchKey);

  const payload = {
    category_id: categoryName,
    proper_name: properName,
    match_key: effectiveMatchKey,
    match_type: matchType,
    updated_at: new Date().toISOString(),
  };
  const patchInit = {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  } as const;

  // Prefer a match_key update (slug survives name variations), then fall back
  // to the display name. Looked up by the EFFECTIVE key, not the raw one — a
  // second branch of a known chain has to find and reuse the first branch's
  // generalised rule, or every branch would insert its own duplicate "wendys"
  // row instead of sharing one.
  //
  // A PREFIX rule's PATCH is additionally scoped to the SAME category. A
  // generalised chain key can be shared by branches that used to have
  // entirely separate rules, so this must never silently flip a sibling
  // branch's category to whatever this call happens to be teaching — that
  // would turn "one Wendy's disagreed" into "the whole chain now disagrees
  // with itself, silently". A mismatch here falls through to the insert
  // below, which creates a second rule instead of overwriting the first, and
  // two rules sharing one match_key with different categories is exactly the
  // shape the read-side conflict check already knows how to catch.
  //
  // An EXACT rule is not scoped this way — its match_key already belongs to
  // exactly one merchant spelling, so "this vendor, corrected to a different
  // category" is the normal case an exact PATCH exists to handle, in place,
  // same as it always has.
  let patchRes: Response | null = null;
  if (effectiveMatchKey) {
    const categoryScope =
      matchType === 'prefix' ? `&category_id=eq.${encodeURIComponent(categoryName)}` : '';
    patchRes = await restFetch(
      `/overrides?user_id=eq.${userId}` +
        `&match_key=eq.${encodeURIComponent(effectiveMatchKey)}${categoryScope}`,
      patchInit,
    );
  }
  if (!patchRes || !patchRes.ok) {
    patchRes = await restFetch(
      `/overrides?user_id=eq.${userId}&proper_name=ilike.${encodeURIComponent(ilikeFallbackName)}`,
      patchInit,
    );
  }

  const patchBody = await patchRes.text();
  let patchedRows: unknown[] = [];
  try {
    patchedRows = patchBody ? JSON.parse(patchBody) : [];
  } catch {
    patchedRows = [];
  }

  // No existing override was updated — insert one, ignoring conflicts from
  // concurrent writes.
  //
  // The insert's own answer is read, deliberately. It used to be dropped, so a
  // rejected write logged "override saved" and left the caller — and the user —
  // believing a rule had been taught. Throwing hands the failure to the two
  // callers, which already log it.
  if (!patchRes.ok || !Array.isArray(patchedRows) || patchedRows.length === 0) {
    const insertRes = await restFetch(`/overrides`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ user_id: userId, ...payload }),
    });
    if (!insertRes.ok) {
      const insertBody = await insertRes.text();
      throw new Error(
        `overrides insert failed (${insertRes.status}): ${insertBody.slice(0, 200)}`,
      );
    }
  }

  announceVendorOverrideWritten();
}
