// lib/vendorBackfill.ts
//
// Backfill historical transactions when the user renames a vendor.
//
// When a user creates or edits a vendor correction (e.g. renames
// "AMZN MKTP" → "Amazon"), we want to retroactively update any
// historical transactions that had the OLD vendor name so the user's
// budget history is consistent. Per product spec, this is gated on a
// preview: we count matches first, then ask the user to confirm.
//
// Matching semantics match the existing override lookup (Step 5a in
// notificationProcessor.ts): the same vendor_key normalization, the
// same match_type (exact/prefix/contains). The match_type on the
// override determines which historical rows are eligible for backfill.

import { log } from './log';
import { restFetch } from './apiHelpers';

/**
 * Count historical transactions that would be updated by applying
 * a vendor correction with the given match_key + match_type.
 * Used to show the user a preview ("this will update 14 transactions")
 * before they confirm.
 */
export async function countBackfillMatches(
  userId: string,
  matchKey: string,
  matchType: 'exact' | 'prefix' | 'contains',
): Promise<number> {
  if (!userId || !matchKey) return 0;
  try {
    // Fetch all user transactions' vendors. Filter in-memory for
    // match_type semantics. (Cheaper than 3 separate count queries,
    // and the user's transactions table is small — hundreds of rows
    // even for power users.)
    const res = await restFetch(
      `/transactions?select=vendor&user_id=eq.${userId}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return 0;
    const rows: Array<{ vendor: string }> = await res.json();
    return matchesInList(rows, matchKey, matchType);
  } catch {
    return 0;
  }
}

function normalize(vendor: string): string {
  return (vendor || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchesInList(
  rows: Array<{ vendor: string }>,
  matchKey: string,
  matchType: 'exact' | 'prefix' | 'contains',
): number {
  const mk = matchKey.toLowerCase();
  if (!mk) return 0;
  return rows.filter((r) => {
    const nk = normalize(r.vendor);
    if (!nk) return false;
    if (matchType === 'exact') return nk === mk;
    if (matchType === 'prefix') return nk.startsWith(mk);
    if (matchType === 'contains') return nk.includes(mk);
    return false;
  }).length;
}

export interface BackfillResult {
  updated: number;
  /** Sample of updated rows (id + new vendor name) for the toast message. */
  sample: Array<{ id: string; vendor: string }>;
}

/**
 * Apply a vendor correction retroactively to all matching historical
 * transactions. Same matching semantics as countBackfillMatches.
 *
 * Vendor matching runs against the *normalized* vendor key, which
 * PostgREST cannot express as a filter, so all three match types take
 * the same route: fetch the user's rows, filter in memory, then patch
 * the matching ids in batches.
 *
 * Returns the number of rows updated (best-effort; PostgREST doesn't
 * always echo the count on PATCH).
 */
export async function applyVendorBackfill(
  userId: string,
  oldMatchKey: string,
  newVendor: string,
  matchType: 'exact' | 'prefix' | 'contains',
): Promise<BackfillResult> {
  if (!userId || !oldMatchKey || !newVendor) return { updated: 0, sample: [] };
  const trimmed = newVendor.trim();
  if (!trimmed) return { updated: 0, sample: [] };

  // PostgREST has no normalize operator, so every match_type takes the same
  // path: fetch the user's rows and filter in memory (same as the count path).
  return patchByIds(userId, oldMatchKey, matchType, trimmed);
}

async function patchByIds(
  userId: string,
  oldMatchKey: string,
  matchType: 'exact' | 'prefix' | 'contains',
  newVendor: string,
): Promise<BackfillResult> {
  // Fetch all user transactions and filter in-memory.
  const res = await restFetch(
    `/transactions?select=id,vendor&user_id=eq.${userId}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return { updated: 0, sample: [] };
  const rows: Array<{ id: string; vendor: string }> = await res.json();
  const mk = oldMatchKey.toLowerCase();
  const idsToUpdate = rows
    .filter((r) => {
      const nk = normalize(r.vendor);
      if (!nk) return false;
      if (matchType === 'exact') return nk === mk;
      if (matchType === 'prefix') return nk.startsWith(mk);
      if (matchType === 'contains') return nk.includes(mk);
      return false;
    })
    .map((r) => r.id);

  if (idsToUpdate.length === 0) {
    return { updated: 0, sample: [] };
  }

  // Patch in chunks of 50 to keep URLs short.
  const CHUNK = 50;
  let updatedTotal = 0;
  const sample: Array<{ id: string; vendor: string }> = [];

  for (let i = 0; i < idsToUpdate.length; i += CHUNK) {
    const chunk = idsToUpdate.slice(i, i + CHUNK);
    const idList = chunk.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
    const patchRes = await restFetch(
      `/transactions?user_id=eq.${userId}&id=in.(${idList})`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ vendor: newVendor }),
      },
    );
    if (!patchRes.ok) {
      log.warn('[vendorBackfill] chunk patch failed:', patchRes.status, await patchRes.text());
      continue;
    }
    // The PATCH doesn't return the rows by default. Use a separate
    // select if we need a sample. For our use case the count is enough.
    const body = await patchRes.text();
    let updatedRows: any[] = [];
    try { updatedRows = body ? JSON.parse(body) : []; } catch { updatedRows = []; }
    updatedTotal += Array.isArray(updatedRows) ? updatedRows.length : 0;
  }

  // Sample for the toast: first 3 ids.
  for (const id of idsToUpdate.slice(0, 3)) {
    sample.push({ id, vendor: newVendor });
  }

  return { updated: updatedTotal || idsToUpdate.length, sample };
}

export { normalize as normalizeVendorKey };
