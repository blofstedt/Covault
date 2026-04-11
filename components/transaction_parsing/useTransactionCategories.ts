import { useMemo } from 'react';
import { PendingTransaction, BudgetCategory, Transaction } from '../../types';
import type { VendorOverride } from './useVendorOverrides';
import { toVendorKey } from '../../lib/deviceTransactionParser';

/** Tolerance for comparing monetary amounts (e.g., vendor+amount matching). */
const AMOUNT_MATCH_TOLERANCE = 0.01;

/** Format a date string/timestamp to YYYY-MM-DD using local time. */
function toLocalDateStr(dateInput: string | number): string {
  const d = new Date(dateInput);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface UseTransactionCategoriesOptions {
  pendingTransactions: PendingTransaction[];
  autoDetectedTransactions: Transaction[];
  allTransactions?: Transaction[];
  vendorOverrides: VendorOverride[];
  budgets: BudgetCategory[];
}

export function useTransactionCategories({
  pendingTransactions,
  autoDetectedTransactions,
  allTransactions = [],
  vendorOverrides,
  budgets,
}: UseTransactionCategoriesOptions) {
  // Pending: status === 'pending', needs user review
  const toReviewTransactions = useMemo(
    () => pendingTransactions.filter(
      (pt) => {
        if (pt.status !== 'pending') return false;
        const vendor = (pt.extracted_vendor || '').toLowerCase();
        // Check against auto-detected transactions
        const alreadyApproved = autoDetectedTransactions.some(
          (tx) =>
            tx.vendor.toLowerCase() === vendor &&
            Math.abs(tx.amount - pt.extracted_amount) < AMOUNT_MATCH_TOLERANCE,
        );
        if (alreadyApproved) return false;
        // Check against all existing transactions (including manually added)
        const ptDateStr = toLocalDateStr(pt.extracted_timestamp || pt.posted_at || pt.created_at);
        const alreadyExists = allTransactions.some(
          (tx) =>
            tx.vendor.toLowerCase() === vendor &&
            Math.abs(tx.amount - pt.extracted_amount) < AMOUNT_MATCH_TOLERANCE &&
            tx.date === ptDateStr,
        );
        return !alreadyExists;
      },
    ),
    [pendingTransactions, autoDetectedTransactions, allTransactions],
  );

  // Rejected transactions: status === 'rejected'
  const rejectedTransactions = useMemo(
    () => pendingTransactions.filter(
      (pt) => pt.status === 'rejected' && pt.rejection_reason != null,
    ),
    [pendingTransactions],
  );

  // Build a lookup: category_id → category name
  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of budgets) {
      map.set(b.id, b.name);
    }
    return map;
  }, [budgets]);

  // Build a lookup: normalized vendor key → vendor override.
  // Keyed by both match_key (raw extracted vendor, e.g. 'amznmktpca') and
  // toVendorKey(proper_name) (display name, e.g. 'amazon') so lookups work
  // whether the caller has the raw transaction vendor or the display name.
  const vendorOverrideByName = useMemo(() => {
    const map = new Map<string, VendorOverride>();
    for (const vo of vendorOverrides) {
      // Primary: match_key set at override-creation time from the raw extracted vendor
      if (vo.match_key) map.set(vo.match_key, vo);
      // Secondary: normalized proper_name — supports VendorCategoryRulesCard lookups
      // and backwards-compat for overrides created before match_key was introduced
      map.set(toVendorKey(vo.proper_name), vo);
    }
    return map;
  }, [vendorOverrides]);

  // All unique vendor display names from vendor overrides that have a category set.
  const allVendors = useMemo(() => {
    const vendorSet = new Map<string, string>();
    for (const vo of vendorOverrides) {
      if (!vo.category_id) continue;
      const key = toVendorKey(vo.proper_name);
      if (!vendorSet.has(key)) vendorSet.set(key, vo.proper_name);
    }
    return Array.from(vendorSet.values()).sort((a, b) => a.localeCompare(b));
  }, [vendorOverrides]);

  // Approved transactions: auto-detected from captured notifications
  const approvedTransactions = useMemo(
    () => autoDetectedTransactions.filter(
      (tx) => tx.budget_id && !tx.is_projected && tx.label === 'Automatic',
    ),
    [autoDetectedTransactions],
  );

  const toReviewCount = toReviewTransactions.length;

  return {
    toReviewTransactions,
    categoryNameById,
    vendorOverrideByName,
    allVendors,
    approvedTransactions,
    rejectedTransactions,
    toReviewCount,
  };
}
