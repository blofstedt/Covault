import React, { useState, useMemo, useCallback, useEffect } from 'react';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import RegexSetupModal from './RegexSetupModal';
import { PendingTransaction, BudgetCategory, Transaction } from '../types';
import { supabase } from '../lib/supabase';
import { REST_BASE, getAuthHeaders } from '../lib/apiHelpers';
import {
  saveNotificationRule,
  reprocessUnconfiguredCaptures,
  updateRuleKeywordFilter,
  KEYWORD_IGNORED_PATTERN_ID,
  type NotificationRuleRow,
} from '../lib/notificationProcessor';

import NotificationToggleCard from './transaction_parsing/NotificationToggleCard';
import ParsingRulesCard from './transaction_parsing/ParsingRulesCard';
import VendorCategoryRulesCard from './transaction_parsing/VendorCategoryRulesCard';
import IgnoredNotificationsCard from './transaction_parsing/IgnoredNotificationsCard';
import CapturedNotificationsCard from './transaction_parsing/CapturedNotificationsCard';
import ToBeReviewedCard from './transaction_parsing/ToBeReviewedCard';
import ApprovedTransactionsCard from './transaction_parsing/ApprovedTransactionsCard';
import RejectedTransactionsCard from './transaction_parsing/RejectedTransactionsCard';
import SetupInfoCard from './transaction_parsing/SetupInfoCard';
import RejectConfirmModal from './transaction_parsing/RejectConfirmModal';

interface VendorOverride {
  id: string;
  vendor_name: string;
  category_id: string;
  auto_accept: boolean;
  category_name?: string;
}

/** Delay before reloading pending transactions after a scan, to allow the notification pipeline to finish processing. */
const SCAN_PROCESSING_DELAY_MS = 2000;

/** Tolerance for comparing monetary amounts (e.g., vendor+amount matching). */
const AMOUNT_MATCH_TOLERANCE = 0.01;

interface TransactionParsingProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onBack: () => void;
  onAddTransaction: () => void;
  onGoHome: () => void;
  autoDetectedTransactions?: Transaction[];
  onTransactionTap?: (tx: Transaction) => void;
  pendingTransactions?: PendingTransaction[];
  budgets?: BudgetCategory[];
  onApprovePending?: (pendingId: string, categoryId: string) => void | Promise<void>;
  onRejectPending?: (pendingId: string) => void;
  onRefreshNotifications?: () => Promise<void>;
  onReloadPendingTransactions?: (userId: string) => Promise<void>;
  userId?: string;
  isTutorialMode?: boolean;
  showDemoData?: boolean;
}

