import { useMemo } from 'react';
import { PendingTransaction, BudgetCategory, Transaction } from '../../types';
import type { VendorOverride } from './useVendorOverrides';

interface UseTransactionCategoriesOptions {
  pendingTransactions: PendingTransaction[];
  autoDetectedTransactions: Transaction[];
  vendorOverrides: VendorOverride[];
  budgets: BudgetCategory[];
}

export function useTransactionCategories({
  pendingTransactions,
  autoDetectedTransactions,
  vendorOverrides,
  budgets,
}: UseTransactionCategoriesOptions) {
  // Rejected transactions: pending transactions rejected due to duplicates, extraction failures, etc.
  const rejectedTransactions = useMemo(
    () => pendingTransactions.filter(
      (pt) => !pt.needs_review && pt.approved === false && pt.rejection_reason != null,
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

  // Build a lookup: vendor name → vendor override
  const vendorOverrideByName = useMemo(() => {
    const map = new Map<string, VendorOverride>();
    for (const vo of vendorOverrides) {
      map.set(vo.vendor_name.toLowerCase(), vo);
    }
    return map;
  }, [vendorOverrides]);

  // All unique vendor names from vendor overrides that have a category set.
  // Vendors only appear in Vendor Rules once they've been assigned a budget category.
  const allVendors = useMemo(() => {
    const vendorSet = new Map<string, string>();
    for (const vo of vendorOverrides) {
      if (!vo.category_id) continue;
      const key = vo.vendor_name.toLowerCase();
      if (!vendorSet.has(key)) vendorSet.set(key, vo.vendor_name);
    }
    return Array.from(vendorSet.values()).sort((a, b) => a.localeCompare(b));
  }, [vendorOverrides]);

  // Approved transactions: auto-added from notifications, with a valid budget category, not projected
  const approvedTransactions = useMemo(
    () => autoDetectedTransactions.filter(
      (tx) => tx.budget_id && !tx.is_projected && (tx.label === 'Auto-Added' || tx.label === 'Auto-Added + Edited'),
    ),
    [autoDetectedTransactions],
  );

  return {
    categoryNameById,
    vendorOverrideByName,
    allVendors,
    approvedTransactions,
    rejectedTransactions,
  };
}
