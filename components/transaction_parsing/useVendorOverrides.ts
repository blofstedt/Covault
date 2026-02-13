import { useState, useCallback, useEffect } from 'react';
import { REST_BASE, getAuthHeaders } from '../../lib/apiHelpers';
import { BudgetCategory } from '../../types';

export interface VendorOverride {
  id: string;
  vendor_name: string;
  category_id: string;
  auto_accept: boolean;
  category_name?: string;
  proper_name?: string;
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
        `${REST_BASE}/vendor_overrides?select=*&user_id=eq.${userId}&order=vendor_name`,
        { headers, cache: 'no-store' },
      );
      if (!overridesRes.ok) {
        console.error('[TransactionParsing] Error loading vendor overrides:', overridesRes.status, await overridesRes.text());
        return;
      }
      const data = await overridesRes.json();

      // Load all categories to resolve names (vendor_overrides may lack FK to categories)
      const catsRes = await fetch(
        `${REST_BASE}/categories?select=id,name`,
        { headers, cache: 'no-store' },
      );
      let cats: any[] = [];
      if (catsRes.ok) {
        cats = await catsRes.json();
      } else {
        console.error('[TransactionParsing] Error loading categories for name resolution:', catsRes.status);
      }
      const catNameById = new Map<string, string>();
      for (const c of cats) {
        catNameById.set(c.id, c.name);
      }

      const overrides: VendorOverride[] = (data || []).map((row: any) => ({
        id: row.id,
        vendor_name: row.vendor_name,
        category_id: row.category_id,
        auto_accept: row.auto_accept ?? false,
        category_name: catNameById.get(row.category_id) ?? undefined,
        proper_name: row.proper_name ?? undefined,
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

  // ── Toggle auto_accept on a vendor override ──
  const handleToggleAutoAccept = useCallback(
    async (overrideId: string, currentValue: boolean) => {
      if (!userId) return;
      const newValue = !currentValue;

      setVendorOverrides((prev) =>
        prev.map((vo) => (vo.id === overrideId ? { ...vo, auto_accept: newValue } : vo)),
      );

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const res = await fetch(
          `${REST_BASE}/vendor_overrides?id=eq.${overrideId}&user_id=eq.${userId}`,
          { method: 'PATCH', headers, body: JSON.stringify({ auto_accept: newValue }) },
        );
        const body = await res.text();
        let data: any[] = [];
        try { data = body ? JSON.parse(body) : []; } catch { data = []; }

        if (!res.ok || !Array.isArray(data) || data.length === 0) {
          console.error('[TransactionParsing] Error toggling auto_accept:', res.status, body.slice(0, 200));
          setVendorOverrides((prev) =>
            prev.map((vo) => (vo.id === overrideId ? { ...vo, auto_accept: currentValue } : vo)),
          );
          return;
        }

        const actualValue = data[0].auto_accept ?? false;
        setVendorOverrides((prev) =>
          prev.map((vo) => (vo.id === overrideId ? { ...vo, auto_accept: actualValue } : vo)),
        );
      } catch (err: any) {
        console.error('[TransactionParsing] Exception toggling auto_accept:', err?.message || err);
        setVendorOverrides((prev) =>
          prev.map((vo) => (vo.id === overrideId ? { ...vo, auto_accept: currentValue } : vo)),
        );
      }
    },
    [userId],
  );

  // ── Delete a vendor override ──
  const handleDeleteVendorOverride = useCallback(
    async (overrideId: string) => {
      if (!userId) return;

      const deletedOverride = vendorOverrides.find((vo) => vo.id === overrideId);
      const vendorName = deletedOverride?.vendor_name;

      setVendorOverrides((prev) => prev.filter((vo) => vo.id !== overrideId));
      setExpandedVendorCategory(null);

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        let url: string;

        if (overrideId.startsWith('temp-') && vendorName) {
          url = `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=eq.${encodeURIComponent(vendorName)}`;
        } else {
          url = `${REST_BASE}/vendor_overrides?id=eq.${overrideId}&user_id=eq.${userId}`;
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

  // ── Toggle auto-accept for a vendor by vendor name ──
  const handleToggleAutoAcceptByVendor = useCallback(
    async (vendorName: string) => {
      if (!userId) return;
      const override = vendorOverrides.find(
        (vo) => vo.vendor_name.toLowerCase() === vendorName.toLowerCase(),
      );

      if (!override) return;

      const currentValue = override.auto_accept;
      const newValue = !currentValue;

      setVendorOverrides((prev) =>
        prev.map((vo) => (vo.id === override.id ? { ...vo, auto_accept: newValue } : vo)),
      );

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const res = await fetch(
          `${REST_BASE}/vendor_overrides?id=eq.${override.id}&user_id=eq.${userId}`,
          { method: 'PATCH', headers, body: JSON.stringify({ auto_accept: newValue }) },
        );
        const body = await res.text();
        let data: any[] = [];
        try { data = body ? JSON.parse(body) : []; } catch { data = []; }

        if (!res.ok || !Array.isArray(data) || data.length === 0) {
          console.error('[TransactionParsing] Error toggling auto_accept:', res.status, body.slice(0, 200));
          setVendorOverrides((prev) =>
            prev.map((vo) => (vo.id === override.id ? { ...vo, auto_accept: currentValue } : vo)),
          );
          return;
        }

        const actualValue = data[0].auto_accept ?? false;
        setVendorOverrides((prev) =>
          prev.map((vo) => (vo.id === override.id ? { ...vo, auto_accept: actualValue } : vo)),
        );
      } catch (err: any) {
        console.error('[TransactionParsing] Exception toggling auto_accept:', err?.message || err);
        setVendorOverrides((prev) =>
          prev.map((vo) => (vo.id === override.id ? { ...vo, auto_accept: currentValue } : vo)),
        );
      }
    },
    [userId, vendorOverrides],
  );

  // ── Set or update a vendor's default category ──
  const handleSetVendorCategory = useCallback(
    async (vendorName: string, categoryId: string) => {
      if (!userId) return;
      
      const category = budgets.find((b) => b.id === categoryId);
      if (!category) {
        console.error('[TransactionParsing] Invalid category ID:', categoryId);
        return;
      }
      const categoryName = category.name;
      
      const existing = vendorOverrides.find(
        (vo) => vo.vendor_name.toLowerCase() === vendorName.toLowerCase(),
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

          const res = await fetch(
            `${REST_BASE}/vendor_overrides?id=eq.${existing.id}&user_id=eq.${userId}`,
            { method: 'PATCH', headers, body: JSON.stringify({ category_id: categoryId }) },
          );

          if (!res.ok) {
            const body = await res.text();
            console.error('[TransactionParsing] Error updating vendor category:', res.status, body.slice(0, 200));
            setVendorOverrides((prev) =>
              prev.map((vo) =>
                vo.id === existing.id
                  ? { ...vo, category_id: existing.category_id, category_name: existing.category_name }
                  : vo
              )
            );
            return;
          }
        } else {
          const tempId = `temp-${crypto.randomUUID()}`;
          const newOverride: VendorOverride = {
            id: tempId,
            vendor_name: vendorName,
            category_id: categoryId,
            auto_accept: false,
            category_name: categoryName,
          };
          setVendorOverrides((prev) => [...prev, newOverride]);

          const insertRes = await fetch(`${REST_BASE}/vendor_overrides`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ user_id: userId, vendor_name: vendorName, category_id: categoryId }),
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
              `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=eq.${encodeURIComponent(vendorName)}`,
              { method: 'PATCH', headers, body: JSON.stringify({ category_id: categoryId }) },
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

      const existing = vendorOverrides.find(
        (vo) => vo.vendor_name.toLowerCase() === vendorName.toLowerCase(),
      );
      if (!existing) return;

      const trimmed = properName.trim();
      const newProperName = trimmed === '' ? null : trimmed;

      setVendorOverrides((prev) =>
        prev.map((vo) =>
          vo.id === existing.id
            ? { ...vo, proper_name: newProperName ?? undefined }
            : vo
        )
      );

      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const res = await fetch(
          `${REST_BASE}/vendor_overrides?id=eq.${existing.id}&user_id=eq.${userId}`,
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

        const actualValue = data[0].proper_name ?? undefined;
        setVendorOverrides((prev) =>
          prev.map((vo) =>
            vo.id === existing.id
              ? { ...vo, proper_name: actualValue }
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

  return {
    vendorOverrides,
    expandedVendorCategory,
    setExpandedVendorCategory,
    loadVendorOverrides,
    handleToggleAutoAccept,
    handleDeleteVendorOverride,
    handleToggleAutoAcceptByVendor,
    handleSetVendorCategory,
    handleSetProperName,
  };
}
