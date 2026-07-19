import { useState, useCallback, useEffect } from 'react';
import { REST_BASE, getAuthHeaders } from '../../lib/apiHelpers';
import { BudgetCategory } from '../../types';
import { toVendorKey } from '../../lib/deviceTransactionParser';

export type MatchType = 'exact' | 'prefix' | 'contains';

export interface VendorOverride {
  id: string;
  /** Display name for the vendor (user-editable, e.g. 'Amazon') */
  proper_name: string;
  /** Normalized raw vendor key for matching incoming transactions (e.g. 'amznmktpca') */
  match_key?: string;
  /**
   * How the parser matches future notifications to this override:
   *   - exact    : match_key equals the normalized incoming vendor
   *   - prefix   : incoming normalized vendor starts with match_key
   *   - contains : incoming normalized vendor contains match_key
   * Default 'exact'. Legacy rows (pre-migration) are backfilled to 'exact'.
   */
  match_type?: MatchType;
  /** Most recent update time (ISO). Used for "most recent wins" sorting. */
  updated_at?: string | null;
  /** Budget in app format: 'budget:groceries' (converted from DB's Budgets enum) */
  category_id: string;
  /** Human-readable category name resolved from category_id (not in DB) */
  category_name?: string;
}

interface UseVendorOverridesOptions {
  userId?: string;
  budgets: BudgetCategory[];
}

