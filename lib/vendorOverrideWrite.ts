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

import { restFetch } from './apiHelpers';

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
  if (!patchRes.ok || !Array.isArray(patchedRows) || patchedRows.length === 0) {
    await restFetch(`/overrides`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({ user_id: userId, ...payload }),
    });
  }
}
