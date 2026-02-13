import { useMemo } from 'react';
import { PendingTransaction, BudgetCategory, Transaction } from '../../types';
import { KEYWORD_IGNORED_PATTERN_ID } from '../../lib/notificationProcessor';
import type { NotificationRuleRow } from '../../lib/notificationProcessor';
import type { VendorOverride } from './useVendorOverrides';

/** Tolerance for comparing monetary amounts (e.g., vendor+amount matching). */
const AMOUNT_MATCH_TOLERANCE = 0.01;

interface UseTransactionCategoriesOptions {
  pendingTransactions: PendingTransaction[];
  autoDetectedTransactions: Transaction[];
  vendorOverrides: VendorOverride[];
  budgets: BudgetCategory[];
  savedRules: NotificationRuleRow[];
}

export function useTransactionCategories({
  pendingTransactions,
  autoDetectedTransactions,
  vendorOverrides,
  budgets,
  savedRules,
}: UseTransactionCategoriesOptions) {
  // 1. Captured: no rule configured (pattern_id is null)
  const capturedNotifications = useMemo(
    () => pendingTransactions.filter(
      (pt) => !pt.pattern_id && pt.needs_review,
    ),
    [pendingTransactions],
  );

  // 1b. Keyword-ignored: filtered out by keyword rules
  const keywordIgnoredNotifications = useMemo(
    () => pendingTransactions.filter(
      (pt) => pt.pattern_id === KEYWORD_IGNORED_PATTERN_ID && pt.needs_review,
    ),
    [pendingTransactions],
  );

  // Rejected transactions: pending transactions rejected due to duplicates etc.
  const rejectedTransactions = useMemo(
    () => pendingTransactions.filter(
      (pt) => !pt.needs_review && pt.approved === false && pt.rejection_reason != null,
    ),
    [pendingTransactions],
  );

  // Combined filtered-out notifications: keyword-ignored only (rejected shown separately)
  const filteredOutNotifications = useMemo(
    () => [...keywordIgnoredNotifications],
    [keywordIgnoredNotifications],
  );

  // 2. To Review: rule exists, needs category + approval
  const toReviewTransactions = useMemo(
    () => pendingTransactions.filter(
      (pt) => {
        if (!pt.pattern_id || pt.pattern_id === KEYWORD_IGNORED_PATTERN_ID || !pt.needs_review) return false;
        const vendor = (pt.extracted_vendor || '').toLowerCase();
        const alreadyApproved = autoDetectedTransactions.some(
          (tx) =>
            tx.vendor.toLowerCase() === vendor &&
            Math.abs(tx.amount - pt.extracted_amount) < AMOUNT_MATCH_TOLERANCE,
        );
        return !alreadyApproved;
      },
    ),
    [pendingTransactions, autoDetectedTransactions],
  );

  // Group captured notifications by bank app
  const capturedByBank = useMemo(() => {
    const groups = new Map<string, PendingTransaction[]>();
    for (const pt of capturedNotifications) {
      const key = pt.app_name || pt.app_package;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(pt);
    }
    return groups;
  }, [capturedNotifications]);

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

  // All unique vendor names from notification-parsed pending transactions and vendor overrides
  const allVendors = useMemo(() => {
    const vendorSet = new Map<string, string>();
    for (const pt of pendingTransactions) {
      const vendor = (pt.extracted_vendor || '').trim();
      if (!vendor) continue;
      const key = vendor.toLowerCase();
      if (!vendorSet.has(key)) vendorSet.set(key, vendor);
    }
    for (const vo of vendorOverrides) {
      const key = vo.vendor_name.toLowerCase();
      if (!vendorSet.has(key)) vendorSet.set(key, vo.vendor_name);
    }
    return Array.from(vendorSet.values()).sort((a, b) => a.localeCompare(b));
  }, [pendingTransactions, vendorOverrides]);

  // Approved transactions: auto-detected from captured notifications, with a valid budget category, not projected
  const approvedTransactions = useMemo(
    () => autoDetectedTransactions.filter(
      (tx) => tx.budget_id && !tx.is_projected && (tx.label === 'Auto-Added' || tx.label === 'Auto-Added + Edited'),
    ),
    [autoDetectedTransactions],
  );

  // Group saved rules by bank for multi-regex display
  const rulesByBank = useMemo(() => {
    const groups = new Map<string, NotificationRuleRow[]>();
    for (const rule of savedRules) {
      const key = rule.bank_app_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rule);
    }
    return groups;
  }, [savedRules]);

  const toReviewCount = toReviewTransactions.length;
  const capturedCount = capturedNotifications.length;
  const filteredOutCount = filteredOutNotifications.length;

  return {
    capturedNotifications,
    keywordIgnoredNotifications,
    filteredOutNotifications,
    toReviewTransactions,
    capturedByBank,
    categoryNameById,
    vendorOverrideByName,
    allVendors,
    approvedTransactions,
    rejectedTransactions,
    rulesByBank,
    toReviewCount,
    capturedCount,
    filteredOutCount,
  };
}
