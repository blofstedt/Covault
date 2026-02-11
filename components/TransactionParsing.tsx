import React, { useState, useMemo, useCallback, useEffect } from 'react';
import NotificationSettings from './NotificationSettings';
import DashboardBottomBar from './dashboard_components/DashboardBottomBar';
import RegexSetupModal from './RegexSetupModal';
import { PendingTransaction, BudgetCategory, Transaction } from '../types';
import { supabase } from '../lib/supabase';
import {
  saveNotificationRule,
  reprocessUnconfiguredCaptures,
  updateRuleKeywordFilter,
  parseOnlyParseKeywords,
  KEYWORD_IGNORED_PATTERN_ID,
  type NotificationRuleRow,
} from '../lib/notificationProcessor';

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

    const { data, error } = await supabase
      .from('vendor_overrides')
      .select('id, vendor_name, category_id, auto_accept, created_at')
      .eq('user_id', userId)
      .order('vendor_name');

    if (error) {
      console.error('[TransactionParsing] Error loading vendor overrides:', error);
      return;
    }

    // Load all categories to resolve names (vendor_overrides may lack FK to categories)
    const { data: cats, error: catsError } = await supabase
      .from('categories')
      .select('id, name');
    if (catsError) {
      console.error('[TransactionParsing] Error loading categories for name resolution:', catsError);
    }
    const catNameById = new Map<string, string>();
    for (const c of cats || []) {
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
  }, [userId]);

  // Load rules and vendor overrides on mount + when userId changes
  useEffect(() => {
    loadRules();
    loadVendorOverrides();
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

      const { data, error } = await supabase
        .from('vendor_overrides')
        .update({ auto_accept: newValue })
        .eq('id', overrideId)
        .eq('user_id', userId)
        .select();

      if (error || !data || data.length === 0) {
        console.error('[TransactionParsing] Error toggling auto_accept:', error || 'No rows updated');
        // Revert optimistic update on failure
        setVendorOverrides((prev) =>
          prev.map((vo) => (vo.id === overrideId ? { ...vo, auto_accept: currentValue } : vo)),
        );
        return;
      }
    },
    [userId],
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
        }

        setSetupNotification(null);
        setNewRuleType('');
      } catch (err) {
        console.error('[TransactionParsing] Error saving typed rule:', err);
      } finally {
        setSavingRule(false);
      }
    },
    [setupNotification, userId, newRuleType, onReloadPendingTransactions, loadRules],
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

      const { data, error } = await supabase
        .from('vendor_overrides')
        .update({ auto_accept: newValue })
        .eq('id', override.id)
        .eq('user_id', userId)
        .select();

      if (error || !data || data.length === 0) {
        console.error('[TransactionParsing] Error toggling auto_accept:', error || 'No rows updated');
        // Revert optimistic update on failure
        setVendorOverrides((prev) =>
          prev.map((vo) => (vo.id === override.id ? { ...vo, auto_accept: currentValue } : vo)),
        );
        return;
      }
    },
    [userId, vendorOverrides],
  );

  // ── Set or update a vendor's default category ──
  const handleSetVendorCategory = useCallback(
    async (vendorName: string, categoryId: string) => {
      if (!userId) return;
      const existing = vendorOverrides.find(
        (vo) => vo.vendor_name.toLowerCase() === vendorName.toLowerCase(),
      );

      if (existing) {
        // Update existing override
        const { error } = await supabase
          .from('vendor_overrides')
          .update({ category_id: categoryId })
          .eq('id', existing.id)
          .eq('user_id', userId);

        if (error) {
          console.error('[TransactionParsing] Error updating vendor category:', error);
          return;
        }
      } else {
        // Upsert: insert or update if already exists (handles stale local state)
        let { error } = await supabase
          .from('vendor_overrides')
          .upsert(
            {
              user_id: userId,
              vendor_name: vendorName,
              category_id: categoryId,
              auto_accept: false,
            },
            { onConflict: 'user_id,vendor_name' },
          );

        // Retry without auto_accept if column doesn't exist yet
        if (error && error.message && error.message.includes('auto_accept')) {
          console.warn('[TransactionParsing] auto_accept column missing, retrying without it:', error.message);
          const retry = await supabase
            .from('vendor_overrides')
            .upsert(
              {
                user_id: userId,
                vendor_name: vendorName,
                category_id: categoryId,
              },
              { onConflict: 'user_id,vendor_name' },
            );
          error = retry.error;
        }

        if (error) {
          console.error('[TransactionParsing] Error upserting vendor override:', error);
          return;
        }
      }

      await loadVendorOverrides();
      setExpandedVendorCategory(null);
    },
    [userId, vendorOverrides, loadVendorOverrides],
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

  const toReviewCount = toReviewTransactions.length;
  const capturedCount = capturedNotifications.length;
  const ignoredCount = keywordIgnoredNotifications.length;

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

          // Refresh the rules list
          await loadRules();
        }

        setSetupNotification(null);
      } catch (err) {
        console.error('[TransactionParsing] Error saving rule:', err);
      } finally {
        setSavingRule(false);
      }
    },
    [setupNotification, userId, onReloadPendingTransactions, loadRules],
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
    } catch (err) {
      console.error('[TransactionParsing] Error scanning for transactions:', err);
    } finally {
      setIsScanning(false);
    }
  }, [onRefreshNotifications, onReloadPendingTransactions, userId]);

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
              <div id="parsing-notification-toggle" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
                <NotificationSettings
                  enabled={enabled}
                  onToggle={onToggle}
                />
              </div>

              {/* ──────────────────────────────────────────────────── */}
              {/* RULES: Saved Bank Notification Rules */}
              {/* ──────────────────────────────────────────────────── */}
              {(savedRules.length > 0 || showDemoData) && (
                <div id="parsing-rules-section" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-emerald-200 dark:border-emerald-800/40 space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                      <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        Parsing Rules
                      </h3>
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                        How Covault reads transactions from each bank
                      </p>
                    </div>
                    <span className="text-[10px] font-black bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full">
                      {showDemoData && savedRules.length === 0 ? 1 : savedRules.length}
                    </span>
                  </div>

                  {savedRules.length > 0 ? (
                    <>
                      {Array.from(rulesByBank.entries()).map(([bankAppId, bankRules]) => (
                        <div key={bankAppId} className="space-y-2">
                          <div className="flex items-center justify-between px-1">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                              {bankRules[0].bank_name}
                              {bankRules.length > 1 && (
                                <span className="ml-1 text-emerald-500">
                                  — {bankRules.length} rules
                                </span>
                              )}
                            </p>
                            <button
                              onClick={() => handleStartAddRuleForBank(bankAppId)}
                              className="text-[8px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 transition-all active:scale-95"
                            >
                              + Add Rule
                            </button>
                          </div>

                          {/* Add new rule type input */}
                          {addingRuleForBank === bankAppId && (
                            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-200 dark:border-emerald-800/30 space-y-2">
                              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                New Notification Type
                              </p>
                              <p className="text-[8px] text-slate-400 dark:text-slate-500 leading-relaxed">
                                Add a label for this notification type (e.g. "Purchase", "Transfer", "Payment")
                              </p>
                              <input
                                type="text"
                                value={newRuleType}
                                onChange={(e) => setNewRuleType(e.target.value)}
                                placeholder="e.g. Purchase, Transfer..."
                                className="w-full px-3 py-2 text-[11px] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setAddingRuleForBank(null)}
                                  className="flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl transition-all active:scale-[0.98]"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleConfirmNewRuleType(bankAppId)}
                                  disabled={!newRuleType.trim()}
                                  className="flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-xl transition-all active:scale-[0.98]"
                                >
                                  Set Up Regex
                                </button>
                              </div>
                            </div>
                          )}

                          {bankRules.map((rule) => {
                            const effectiveOnlyParse = rule.only_parse || (rule.filter_keywords || []).join(', ');
                            const onlyParseKeywordCount = parseOnlyParseKeywords(effectiveOnlyParse).length;
                            return (
                            <div key={rule.id} className="bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-800/30 overflow-hidden">
                              <button
                                onClick={() => handleEditRule(rule)}
                                className="w-full flex items-center justify-between p-3 transition-all active:scale-[0.98]"
                              >
                                <div className="flex items-center space-x-3">
                                  <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0">
                                    <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  </div>
                                  <div className="min-w-0 text-left">
                                    {rule.notification_type && rule.notification_type !== 'default' && (
                                      <p className="text-[8px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-0.5">
                                        {rule.notification_type}
                                      </p>
                                    )}
                                    <p className="text-[8px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[200px]">
                                      vendor: /{rule.vendor_regex}/
                                    </p>
                                    <p className="text-[8px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[200px]">
                                      amount: /{rule.amount_regex}/
                                    </p>
                                  </div>
                                </div>
                                <span className="text-[8px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 shrink-0">
                                  Tap to edit
                                </span>
                              </button>

                              {/* Only Parse (keyword filter) section */}
                              <div className="px-3 pb-3 border-t border-emerald-100 dark:border-emerald-800/30 pt-2">
                                <button
                                  onClick={() => keywordEditRuleId === rule.id ? setKeywordEditRuleId(null) : handleOpenKeywordEdit(rule)}
                                  className="w-full flex items-center justify-between py-1"
                                >
                                  <span className="text-[8px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Only Parse…
                                  </span>
                                  <div className="flex items-center gap-1">
                                    {onlyParseKeywordCount > 0 && (
                                      <span className="text-[8px] font-bold text-emerald-600 dark:text-emerald-400">
                                        {onlyParseKeywordCount} keyword{onlyParseKeywordCount !== 1 ? 's' : ''}
                                      </span>
                                    )}
                                    <svg className={`w-3 h-3 text-slate-400 transition-transform ${keywordEditRuleId === rule.id ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                      <polyline points="9 18 15 12 9 6" />
                                    </svg>
                                  </div>
                                </button>

                                {/* Show saved keywords summary when editor is closed */}
                                {keywordEditRuleId !== rule.id && effectiveOnlyParse && effectiveOnlyParse.trim() && (
                                  <p className="text-[8px] text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5 px-1">
                                    {effectiveOnlyParse}
                                  </p>
                                )}

                                {keywordEditRuleId === rule.id && (
                                  <div className="mt-2 space-y-2">
                                    <p className="text-[8px] text-slate-400 dark:text-slate-500 leading-relaxed">
                                      Only parse notifications that contain these keywords. Others will be ignored.
                                    </p>

                                    {/* Filter mode selector */}
                                    <div className="flex items-center gap-1 flex-wrap">
                                      <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400">Must contain</span>
                                      {(['all', 'some', 'one'] as const).map((mode) => (
                                        <button
                                          key={mode}
                                          onClick={() => setKeywordMode(mode)}
                                          className={`px-2 py-0.5 text-[8px] font-bold rounded-full border transition-all active:scale-95 ${
                                            keywordMode === mode
                                              ? 'bg-emerald-500 text-white border-emerald-600'
                                              : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                                          }`}
                                        >
                                          {mode}
                                        </button>
                                      ))}
                                      <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400">of the words</span>
                                    </div>

                                    {/* Only Parse text input */}
                                    <div>
                                      <input
                                        type="text"
                                        value={onlyParseText}
                                        onChange={(e) => setOnlyParseText(e.target.value)}
                                        placeholder="e.g. debit, purchase, withdrawal"
                                        className="w-full px-2 py-1.5 text-[10px] rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400/50"
                                      />
                                      <p className="text-[7px] text-slate-400 dark:text-slate-500 mt-1">
                                        Separate keywords with commas
                                      </p>
                                    </div>

                                    {/* Save/Cancel buttons */}
                                    <div className="flex gap-2 pt-1">
                                      <button
                                        onClick={() => setKeywordEditRuleId(null)}
                                        className="flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl transition-all active:scale-[0.98]"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => handleSaveKeywords(rule.id)}
                                        disabled={savingKeywords}
                                        className="flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 rounded-xl transition-all active:scale-[0.98]"
                                      >
                                        {savingKeywords ? 'Saving…' : 'Save Keywords'}
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                          })}
                        </div>
                      ))}
                    </>
                  ) : showDemoData && (
                    <div className="w-full flex items-center justify-between p-3 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-100 dark:border-emerald-800/30">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                        <div className="min-w-0 text-left">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                            Example Bank
                          </p>
                          <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono truncate max-w-[200px]">
                            vendor: /Purchase at (.+?) on/
                          </p>
                          <p className="text-[8px] text-slate-400 dark:text-slate-500 font-mono truncate max-w-[200px]">
                            amount: /\$(\d+\.\d{'{2}'})/
                          </p>
                        </div>
                      </div>
                      <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0">
                        Demo
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* ──────────────────────────────────────────────────── */}
              {/* VENDOR CATEGORY RULES: Default categories per vendor */}
              {/* ──────────────────────────────────────────────────── */}
              {(allVendors.length > 0 || showDemoData) && (
                <div id="parsing-vendor-rules-section" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-violet-200 dark:border-violet-800/40 space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-violet-50 dark:bg-violet-900/20 rounded-xl">
                      <svg className="w-5 h-5 text-violet-600 dark:text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        Vendor Category Rules
                      </h3>
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                        Default budget categories for each vendor
                      </p>
                    </div>
                    <span className="text-[10px] font-black bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 px-2.5 py-1 rounded-full">
                      {showDemoData && allVendors.length === 0 ? 2 : allVendors.length}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {allVendors.map((vendorName) => {
                      const vo = vendorOverrideByName.get(vendorName.toLowerCase());
                      const hasCategory = vo && vo.category_id;
                      const isExpanded = expandedVendorCategory === vendorName;

                      return (
                        <div key={vendorName} className="bg-violet-50 dark:bg-violet-900/10 rounded-2xl border border-violet-100 dark:border-violet-800/30 overflow-hidden">
                          <button
                            onClick={() => setExpandedVendorCategory(isExpanded ? null : vendorName)}
                            className="w-full flex items-center justify-between p-3 transition-all active:scale-[0.99]"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">
                                {vendorName}
                              </span>
                              <svg className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                              <span className={`text-[10px] font-bold truncate ${
                                hasCategory
                                  ? 'text-violet-600 dark:text-violet-400'
                                  : 'text-slate-400 dark:text-slate-500 italic'
                              }`}>
                                {hasCategory ? (vo?.category_name || categoryNameById.get(vo?.category_id ?? '') || 'Unknown') : 'None Selected'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {vo && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleAutoAccept(vo.id, vo.auto_accept);
                                  }}
                                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 ${
                                    vo.auto_accept
                                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
                                      : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-700'
                                  }`}
                                  title={vo.auto_accept ? 'Auto-accept is on' : 'Auto-accept is off'}
                                >
                                  <div className={`w-6 h-3.5 rounded-full relative transition-colors ${vo.auto_accept ? 'bg-emerald-400 dark:bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                    <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-all ${vo.auto_accept ? 'left-3' : 'left-0.5'}`} />
                                  </div>
                                  <span>Auto Approve</span>
                                </button>
                              )}
                            </div>
                          </button>

                          {/* Expanded: category picker */}
                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2 border-t border-violet-100 dark:border-violet-800/30 pt-2">
                              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Select Default Category
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {budgets.map((b) => (
                                  <button
                                    key={b.id}
                                    onClick={() => handleSetVendorCategory(vendorName, b.id)}
                                    className={`px-3 py-1.5 text-[10px] font-bold rounded-full border transition-all active:scale-95 ${
                                      vo?.category_id === b.id
                                        ? 'bg-violet-500 text-white border-violet-600'
                                        : 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40'
                                    }`}
                                  >
                                    {b.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {allVendors.length === 0 && showDemoData && (
                      <>
                        <div className="bg-violet-50 dark:bg-violet-900/10 rounded-2xl border border-violet-100 dark:border-violet-800/30 overflow-hidden">
                          <div className="w-full flex items-center justify-between p-3">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">Coffee Shop</span>
                              <svg className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="9 18 15 12 9 6" /></svg>
                              <span className="text-[10px] font-bold truncate text-violet-600 dark:text-violet-400">Leisure</span>
                            </div>
                          </div>
                        </div>
                        <div className="bg-violet-50 dark:bg-violet-900/10 rounded-2xl border border-violet-100 dark:border-violet-800/30 overflow-hidden">
                          <div className="w-full flex items-center justify-between p-3">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate">Grocery Mart</span>
                              <svg className="w-3 h-3 text-slate-300 dark:text-slate-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="9 18 15 12 9 6" /></svg>
                              <span className="text-[10px] font-bold truncate text-violet-600 dark:text-violet-400">Groceries</span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ──────────────────────────────────────────────────── */}
              {/* IGNORED NOTIFICATIONS: Keyword-filtered out */}
              {/* ──────────────────────────────────────────────────── */}
              {ignoredCount > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-300 dark:border-slate-700/40 space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-slate-100 dark:bg-slate-800/50 rounded-xl">
                      <svg className="w-5 h-5 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        Ignored Notifications
                      </h3>
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                        Filtered out by keyword rules
                      </p>
                    </div>
                    <span className="text-[10px] font-black bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2.5 py-1 rounded-full">
                      {ignoredCount}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {keywordIgnoredNotifications.map((pt) => (
                      <div
                        key={pt.id}
                        className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/30"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center shrink-0">
                            <svg className="w-4 h-4 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <circle cx="12" cy="12" r="10" />
                              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                            </svg>
                          </div>
                          <div className="text-left min-w-0">
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-2">
                              {pt.notification_text}
                            </p>
                            <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {pt.app_name} · {new Date(pt.posted_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0 ml-2">
                          Ignored
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ──────────────────────────────────────────────────── */}
              {/* SECTION 1: Captured Notifications (needs rule setup) */}
              {/* ──────────────────────────────────────────────────── */}
              {capturedCount > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-blue-200 dark:border-blue-800/40 space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                      <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </div>
                    <div className="flex-1">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        Captured Notifications
                      </h3>
                      <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                        Tap a notification to teach Covault how to read it
                      </p>
                    </div>
                    <span className="text-[10px] font-black bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-full">
                      {capturedCount}
                    </span>
                  </div>

                  {Array.from(capturedByBank.entries()).map(([bankName, notifications]) => (
                    <div key={bankName} className="space-y-2">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                        {bankName}
                        {!notifications[0]?.pattern_id && (
                          <span className="ml-2 text-blue-500 dark:text-blue-400">
                            — needs setup
                          </span>
                        )}
                      </p>

                      {notifications.map((pt) => (
                        <button
                          key={pt.id}
                          onClick={() => setSetupNotification(pt)}
                          className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-blue-100 dark:border-blue-800/30 transition-all active:scale-[0.98]"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center shrink-0">
                              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </div>
                            <div className="text-left min-w-0">
                              <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2">
                                {pt.notification_text}
                              </p>
                              <p className="text-[8px] text-slate-400 dark:text-slate-500 mt-0.5">
                                {new Date(pt.posted_at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="shrink-0 ml-2">
                            <span className="text-[8px] font-black uppercase tracking-wider text-blue-500 dark:text-blue-400">
                              Set up
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* ──────────────────────────────────────────────────── */}
              {/* SECTION 2: To Be Reviewed (always visible) */}
              {/* ──────────────────────────────────────────────────── */}
              <div id="parsing-to-review-section" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-amber-200 dark:border-amber-800/40 space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                    <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      To Be Reviewed
                    </h3>
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {toReviewCount > 0
                        ? 'Assign a budget category to approve these transactions'
                        : 'No transactions to review'}
                    </p>
                  </div>
                  {toReviewCount > 0 && (
                    <span className="text-[10px] font-black bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-full">
                      {toReviewCount}
                    </span>
                  )}
                </div>

                {(toReviewCount > 0 || (showDemoData && toReviewCount === 0)) ? (
                  <div className="space-y-2">
                    {toReviewCount > 0 ? toReviewTransactions.map((pt) => {
                      const isExpanded = expandedPendingId === pt.id;
                      const vendorOverride = vendorOverrideByName.get(pt.extracted_vendor.toLowerCase());
                      const defaultCategoryName = vendorOverride?.category_id
                        ? (vendorOverride.category_name || categoryNameById.get(vendorOverride.category_id))
                        : undefined;

                      return (
                        <div key={pt.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60 overflow-hidden">
                          {/* Card header */}
                          <button
                            onClick={() => setExpandedPendingId(isExpanded ? null : pt.id)}
                            className="w-full flex items-center justify-between p-4 transition-all active:scale-[0.99]"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center shrink-0">
                                <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                              </div>
                              <div className="text-left min-w-0">
                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                                  {pt.extracted_vendor}
                                </p>
                                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                  {pt.app_name}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                                ${pt.extracted_amount.toFixed(2)}
                              </span>
                              {defaultCategoryName ? (
                                <p className="text-[8px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mt-0.5">
                                  {defaultCategoryName}
                                </p>
                              ) : (
                                <p className="text-[8px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 mt-0.5">
                                  {isExpanded ? 'Collapse' : 'Tap to categorize'}
                                </p>
                              )}
                            </div>
                          </button>

                          {/* Expanded: notification preview + category picker + actions */}
                          {isExpanded && (
                            <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-slate-800/60 pt-3">
                              {/* Notification text preview */}
                              <div className="bg-slate-100 dark:bg-slate-800/80 rounded-xl p-3">
                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Notification</p>
                                <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                                  {pt.notification_text}
                                </p>
                              </div>

                              {/* Category picker */}
                              <div>
                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Assign Category & Approve</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {budgets.map((b) => (
                                    <button
                                      key={b.id}
                                      onClick={async () => {
                                        await onApprovePending?.(pt.id, b.id);
                                        setExpandedPendingId(null);
                                        // Reload vendor overrides since approval may create one
                                        await loadVendorOverrides();
                                      }}
                                      className={`px-3 py-1.5 text-[10px] font-bold rounded-full border transition-all active:scale-95 ${
                                        vendorOverride?.category_id === b.id
                                          ? 'bg-emerald-500 text-white border-emerald-600'
                                          : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'
                                      }`}
                                    >
                                      {b.name}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Reject button */}
                              <button
                                onClick={() => {
                                  setRejectConfirmId(pt.id);
                                }}
                                className="w-full py-2 text-[10px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/10 rounded-xl border border-red-200 dark:border-red-800/30 transition-all active:scale-[0.98] hover:bg-red-100 dark:hover:bg-red-900/20"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }) : showDemoData && (
                      <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60 overflow-hidden">
                        <div className="w-full flex items-center justify-between p-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center shrink-0">
                              <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                              </svg>
                            </div>
                            <div className="text-left min-w-0">
                              <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                                Gas Station
                              </p>
                              <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                                Example Bank
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                              $45.00
                            </span>
                            <p className="text-[8px] font-bold uppercase tracking-wider text-amber-500 dark:text-amber-400 mt-0.5">
                              Demo
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-6 text-center">
                    <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/20 rounded-full flex items-center justify-center mx-auto mb-2">
                      <svg className="w-5 h-5 text-amber-400 dark:text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      No Transactions to Review
                    </p>
                  </div>
                )}

                {/* Scan for Transactions button */}
                <button
                  onClick={handleScanForTransactions}
                  disabled={isScanning}
                  className="w-full py-2.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800/40 transition-all active:scale-[0.98] hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50"
                >
                  {isScanning ? 'Scanning…' : 'Scan for Transactions'}
                </button>
              </div>

              {/* ──────────────────────────────────────────────────── */}
              {/* SECTION 3: Approved Transactions (history) */}
              {/* ──────────────────────────────────────────────────── */}
              <div id="parsing-approved-section" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                    <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      Approved Transactions
                    </h3>
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                      Auto-detected and approved from bank notifications
                    </p>
                  </div>

                </div>

                {(autoDetectedTransactions.length > 0 || showDemoData) ? (
                  <div className="space-y-2">
                    {autoDetectedTransactions.map((tx) => {
                      const vo = vendorOverrideByName.get(tx.vendor.toLowerCase());
                      const approvalLabel = vo?.auto_accept
                        ? '- approved automatically'
                        : '- approved manually';

                      return (
                      <button
                        key={tx.id}
                        onClick={() => onTransactionTap?.(tx)}
                        className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60 transition-all active:scale-[0.98]"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                          <div className="text-left">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                              {tx.vendor}
                            </p>
                            <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                              {new Date(tx.date).toLocaleDateString()} {approvalLabel}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                            ${tx.amount.toFixed(2)}
                          </span>
                        </div>
                      </button>
                      );
                    })}
                    {autoDetectedTransactions.length === 0 && showDemoData && (
                      <div className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800/60">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                            <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                          <div className="text-left">
                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[160px]">
                              Coffee Shop
                            </p>
                            <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">
                              Jan 15, 2026 - approved manually
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-black text-slate-700 dark:text-slate-200">
                            $5.75
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-8 text-center">
                    <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-slate-300 dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                      </svg>
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      No transactions captured yet
                    </p>
                    <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1 leading-relaxed max-w-xs mx-auto">
                      When your banking apps send notifications, they'll appear here for review.
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Setup state: info card + toggle + how it works */}
              <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
                <div className="flex items-start space-x-4">
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl">
                    <svg
                      className="w-8 h-8 text-emerald-600 dark:text-emerald-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                  </div>

                  <div className="flex-1">
                    <h2 className="text-lg font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase mb-2">
                      Transaction Detection
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                      Teach Covault to detect transactions from your banking app notifications. You set it up once per bank — just highlight the vendor and amount in a sample notification.
                    </p>
                  </div>
                </div>

                <NotificationSettings
                  enabled={enabled}
                  onToggle={onToggle}
                />

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight text-center">
                    No AI — your data stays on your device. You control exactly how transactions are detected.
                  </p>
                </div>
              </div>

              {/* How it works */}
              <div className="bg-slate-100 dark:bg-slate-800/50 rounded-2xl p-4 space-y-3">
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  How it works
                </h3>

                <div className="flex flex-col gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      1
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Enable parsing and grant notification access
                    </span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      2
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Tap a captured notification and highlight the vendor name and dollar amount
                    </span>
                  </div>

                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                      3
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Future notifications are automatically parsed — assign categories and approve
                    </span>
                  </div>
                </div>
              </div>
            </>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-100 dark:border-slate-800/60 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-red-500 dark:text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                Reject Transaction?
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                This transaction will be permanently dismissed and won't appear in your review list.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setRejectConfirmId(null)}
                className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onRejectPending?.(rejectConfirmId);
                  setExpandedPendingId(null);
                  setRejectConfirmId(null);
                }}
                className="flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white bg-red-500 dark:bg-red-600 rounded-xl border border-red-600 dark:border-red-700 transition-all active:scale-[0.98]"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionParsing;
