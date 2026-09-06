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
  const payload = {
    category_id: categoryName,
    proper_name: properName,
    match_key: matchKey,
    match_type: 'exact',
    updated_at: new Date().toISOString(),
  };
  const patchInit = {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  } as const;

  // Prefer a match_key update (slug survives name variations), then fall back
  // to the display name.
  let patchRes: Response | null = null;
  if (matchKey) {
    patchRes = await restFetch(
      `/overrides?user_id=eq.${userId}&match_key=eq.${encodeURIComponent(matchKey)}`,
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