export function useVendorOverrides({ userId, budgets }: UseVendorOverridesOptions) {
  const [vendorOverrides, setVendorOverrides] = useState<VendorOverride[]>([]);
  const [expandedVendorCategory, setExpandedVendorCategory] = useState<string | null>(null);

  // ── Load vendor overrides (default categories) from Supabase ──
  const loadVendorOverrides = useCallback(async () => {
    if (!userId) return;

    try {
      const headers = await getAuthHeaders();

      const overridesRes = await fetch(
        `${REST_BASE}/overrides?select=*&user_id=eq.${userId}&order=proper_name`,
        { headers, cache: 'no-store' },
      );
      if (!overridesRes.ok) {
        console.error('[TransactionParsing] Error loading vendor overrides:', overridesRes.status, await overridesRes.text());
        return;
      }
      const data = await overridesRes.json();

      // category_id in DB is a Budgets enum value e.g. 'Groceries'.
      // Convert to app format 'budget:groceries' so it matches b.id comparisons elsewhere.
      const overrides: VendorOverride[] = (data || []).map((row: any) => ({
        id: row.id,
        proper_name: row.proper_name,
        match_key: row.match_key || undefined,
        match_type: (row.match_type === 'prefix' || row.match_type === 'contains')
          ? row.match_type
          : 'exact',
        updated_at: row.updated_at || undefined,
        category_id: row.category_id ? `budget:${(row.category_id as string).toLowerCase()}` : '',
        category_name: row.category_id || undefined,
      }));
      setVendorOverrides(overrides);
    } catch (err: any) {
      console.error('[TransactionParsing] Exception loading vendor overrides:', err?.message || err);
    }
  }, [userId]);

  // Load vendor overrides on mount + when userId changes
  useEffect(() => {
    loadVendorOverrides();
  }, [loadVendorOverrides]);

  // ── Delete a vendor override ──
  const handleDeleteVendorOverride = useCallback(
    async (overrideId: string) => {
      if (!userId) return;

      const deletedOverride = vendorOverrides.find((vo) => vo.id === overrideId);
      const properName = deletedOverride?.proper_name;

      setVendorOverrides((prev) => prev.filter((vo) => vo.id !== overrideId));
      setExpandedVendorCategory(null);

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        let url: string;

        if (overrideId.startsWith('temp-') && properName) {
          url = `${REST_BASE}/overrides?user_id=eq.${userId}&proper_name=eq.${encodeURIComponent(properName)}`;
        } else {
          url = `${REST_BASE}/overrides?id=eq.${overrideId}&user_id=eq.${userId}`;
        }

        const res = await fetch(url, { method: 'DELETE', headers });
        const body = await res.text();
        let deletedRows: any[] = [];
        try { deletedRows = body ? JSON.parse(body) : []; } catch (e) { console.warn('[TransactionParsing] Failed to parse delete response:', e); deletedRows = []; }

        if (!res.ok) {
          console.error('[TransactionParsing] Error deleting vendor override:', res.status, body.slice(0, 200));
          if (deletedOverride) {
            setVendorOverrides((prev) => [...prev, deletedOverride]);
          }
          return;
        }

        if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
          console.warn('[TransactionParsing] Delete matched 0 rows for override:', overrideId);
          // Still keep the optimistic removal — the row may not exist in DB (temp/stale id)
        }

        console.log('[TransactionParsing] Vendor override deleted:', overrideId);
      } catch (err: any) {
        console.error('[TransactionParsing] Exception deleting vendor override:', err?.message || err);
        if (deletedOverride) {
          setVendorOverrides((prev) => [...prev, deletedOverride]);
        }
      }
    },
    [userId, vendorOverrides],
  );

  // ── Set or update a vendor's default category ──
  const handleSetVendorCategory = useCallback(
    async (vendorName: string, categoryId: string) => {
      if (!userId) return;

      // categoryId is in app format 'budget:groceries'; find the budget to get DB name 'Groceries'
      const category = budgets.find((b) => b.id === categoryId);
      if (!category) {
        console.error('[TransactionParsing] Invalid category ID:', categoryId);
        return;
      }
      const categoryName = category.name;
      // DB expects the Budgets enum value (e.g. 'Groceries'), not the app-format id
      const dbCategoryId = categoryName;

      const vendorKey = toVendorKey(vendorName);
      const existing = vendorOverrides.find((vo) =>
        vo.proper_name.toLowerCase() === vendorName.toLowerCase() ||
        (vo.match_key ? vo.match_key === vendorKey : toVendorKey(vo.proper_name) === vendorKey)
      );

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';

        if (existing) {
          setVendorOverrides((prev) =>
            prev.map((vo) =>
              vo.id === existing.id
                ? { ...vo, category_id: categoryId, category_name: categoryName }
                : vo
            )
          );

          // Use proper_name-based URL when override has a temp ID (not yet synced with DB)
          const url = existing.id.startsWith('temp-')
            ? `${REST_BASE}/overrides?user_id=eq.${userId}&proper_name=eq.${encodeURIComponent(existing.proper_name)}`
            : `${REST_BASE}/overrides?id=eq.${existing.id}&user_id=eq.${userId}`;
          const res = await fetch(
            url,
            { method: 'PATCH', headers, body: JSON.stringify({ category_id: dbCategoryId }) },
          );

          const body = await res.text();
          let data: any[] = [];
          try { data = body ? JSON.parse(body) : []; } catch { data = []; }

          if (!res.ok || !Array.isArray(data) || data.length === 0) {
            console.error('[TransactionParsing] Error updating vendor category:', res.status, (body || '').slice(0, 200));
            setVendorOverrides((prev) =>
              prev.map((vo) =>
                vo.id === existing.id
                  ? { ...vo, category_id: existing.category_id, category_name: existing.category_name }
                  : vo
              )
            );
            return;
          }

          // Replace temp ID with real ID from DB response
          if (existing.id.startsWith('temp-') && Array.isArray(data) && data.length > 0) {
            const realId = data[0].id;
            setVendorOverrides((prev) =>
              prev.map((vo) => vo.id === existing.id ? { ...vo, id: realId } : vo)
            );
          }
        } else {
          const tempId = `temp-${crypto.randomUUID()}`;
          const newOverride: VendorOverride = {
            id: tempId,
            proper_name: vendorName,
            category_id: categoryId,
            category_name: categoryName,
          };
          setVendorOverrides((prev) => [...prev, newOverride]);

          const insertRes = await fetch(`${REST_BASE}/overrides`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ user_id: userId, proper_name: vendorName, match_key: vendorKey, category_id: dbCategoryId }),
          });

          if (insertRes.ok) {
            // Replace temp ID with real ID from server response
            const insertBody = await insertRes.text();
            let insertedRows: any[] = [];
            try { insertedRows = insertBody ? JSON.parse(insertBody) : []; } catch (e) { console.warn('[TransactionParsing] Failed to parse insert response:', e); insertedRows = []; }
            if (Array.isArray(insertedRows) && insertedRows.length > 0) {
              const realId = insertedRows[0].id;
              setVendorOverrides((prev) =>
                prev.map((vo) => vo.id === tempId ? { ...vo, id: realId } : vo)
              );
            }
          } else {
            const updateRes = await fetch(
              `${REST_BASE}/overrides?user_id=eq.${userId}&proper_name=eq.${encodeURIComponent(vendorName)}`,
              { method: 'PATCH', headers, body: JSON.stringify({ category_id: dbCategoryId }) },
            );

            if (updateRes.ok) {
              // Replace temp override with the real data from the update response
              const updateBody = await updateRes.text();
              let updatedRows: any[] = [];
              try { updatedRows = updateBody ? JSON.parse(updateBody) : []; } catch (e) { console.warn('[TransactionParsing] Failed to parse update response:', e); updatedRows = []; }
              if (Array.isArray(updatedRows) && updatedRows.length > 0) {
                const realId = updatedRows[0].id;
                setVendorOverrides((prev) =>
                  prev.map((vo) => vo.id === tempId ? { ...vo, id: realId } : vo)
                );
              }
            } else {
              const insertBody = await insertRes.text();
              const updateBody = await updateRes.text();
              console.error('[TransactionParsing] Error setting vendor override (insert failed:', insertBody.slice(0, 200), ', update failed:', updateBody.slice(0, 200), ')');
              setVendorOverrides((prev) => prev.filter((vo) => vo.id !== tempId));
              return;
            }
          }
        }
      } catch (err: any) {
        console.error('[TransactionParsing] Exception setting vendor category:', err?.message || err);
      }

      setExpandedVendorCategory(null);
    },
    [userId, vendorOverrides, budgets],
  );

  // ── Set or update a vendor's proper (display) name ──
  const handleSetProperName = useCallback(
    async (vendorName: string, properName: string) => {
      if (!userId) return;

      const vendorKey = toVendorKey(vendorName);
      const existing = vendorOverrides.find((vo) =>
        vo.proper_name.toLowerCase() === vendorName.toLowerCase() ||
        (vo.match_key ? vo.match_key === vendorKey : toVendorKey(vo.proper_name) === vendorKey)
      );
      if (!existing) return;

      const trimmed = properName.trim();
      const newProperName = trimmed === '' ? null : trimmed;

      setVendorOverrides((prev) =>
        prev.map((vo) =>
          vo.id === existing.id
            ? { ...vo, proper_name: newProperName ?? existing.proper_name }
            : vo
        )
      );

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        // Use proper_name-based URL when override has a temp ID (not yet synced with DB)
        const url = existing.id.startsWith('temp-')
          ? `${REST_BASE}/overrides?user_id=eq.${userId}&proper_name=eq.${encodeURIComponent(existing.proper_name)}`
          : `${REST_BASE}/overrides?id=eq.${existing.id}&user_id=eq.${userId}`;
        const res = await fetch(
          url,
          { method: 'PATCH', headers, body: JSON.stringify({ proper_name: newProperName }) },
        );
        const body = await res.text();
        let data: any[] = [];
        try { data = body ? JSON.parse(body) : []; } catch { data = []; }

        if (!res.ok || !Array.isArray(data) || data.length === 0) {
          console.error('[TransactionParsing] Error setting proper name:', res.status, body.slice(0, 200));
          setVendorOverrides((prev) =>
            prev.map((vo) =>
              vo.id === existing.id
                ? { ...vo, proper_name: existing.proper_name }
                : vo
            )
          );
          return;
        }

        const actualValue = data[0].proper_name ?? existing.proper_name;
        const realId = data[0].id ?? existing.id;
        setVendorOverrides((prev) =>
          prev.map((vo) =>
            vo.id === existing.id
              ? { ...vo, proper_name: actualValue, id: realId }
              : vo
          )
        );
      } catch (err: any) {
        console.error('[TransactionParsing] Exception setting proper name:', err?.message || err);
        setVendorOverrides((prev) =>
          prev.map((vo) =>
            vo.id === existing.id
              ? { ...vo, proper_name: existing.proper_name }
              : vo
          )
        );
      }
    },
    [userId, vendorOverrides],
  );

  // ── Set or update a vendor override's match_type ──
  // Changes how future notifications are matched: 'exact' (default),
  // 'prefix' (incoming vendorKey starts with match_key), or 'contains'.
  // Per spec, the user can switch any of these from the UI.
  const handleSetMatchType = useCallback(
    async (vendorName: string, matchType: MatchType) => {
      if (!userId) return;
      const vendorKey = toVendorKey(vendorName);
      const existing = vendorOverrides.find((vo) =>
        vo.proper_name.toLowerCase() === vendorName.toLowerCase() ||
        (vo.match_key ? vo.match_key === vendorKey : toVendorKey(vo.proper_name) === vendorKey)
      );
      if (!existing) return;
      if ((existing.match_type || 'exact') === matchType) return; // no-op

      // Optimistic update
      setVendorOverrides((prev) =>
        prev.map((vo) =>
          vo.id === existing.id ? { ...vo, match_type: matchType } : vo
        )
      );

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const url = existing.id.startsWith('temp-')
          ? `${REST_BASE}/overrides?user_id=eq.${userId}&proper_name=eq.${encodeURIComponent(existing.proper_name)}`
          : `${REST_BASE}/overrides?id=eq.${existing.id}&user_id=eq.${userId}`;
        const res = await fetch(
          url,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ match_type: matchType, updated_at: new Date().toISOString() }),
          },
        );
        if (!res.ok) {
          console.error('[TransactionParsing] Error setting match_type:', res.status, await res.text());
          // Roll back
          setVendorOverrides((prev) =>
            prev.map((vo) =>
              vo.id === existing.id ? { ...vo, match_type: existing.match_type || 'exact' } : vo
            )
          );
        }
      } catch (err: any) {
        console.error('[TransactionParsing] Exception setting match_type:', err?.message || err);
        setVendorOverrides((prev) =>
          prev.map((vo) =>
            vo.id === existing.id ? { ...vo, match_type: existing.match_type || 'exact' } : vo
          )
        );
      }
    },
    [userId, vendorOverrides],
  );

  // ── Optimistically upsert a vendor override in local state (no DB call) ──
  const upsertLocalVendorOverride = useCallback(
    (vendorName: string, categoryId: string, categoryNameOverride?: string) => {
      const category = budgets.find((b) => b.id === categoryId);
      if (!category) return;
      const categoryName = categoryNameOverride || category.name;

      setVendorOverrides((prev) => {
        const existingIdx = prev.findIndex(
          (vo) => vo.proper_name.toLowerCase() === vendorName.toLowerCase(),
        );
        if (existingIdx >= 0) {
          // Update existing override
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            category_id: categoryId,
            category_name: categoryName,
          };
          return updated;
        }
        // Add new override
        return [
          ...prev,
          {
            id: `temp-${crypto.randomUUID()}`,
            proper_name: vendorName,
            match_key: toVendorKey(vendorName),
            category_id: categoryId,
            category_name: categoryName,
          },
        ];
      });
    },
    [budgets],
  );

  return {
    vendorOverrides,
    expandedVendorCategory,
    setExpandedVendorCategory,
    loadVendorOverrides,
    handleDeleteVendorOverride,
    handleSetVendorCategory,
    handleSetProperName,
    handleSetMatchType,
    upsertLocalVendorOverride,
  };
}