const TransactionParsing: React.FC<TransactionParsingProps> = ({
  enabled,
  onToggle,
  onBack,
  onAddTransaction,
  onGoHome,
  autoDetectedTransactions = [],
  onTransactionTap,
  pendingTransactions = [],
  budgets = [],
  onApprovePending,
  onRejectPending,
  onRefreshNotifications,
  onReloadPendingTransactions,
  userId,
  isTutorialMode = false,
  showDemoData = false,
}) => {
  const [expandedPendingId, setExpandedPendingId] = useState<string | null>(null);
  const [expandedVendorCategory, setExpandedVendorCategory] = useState<string | null>(null);
  const [setupNotification, setSetupNotification] = useState<PendingTransaction | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [keywordEditRuleId, setKeywordEditRuleId] = useState<string | null>(null);
  const [onlyParseText, setOnlyParseText] = useState('');
  const [keywordMode, setKeywordMode] = useState<'all' | 'some' | 'one'>('one');
  const [savingKeywords, setSavingKeywords] = useState(false);
  const [addingRuleForBank, setAddingRuleForBank] = useState<string | null>(null);
  const [newRuleType, setNewRuleType] = useState('');

  // ── Loaded data from Supabase ──
  const [savedRules, setSavedRules] = useState<NotificationRuleRow[]>([]);
  const [vendorOverrides, setVendorOverrides] = useState<VendorOverride[]>([]);

  // ── Load saved notification rules from Supabase ──
  const loadRules = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('notification_rules')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[TransactionParsing] Error loading rules:', error);
      return;
    }
    setSavedRules((data || []) as NotificationRuleRow[]);
  }, [userId]);

  // ── Load vendor overrides (default categories) from Supabase ──
  const loadVendorOverrides = useCallback(async () => {
    if (!userId) return;

    try {
      const headers = await getAuthHeaders();

      const overridesRes = await fetch(
        `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&order=vendor_name`,
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
        { headers },
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
      }));
      setVendorOverrides(overrides);
    } catch (err: any) {
      console.error('[TransactionParsing] Exception loading vendor overrides:', err?.message || err);
    }
  }, [userId]);

  // Load rules and vendor overrides on mount + when userId changes
  useEffect(() => {
    loadRules();
    loadVendorOverrides();
  }, [loadRules, loadVendorOverrides]);

  // Refresh rules and vendor overrides when the page/app regains visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadRules();
        loadVendorOverrides();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadRules, loadVendorOverrides]);

  // ── Toggle auto_accept on a vendor override ──
  const handleToggleAutoAccept = useCallback(
    async (overrideId: string, currentValue: boolean) => {
      if (!userId) return;
      const newValue = !currentValue;

      // Optimistically update local state for immediate UI feedback
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

        // Sync local state with the actual value returned from Supabase
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

      // Find the override before removing so we can revert on error or fall back to name-based delete
      const deletedOverride = vendorOverrides.find((vo) => vo.id === overrideId);
      const vendorName = deletedOverride?.vendor_name;

      // Optimistically remove from local state for immediate UI feedback
      setVendorOverrides((prev) => prev.filter((vo) => vo.id !== overrideId));
      // Collapse the expanded vendor panel so the deleted rule disappears from view
      setExpandedVendorCategory(null);

      try {
        const headers = await getAuthHeaders();
        let url: string;

        // If the ID is a temporary optimistic ID, delete by vendor name instead
        if (overrideId.startsWith('temp-') && vendorName) {
          url = `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=eq.${encodeURIComponent(vendorName)}`;
        } else {
          url = `${REST_BASE}/vendor_overrides?id=eq.${overrideId}&user_id=eq.${userId}`;
        }

        const res = await fetch(url, { method: 'DELETE', headers });

        if (!res.ok) {
          const body = await res.text();
          console.error('[TransactionParsing] Error deleting vendor override:', res.status, body.slice(0, 200));
          if (deletedOverride) {
            setVendorOverrides((prev) => [...prev, deletedOverride]);
          }
          return;
        }
      } catch (err: any) {
        console.error('[TransactionParsing] Exception deleting vendor override:', err?.message || err);
        if (deletedOverride) {
          setVendorOverrides((prev) => [...prev, deletedOverride]);
        }
        return;
      }

      // Reload to ensure local state matches the database
      await loadVendorOverrides();
    },
    [userId, vendorOverrides, loadVendorOverrides],
  );

  // ── Handle tapping a saved parsing rule to edit it ──
  const handleEditRule = useCallback(
    async (rule: NotificationRuleRow) => {
      if (!userId) return;
      // Find the most recent notification from this bank app to use as a sample
      const { data, error } = await supabase
        .from('pending_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('app_package', rule.bank_app_id)
        .order('posted_at', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) {
        console.warn('[TransactionParsing] No notification found for rule editing');
        return;
      }

      const notification = data[0] as PendingTransaction;
      setEditingRuleId(rule.id);
      setSetupNotification(notification);
    },
    [userId],
  );

  // ── Handle saving an edited rule (updates existing rule) ──
  const handleSaveEditedRule = useCallback(
    async (amountRegex: string, vendorRegex: string) => {
      if (!editingRuleId || !userId) return;

      setSavingRule(true);
      try {
        const { error } = await supabase
          .from('notification_rules')
          .update({
            amount_regex: amountRegex,
            vendor_regex: vendorRegex,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRuleId)
          .eq('user_id', userId);

        if (error) {
          console.error('[TransactionParsing] Error updating rule:', error);
          return;
        }

        // Refresh the rules list
        await loadRules();

        setSetupNotification(null);
        setEditingRuleId(null);
      } catch (err) {
        console.error('[TransactionParsing] Error saving edited rule:', err);
      } finally {
        setSavingRule(false);
      }
    },
    [editingRuleId, userId, loadRules],
  );

  // ── Handle opening keyword editing for a rule ──
  const handleOpenKeywordEdit = useCallback(
    (rule: NotificationRuleRow) => {
      setKeywordEditRuleId(rule.id);
      setOnlyParseText(rule.only_parse || (rule.filter_keywords || []).join(', '));
      setKeywordMode(rule.filter_mode || 'one');
    },
    [],
  );

  // ── Handle saving keyword filter for a rule ──
  const handleSaveKeywords = useCallback(
    async (ruleId: string) => {
      if (!userId) return;
      setSavingKeywords(true);
      try {
        const success = await updateRuleKeywordFilter(ruleId, userId, onlyParseText, keywordMode);
        if (success) {
          await loadRules();
          setKeywordEditRuleId(null);
        }
      } catch (err) {
        console.error('[TransactionParsing] Error saving keywords:', err);
      } finally {
        setSavingKeywords(false);
      }
    },
    [userId, onlyParseText, keywordMode, loadRules],
  );

  // ── Handle adding a new rule for an existing bank (multi-regex) ──
  const handleStartAddRuleForBank = useCallback(
    (bankAppId: string) => {
      setAddingRuleForBank(bankAppId);
      setNewRuleType('');
    },
    [],
  );

  // ── Handle saving new rule type for a bank ──
  const handleConfirmNewRuleType = useCallback(
    async (bankAppId: string) => {
      if (!userId || !newRuleType.trim()) return;
      // Find an existing notification from this bank for the regex setup
      const { data, error } = await supabase
        .from('pending_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('app_package', bankAppId)
        .order('posted_at', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) {
        console.warn('[TransactionParsing] No notification found for new rule type');
        setAddingRuleForBank(null);
        return;
      }

      const notification = data[0] as PendingTransaction;
      setEditingRuleId(null); // not editing, creating new
      setSetupNotification(notification);
      setAddingRuleForBank(null);
    },
    [userId, newRuleType],
  );

  // ── Handle saving a new rule with a notification type ──
  const handleSaveNewTypedRule = useCallback(
    async (amountRegex: string, vendorRegex: string) => {
      if (!setupNotification || !userId) return;

      setSavingRule(true);
      try {
        const rule = await saveNotificationRule({
          userId,
          bankAppId: setupNotification.app_package,
          bankName: setupNotification.app_name,
          amountRegex,
          vendorRegex,
          sampleNotification: setupNotification.notification_text,
          notificationType: newRuleType.trim() || 'default',
        });

        if (rule) {
          await reprocessUnconfiguredCaptures(userId, setupNotification.app_package, rule);
          if (onReloadPendingTransactions) {
            await onReloadPendingTransactions(userId);
          }
          await loadRules();
          await loadVendorOverrides();
        }

        setSetupNotification(null);
        setNewRuleType('');
      } catch (err) {
        console.error('[TransactionParsing] Error saving typed rule:', err);
      } finally {
        setSavingRule(false);
      }
    },
    [setupNotification, userId, newRuleType, onReloadPendingTransactions, loadRules, loadVendorOverrides],
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

      // Optimistically update local state for immediate UI feedback
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

        // Sync local state with the actual value returned from Supabase
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
      
      // Get category name for optimistic update
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

        if (existing) {
          // Optimistically update local state for immediate UI feedback
          setVendorOverrides((prev) =>
            prev.map((vo) =>
              vo.id === existing.id
                ? { ...vo, category_id: categoryId, category_name: categoryName }
                : vo
            )
          );

          // Update existing override
          const res = await fetch(
            `${REST_BASE}/vendor_overrides?id=eq.${existing.id}&user_id=eq.${userId}`,
            { method: 'PATCH', headers, body: JSON.stringify({ category_id: categoryId }) },
          );

          if (!res.ok) {
            const body = await res.text();
            console.error('[TransactionParsing] Error updating vendor category:', res.status, body.slice(0, 200));
            // Revert optimistic update on failure
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
          // Optimistically add new override to local state for immediate UI feedback
          const tempId = `temp-${crypto.randomUUID()}`;
          const newOverride: VendorOverride = {
            id: tempId,
            vendor_name: vendorName,
            category_id: categoryId,
            auto_accept: false, // Database default for new records
            category_name: categoryName,
          };
          setVendorOverrides((prev) => [...prev, newOverride]);

          // Insert a new vendor override
          const insertRes = await fetch(`${REST_BASE}/vendor_overrides`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ user_id: userId, vendor_name: vendorName, category_id: categoryId }),
          });

          if (!insertRes.ok) {
            // If insert failed (e.g. unique constraint violation because the
            // override already exists in the DB), fall back to updating by name
            const updateRes = await fetch(
              `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=eq.${encodeURIComponent(vendorName)}`,
              { method: 'PATCH', headers, body: JSON.stringify({ category_id: categoryId }) },
            );

            if (!updateRes.ok) {
              const insertBody = await insertRes.text();
              const updateBody = await updateRes.text();
              console.error('[TransactionParsing] Error setting vendor override (insert failed:', insertBody.slice(0, 200), ', update failed:', updateBody.slice(0, 200), ')');
              // Revert optimistic update on failure
              setVendorOverrides((prev) => prev.filter((vo) => vo.id !== tempId));
              return;
            }
          }
        }
      } catch (err: any) {
        console.error('[TransactionParsing] Exception setting vendor category:', err?.message || err);
      }

      // Reload to get the actual data from database (including real IDs for new records)
      await loadVendorOverrides();
      setExpandedVendorCategory(null);
    },
    [userId, vendorOverrides, budgets, loadVendorOverrides],
  );

  // ── Categorize pending transactions into sections ──

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

  // 2. To Review: rule exists, needs category + approval
  //    Includes both successfully parsed (OK) and regex-failed notifications
  //    so the user can see everything that came from a configured bank.
  //    Excludes pending transactions that already have a matching approved
  //    transaction (same vendor + amount) in the main dashboard.
  //    Also excludes keyword-ignored notifications.
  const toReviewTransactions = useMemo(
    () => pendingTransactions.filter(
      (pt) => {
        if (!pt.pattern_id || pt.pattern_id === KEYWORD_IGNORED_PATTERN_ID || !pt.needs_review) return false;
        // Check if an approved transaction already exists with the same vendor + amount
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

  // All unique vendor names from auto-detected transactions and vendor overrides
  const allVendors = useMemo(() => {
    const vendorSet = new Map<string, string>(); // lowercase → display name
    for (const tx of autoDetectedTransactions) {
      const key = tx.vendor.toLowerCase();
      if (!vendorSet.has(key)) vendorSet.set(key, tx.vendor);
    }
    for (const vo of vendorOverrides) {
      const key = vo.vendor_name.toLowerCase();
      if (!vendorSet.has(key)) vendorSet.set(key, vo.vendor_name);
    }
    return Array.from(vendorSet.values()).sort((a, b) => a.localeCompare(b));
  }, [autoDetectedTransactions, vendorOverrides]);

  // Approved transactions: only auto-detected transactions that have a
  // valid budget category assigned, meaning they were fully approved
  // (manually or automatically) from captured notifications.
  const approvedTransactions = useMemo(
    () => autoDetectedTransactions.filter((tx) => tx.budget_id),
    [autoDetectedTransactions],
  );

  // Rejected transactions: pending transactions that were rejected due to
  // duplicate detection or other reasons.
  const rejectedTransactions = useMemo(
    () => pendingTransactions.filter(
      (pt) => !pt.needs_review && pt.approved === false && pt.rejection_reason != null,
    ),
    [pendingTransactions],
  );

  const toReviewCount = toReviewTransactions.length;
  const capturedCount = capturedNotifications.length;
  const ignoredCount = keywordIgnoredNotifications.length;
  const rejectedCount = rejectedTransactions.length;

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

  // ── Handle saving a regex rule from the setup modal ──
  const handleSaveRule = useCallback(
    async (amountRegex: string, vendorRegex: string) => {
      if (!setupNotification || !userId) return;

      setSavingRule(true);
      try {
        const rule = await saveNotificationRule({
          userId,
          bankAppId: setupNotification.app_package,
          bankName: setupNotification.app_name,
          amountRegex,
          vendorRegex,
          sampleNotification: setupNotification.notification_text,
        });

        if (rule) {
          // Re-process all unconfigured captures for this bank
          await reprocessUnconfiguredCaptures(userId, setupNotification.app_package, rule);

          // Reload pending transactions from DB (state was updated in Supabase)
          if (onReloadPendingTransactions) {
            await onReloadPendingTransactions(userId);
          }

          // Refresh the rules list and vendor overrides (reprocessing may create overrides)
          await loadRules();
          await loadVendorOverrides();
        }

        setSetupNotification(null);
      } catch (err) {
        console.error('[TransactionParsing] Error saving rule:', err);
      } finally {
        setSavingRule(false);
      }
    },
    [setupNotification, userId, onReloadPendingTransactions, loadRules, loadVendorOverrides],
  );

  // ── Handle manual scan for transactions ──
  const handleScanForTransactions = useCallback(async () => {
    setIsScanning(true);
    try {
      if (onRefreshNotifications) {
        await onRefreshNotifications();
      }
      // Allow time for the notification pipeline to process before reloading
      await new Promise((resolve) => setTimeout(resolve, SCAN_PROCESSING_DELAY_MS));
      if (onReloadPendingTransactions && userId) {
        await onReloadPendingTransactions(userId);
      }
      // Reload rules and vendor overrides so UI reflects any backend changes
      await loadRules();
      await loadVendorOverrides();
    } catch (err) {
      console.error('[TransactionParsing] Error scanning for transactions:', err);
    } finally {
      setIsScanning(false);
    }
  }, [onRefreshNotifications, onReloadPendingTransactions, userId, loadRules, loadVendorOverrides]);


  return (
    <div className="flex-1 flex flex-col h-screen relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
      {/* Background glow */}
      <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700 animate-nest">
        <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/25 dark:bg-emerald-500/35"></div>
        <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/20 dark:bg-green-400/30"></div>
      </div>

      {/* Header */}
      <header
        className="px-6 pt-safe-top pb-2 sticky top-0 z-20 transition-colors bg-transparent border-none backdrop-blur-none relative z-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)' }}
      >
        <div className="flex items-center justify-center">
          <h1 className="text-xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            Transaction Parsing
          </h1>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col p-4 pb-24 overflow-y-auto relative z-10">
        <div className="max-w-2xl mx-auto w-full space-y-4">
          {enabled || isTutorialMode ? (
            <>
              {/* Active state: toggle + app picker */}
              <NotificationToggleCard enabled={enabled} onToggle={onToggle} />

              {/* Parsing Rules: Saved Bank Notification Rules */}
              <ParsingRulesCard
                savedRules={savedRules}
                rulesByBank={rulesByBank}
                showDemoData={showDemoData}
                addingRuleForBank={addingRuleForBank}
                newRuleType={newRuleType}
                keywordEditRuleId={keywordEditRuleId}
                onlyParseText={onlyParseText}
                keywordMode={keywordMode}
                savingKeywords={savingKeywords}
                onStartAddRuleForBank={handleStartAddRuleForBank}
                onSetAddingRuleForBank={setAddingRuleForBank}
                onSetNewRuleType={setNewRuleType}
                onConfirmNewRuleType={handleConfirmNewRuleType}
                onEditRule={handleEditRule}
                onOpenKeywordEdit={handleOpenKeywordEdit}
                onSetKeywordEditRuleId={setKeywordEditRuleId}
                onSetOnlyParseText={setOnlyParseText}
                onSetKeywordMode={setKeywordMode}
                onSaveKeywords={handleSaveKeywords}
              />

              {/* Vendor Category Rules: Default categories per vendor */}
              <VendorCategoryRulesCard
                allVendors={allVendors}
                vendorOverrideByName={vendorOverrideByName}
                categoryNameById={categoryNameById}
                expandedVendorCategory={expandedVendorCategory}
                budgets={budgets}
                showDemoData={showDemoData}
                onSetExpandedVendorCategory={setExpandedVendorCategory}
                onToggleAutoAccept={handleToggleAutoAccept}
                onSetVendorCategory={handleSetVendorCategory}
                onDeleteVendorOverride={handleDeleteVendorOverride}
              />

              {/* Ignored Notifications: Keyword-filtered out */}
              <IgnoredNotificationsCard
                keywordIgnoredNotifications={keywordIgnoredNotifications}
              />

              {/* Captured Notifications: needs rule setup */}
              <CapturedNotificationsCard
                capturedByBank={capturedByBank}
                capturedCount={capturedCount}
                onSetupNotification={setSetupNotification}
              />

              {/* To Be Reviewed */}
              <ToBeReviewedCard
                toReviewTransactions={toReviewTransactions}
                toReviewCount={toReviewCount}
                expandedPendingId={expandedPendingId}
                vendorOverrideByName={vendorOverrideByName}
                categoryNameById={categoryNameById}
                budgets={budgets}
                showDemoData={showDemoData}
                isScanning={isScanning}
                onSetExpandedPendingId={setExpandedPendingId}
                onApprovePending={onApprovePending}
                onRejectConfirm={setRejectConfirmId}
                onLoadVendorOverrides={loadVendorOverrides}
                onScanForTransactions={handleScanForTransactions}
              />

              {/* Approved Transactions */}
              <ApprovedTransactionsCard
                approvedTransactions={approvedTransactions}
                vendorOverrideByName={vendorOverrideByName}
                showDemoData={showDemoData}
                onTransactionTap={onTransactionTap}
              />

              {/* Rejected Transactions */}
              <RejectedTransactionsCard
                rejectedTransactions={rejectedTransactions}
              />
            </>
          ) : (
            <SetupInfoCard enabled={enabled} onToggle={onToggle} />
          )}
        </div>
      </main>

      <DashboardBottomBar
        onGoHome={onGoHome}
        onAddTransaction={onAddTransaction}
        onOpenParsing={onBack}
        activeView="parsing"
        pendingCount={toReviewCount + capturedCount}
      />

      {/* Regex Setup Modal */}
      {setupNotification && (
        <RegexSetupModal
          notification={setupNotification}
          onSave={editingRuleId ? handleSaveEditedRule : (newRuleType ? handleSaveNewTypedRule : handleSaveRule)}
          onClose={() => {
            setSetupNotification(null);
            setEditingRuleId(null);
            setNewRuleType('');
          }}
        />
      )}

      {/* Reject Confirmation Modal */}
      {rejectConfirmId && (
        <RejectConfirmModal
          rejectConfirmId={rejectConfirmId}
          onCancel={() => setRejectConfirmId(null)}
          onConfirm={(id) => {
            onRejectPending?.(id);
            setExpandedPendingId(null);
            setRejectConfirmId(null);
          }}
        />
      )}
    </div>
  );
};

export default TransactionParsing;
