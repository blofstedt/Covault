import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { REST_BASE, getAuthHeaders } from '../../lib/apiHelpers';
import {
  saveNotificationRule,
  reprocessUnconfiguredCaptures,
  updateRuleKeywordFilter,
  type NotificationRuleRow,
} from '../../lib/notificationProcessor';
import { PendingTransaction } from '../../types';

interface UseParsingRulesOptions {
  userId?: string;
  onReloadPendingTransactions?: (userId: string) => Promise<void>;
  loadVendorOverrides: () => Promise<void>;
}

export function useParsingRules({ userId, onReloadPendingTransactions, loadVendorOverrides }: UseParsingRulesOptions) {
  const [savedRules, setSavedRules] = useState<NotificationRuleRow[]>([]);
  const [setupNotification, setSetupNotification] = useState<PendingTransaction | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [keywordEditRuleId, setKeywordEditRuleId] = useState<string | null>(null);
  const [onlyParseText, setOnlyParseText] = useState('');
  const [keywordMode, setKeywordMode] = useState<'all' | 'some' | 'one'>('one');
  const [savingKeywords, setSavingKeywords] = useState(false);
  const [addingRuleForBank, setAddingRuleForBank] = useState<string | null>(null);
  const [newRuleType, setNewRuleType] = useState('');

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

  // Load rules on mount + when userId changes
  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // ── Handle tapping a saved parsing rule to edit it ──
  const handleEditRule = useCallback(
    async (rule: NotificationRuleRow) => {
      if (!userId) return;
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
      setEditingRuleId(null);
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
          await reprocessUnconfiguredCaptures(userId, setupNotification.app_package, rule);
          if (onReloadPendingTransactions) {
            await onReloadPendingTransactions(userId);
          }
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

  return {
    savedRules,
    loadRules,
    setupNotification,
    setSetupNotification,
    savingRule,
    editingRuleId,
    setEditingRuleId,
    keywordEditRuleId,
    setKeywordEditRuleId,
    onlyParseText,
    setOnlyParseText,
    keywordMode,
    setKeywordMode,
    savingKeywords,
    addingRuleForBank,
    setAddingRuleForBank,
    newRuleType,
    setNewRuleType,
    handleEditRule,
    handleSaveEditedRule,
    handleOpenKeywordEdit,
    handleSaveKeywords,
    handleStartAddRuleForBank,
    handleConfirmNewRuleType,
    handleSaveNewTypedRule,
    handleSaveRule,
  };
}
