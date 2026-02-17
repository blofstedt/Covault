// lib/notificationProcessor.ts
//
// Notification processing pipeline with AI-based extraction.
//
// Pipeline:
//   1. Fingerprint deduplication
//   2. AI extraction: vendor, amount, transaction classification
//   3. Duplicate detection (same vendor + amount pair)
//   4. Non-transaction filtering (balance alerts, OTPs, etc.)
//   5. Category assignment: vendor_overrides first, then AI guess
//   6. Insert into transactions table with 'AI' label

import { supabase } from './supabase';
import { REST_BASE, getAuthHeaders } from './apiHelpers';
import { formatVendorName } from './formatVendorName';
import { extractWithAI } from './aiExtractor';
import type { PendingTransaction } from '../types';

// ─── Constants ───────────────────────────────────────────────────

/** Tolerance for comparing monetary amounts */
const AMOUNT_TOLERANCE = 0.01;

/** Number of days tolerance for recurring transaction date matching */
const RECURRING_DATE_TOLERANCE_DAYS = 3;

/** Milliseconds per day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Types ───────────────────────────────────────────────────────

export interface NotificationInput {
  rawNotification: string;
  bankAppId: string;
  bankName: string;
  notificationTitle?: string;
  notificationTimestamp?: number;
  /** Fallback vendor from native plugin (used if regex fails) */
  fallbackVendor?: string;
  /** Fallback amount from native plugin (used if regex fails) */
  fallbackAmount?: number;
}

export interface ProcessingResult {
  /** Whether the notification was processed (false = dedup'd or ignored) */
  processed: boolean;
  /** Reason processing stopped early */
  skipReason?: 'duplicate' | 'ignored' | 'no_user' | 'no_rule' | 'no_match';
  /** The pending transaction record if one was created */
  pendingTransaction?: PendingTransaction;
  /** Whether the transaction was auto-accepted directly into transactions */
  autoAccepted?: boolean;
  /** The transaction ID if auto-accepted */
  transactionId?: string;
  /** The category ID assigned when auto-accepted */
  categoryId?: string;
}

export interface NotificationRuleRow {
  id: string;
  user_id: string;
  bank_app_id: string;
  bank_name: string;
  amount_regex: string;
  vendor_regex: string;
  default_category_id: string | null;
  is_active: boolean;
  flagged_count: number;
  last_flagged_at: string | null;
  only_parse: string;
  filter_keywords?: string[];
  filter_mode?: 'all' | 'some' | 'one';
  notification_type?: string;
  created_at: string;
  updated_at: string;
}

// ─── Step 1: Fingerprint Deduplication ──────────────────────────

/**
 * Generate a fingerprint hash from notification content.
 * Uses: bank_app_id | amount | vendor | timestamp (to the second).
 * The timestamp comes from the notification's original post time, which
 * is stable across rescans.  Two genuinely different transactions at the
 * same vendor for the same amount will have different post-times and
 * therefore different fingerprints.
 */
function generateFingerprintHash(
  bankAppId: string,
  detectedAmount: number | null,
  vendor: string,
  timestampMs: number,
): string {
  const amountStr = detectedAmount != null ? detectedAmount.toFixed(2) : '';
  const normalizedVendor = vendor.toLowerCase().trim();
  // Truncate to the second so minor sub-second jitter doesn't matter
  const timestampSec = Math.floor(timestampMs / 1000);
  const raw = `${bankAppId}|${amountStr}|${normalizedVendor}|${timestampSec}`;

  // Simple hash (djb2)
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Check if this notification has already been processed (deduplication).
 *
 * Uses an upsert with onConflict to atomically check-and-insert.
 * If the fingerprint already exists the upsert is a no-op and we
 * detect the duplicate via the `ignoreDuplicates` flag (status 200
 * with empty data or the existing row).
 */
async function checkAndInsertFingerprint(
  userId: string,
  bankAppId: string,
  detectedAmount: number | null,
  vendor: string,
  timestampMs: number,
): Promise<boolean> {
  const hash = generateFingerprintHash(bankAppId, detectedAmount, vendor, timestampMs);

  // Atomic upsert — the UNIQUE(user_id, fingerprint_hash) constraint
  // guarantees at most one row per fingerprint.  `ignoreDuplicates`
  // makes it a no-op when the row already exists (Postgres ON CONFLICT
  // DO NOTHING).
  const { data, error } = await supabase
    .from('notification_fingerprints')
    .upsert(
      {
        user_id: userId,
        fingerprint_hash: hash,
        bank_app_id: bankAppId,
      },
      { onConflict: 'user_id,fingerprint_hash', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    // If we still somehow hit a constraint violation, treat as duplicate
    if (error.code === '23505') {
      return true;
    }
    console.error('[fingerprint] Error upserting fingerprint:', error);
    return false;
  }

  // When ignoreDuplicates is true and the row already existed, the
  // upsert returns an empty array (no row was inserted).
  if (!data || data.length === 0) {
    return true; // duplicate
  }

  return false; // new fingerprint — not a duplicate
}

// ─── Step 1b: Second-Phase Deduplication ────────────────────────

/**
 * Build a dedup key from the extracted fields: vendor (lowercased),
 * amount (2 decimal places), and extracted_timestamp truncated to the
 * second.  Two records that share the same key are considered
 * duplicates per the issue requirements (exact same vendor, amount,
 * and time down to the second).
 */
function extractedDedupKey(pt: PendingTransaction): string {
  const vendor = (pt.extracted_vendor || '').toLowerCase().trim();
  const amt = Number(pt.extracted_amount);
  const amount = Number.isFinite(amt) ? amt.toFixed(2) : '0.00';
  // Truncate extracted_timestamp to the second
  const tsMs = pt.extracted_timestamp ? new Date(pt.extracted_timestamp).getTime() : 0;
  const tsSec = Math.floor(tsMs / 1000);
  return `${vendor}|${amount}|${tsSec}`;
}

/**
 * Build a dedup key from extracted_amount and notification_timestamp.
 * Two records sharing the same extracted amount and notification
 * timestamp are considered duplicates.
 */
function amountTimestampDedupKey(pt: PendingTransaction): string {
  const amt = Number(pt.extracted_amount);
  const amount = Number.isFinite(amt) ? amt.toFixed(2) : '0.00';
  const ts = pt.notification_timestamp || 0;
  return `${amount}|${ts}`;
}

/**
 * Deduplicate pending transactions that already exist in the database.
 *
 * Runs three dedup passes:
 *   1. Amount+timestamp-based (extracted_amount + notification_timestamp)
 *      — the primary dedup: if both match, it's a dupe.
 *   2. Fingerprint-based (app_package + amount + vendor +
 *      notification_timestamp) — the original approach.
 *   3. Extracted-field-based (extracted_vendor + extracted_amount +
 *      extracted_timestamp to the second) — catches duplicates where
 *      the exact same vendor, amount, and time appear more than once
 *      regardless of source app or notification metadata.
 *
 * In all passes the oldest entry (by created_at) is kept and the
 * rest are deleted from Supabase.
 *
 * Returns the deduplicated list of pending transactions.
 */
export async function deduplicatePendingTransactions(
  userId: string,
  pendingTransactions: PendingTransaction[],
): Promise<PendingTransaction[]> {
  if (pendingTransactions.length <= 1) return pendingTransactions;

  const idsToDelete: string[] = [];
  const keepSet = new Set<string>();

  // ── Pass 1: extracted_amount + notification_timestamp dedup ──
  const notifGroups = new Map<string, PendingTransaction[]>();

  for (const pt of pendingTransactions) {
    const key = amountTimestampDedupKey(pt);
    const group = notifGroups.get(key);
    if (group) {
      group.push(pt);
    } else {
      notifGroups.set(key, [pt]);
    }
  }

  for (const group of notifGroups.values()) {
    if (group.length <= 1) {
      keepSet.add(group[0].id);
      continue;
    }
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    keepSet.add(group[0].id);
    for (let i = 1; i < group.length; i++) {
      idsToDelete.push(group[i].id);
    }
  }

  // ── Pass 2: fingerprint-based dedup ──
  let survivors = pendingTransactions.filter(pt => keepSet.has(pt.id));
  const fpGroups = new Map<string, PendingTransaction[]>();

  for (const pt of survivors) {
    const hash = generateFingerprintHash(
      pt.app_package,
      pt.extracted_amount,
      pt.extracted_vendor,
      pt.notification_timestamp || 0,
    );
    const group = fpGroups.get(hash);
    if (group) {
      group.push(pt);
    } else {
      fpGroups.set(hash, [pt]);
    }
  }

  for (const group of fpGroups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    for (let i = 1; i < group.length; i++) {
      keepSet.delete(group[i].id);
      idsToDelete.push(group[i].id);
    }
  }

  // ── Pass 3: extracted-field dedup (vendor + amount + timestamp to the second) ──
  survivors = pendingTransactions.filter(pt => keepSet.has(pt.id));
  const extGroups = new Map<string, PendingTransaction[]>();

  for (const pt of survivors) {
    const key = extractedDedupKey(pt);
    const group = extGroups.get(key);
    if (group) {
      group.push(pt);
    } else {
      extGroups.set(key, [pt]);
    }
  }

  for (const group of extGroups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    // The oldest is already in keepSet; mark the rest for deletion
    for (let i = 1; i < group.length; i++) {
      keepSet.delete(group[i].id);
      idsToDelete.push(group[i].id);
    }
  }

  // Delete duplicates from the database
  if (idsToDelete.length > 0) {
    console.log(`[dedup] Removing ${idsToDelete.length} duplicate pending transaction(s)`);
    const { error } = await supabase
      .from('pending_transactions')
      .delete()
      .in('id', idsToDelete);

    if (error) {
      console.error('[dedup] Error deleting duplicates:', error);
      // Even on error, still return the deduplicated list for the UI
    }
  }

  return pendingTransactions.filter(pt => keepSet.has(pt.id));
}

// ─── Keyword Filtering ──────────────────────────────────────────

/** Sentinel pattern_id value for notifications ignored by keyword filters */
export const KEYWORD_IGNORED_PATTERN_ID = 'keyword-ignored';

/**
 * Parse keywords from the `only_parse` text field.
 * Keywords are comma-separated; each keyword is trimmed and empty entries
 * are filtered out.
 */
export function parseOnlyParseKeywords(onlyParse: string | null | undefined): string[] {
  if (!onlyParse || !onlyParse.trim()) return [];
  return onlyParse
    .split(',')
    .map((kw) => kw.trim())
    .filter((kw) => kw.length > 0);
}

/**
 * Check if a notification text matches the keyword filter for a rule.
 * Returns true if the notification passes the filter (should be parsed),
 * false if it should be ignored.
 *
 * If no keywords are configured, the notification always passes.
 *
 * Modes:
 *   - 'all':  Every keyword must appear in the notification.
 *   - 'some': At least two keywords must match (or the single keyword
 *             if only one is configured).
 *   - 'one':  At least one keyword must appear.
 */
export function matchesKeywordFilter(
  notificationText: string,
  keywords: string[],
  mode: 'all' | 'some' | 'one',
): boolean {
  if (!keywords || keywords.length === 0) return true;

  const lowerText = notificationText.toLowerCase();
  const matches = keywords.filter((kw) => lowerText.includes(kw.toLowerCase()));

  switch (mode) {
    case 'all':
      return matches.length === keywords.length;
    case 'some':
      return matches.length > 1 || (matches.length === 1 && keywords.length === 1);
    case 'one':
    default:
      return matches.length >= 1;
  }
}

// ─── Step 2: Rule Lookup ────────────────────────────────────────

/**
 * Apply regex rule to extract vendor + amount from notification text.
 */
export function applyRuleToNotification(
  amountRegexSource: string,
  vendorRegexSource: string,
  rawNotification: string,
): { vendor: string; amount: number } | null {
  try {
    const amountRegex = new RegExp(amountRegexSource);
    const vendorRegex = new RegExp(vendorRegexSource);

    const amountMatch = rawNotification.match(amountRegex);
    const vendorMatch = rawNotification.match(vendorRegex);

    if (!amountMatch?.[1] || !vendorMatch?.[1]) {
      return null;
    }

    const rawAmount = amountMatch[1].replace(/[^0-9.,-]/g, '');
    const amount = Number(rawAmount.replace(',', ''));

    if (Number.isNaN(amount)) {
      return null;
    }

    const cleanVendor = vendorMatch[1].replace(EMOJI_PATTERN, '').trim();
    const vendor = formatVendorName(cleanVendor);
    return { vendor, amount };
  } catch {
    return null;
  }
}

/**
 * Get an existing active notification rule for (user, bank_app_id).
 * Returns the first rule whose keyword filter matches the notification,
 * or null if no matching rule is found.
 */
export async function getActiveRule(
  userId: string,
  bankAppId: string,
  notificationText?: string,
): Promise<NotificationRuleRow | null> {
  const { data, error } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('bank_app_id', bankAppId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getActiveRule] Error:', error);
    return null;
  }

  if (!data || data.length === 0) return null;

  const rules = data as NotificationRuleRow[];

  // If no notification text provided, return the first rule (backward compat)
  if (!notificationText) {
    return rules[0];
  }

  // Find the first rule whose keyword filter matches
  for (const rule of rules) {
    const keywords = rule.filter_keywords || parseOnlyParseKeywords(rule.only_parse);
    const mode = rule.filter_mode || 'one';
    if (matchesKeywordFilter(notificationText, keywords, mode)) {
      return rule;
    }
  }

  return null;
}

/**
 * Get all active notification rules for (user, bank_app_id).
 */
export async function getActiveRulesForBank(
  userId: string,
  bankAppId: string,
): Promise<NotificationRuleRow[]> {
  const { data, error } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('bank_app_id', bankAppId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getActiveRulesForBank] Error:', error);
    return [];
  }

  return (data || []) as NotificationRuleRow[];
}

/**
 * Check if a notification is ignored by keyword filters.
 * Returns true if there ARE rules for this bank but NONE of them
 * match the notification text (i.e., the notification should be ignored).
 * Returns false if there are no rules or at least one rule matches.
 */
export async function isKeywordIgnored(
  userId: string,
  bankAppId: string,
  notificationText: string,
): Promise<boolean> {
  const rules = await getActiveRulesForBank(userId, bankAppId);

  // No rules at all → not ignored (it's unconfigured)
  if (rules.length === 0) return false;

  // Check if any rule has keywords configured
  const rulesWithKeywords = rules.filter(
    (r) => (r.filter_keywords && r.filter_keywords.length > 0) || (r.only_parse && r.only_parse.trim()),
  );

  // No rules have keywords → not ignored
  if (rulesWithKeywords.length === 0) return false;

  // If any rule with keywords matches, not ignored
  for (const rule of rulesWithKeywords) {
    const keywords = rule.filter_keywords || parseOnlyParseKeywords(rule.only_parse);
    if (matchesKeywordFilter(notificationText, keywords, rule.filter_mode || 'one')) {
      return false;
    }
  }

  // All keyword-configured rules failed → ignored
  return true;
}

// ─── Step 3: Ignore Rule Check ──────────────────────────────────

/**
 * Check if this notification should be ignored based on user's
 * ignored_transactions rules.
 */
async function shouldIgnore(
  userId: string,
  vendor: string,
  amount: number | null,
  bankAppId: string,
): Promise<boolean> {
  const { data: rules, error } = await supabase
    .from('ignored_transactions')
    .select('*')
    .eq('user_id', userId)
    .ilike('vendor_name', vendor);

  if (error) {
    console.error('[shouldIgnore] Error fetching ignore rules:', error);
    return false;
  }

  if (!rules || rules.length === 0) {
    return false;
  }

  const now = new Date();

  for (const rule of rules) {
    if (rule.expires_at && new Date(rule.expires_at) < now) {
      continue;
    }
    if (rule.bank_app_id && rule.bank_app_id !== bankAppId) {
      continue;
    }
    if (rule.amount != null && amount != null) {
      if (Math.abs(rule.amount - amount) > AMOUNT_TOLERANCE) {
        continue;
      }
    }
    return true;
  }

  return false;
}

// ─── Step 4: Pending Transaction Insert ─────────────────────────

/**
 * Insert a parsed notification into pending_transactions.
 *
 * Before inserting, checks whether a pending transaction with the same
 * extracted_amount and notification_timestamp already exists for this
 * user.  This acts as a second safety net in case the fingerprint dedup
 * didn't catch a repeat.  If both fields match, the notification is
 * considered a duplicate and the insert is skipped.
 */
async function insertPendingTransaction(
  userId: string,
  input: NotificationInput,
  vendor: string,
  amount: number,
  needsReview: boolean,
  ruleId?: string,
  validationReasons?: string,
): Promise<PendingTransaction | null> {
  const notifTimestamp = input.notificationTimestamp || Date.now();

  // ── Guard: skip if an identical pending transaction already exists ──
  // Matches on extracted_amount + notification_timestamp to prevent
  // inserting duplicates of the same notification.
  const { data: existing } = await supabase
    .from('pending_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('extracted_amount', amount)
    .eq('notification_timestamp', notifTimestamp)
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log('[insertPending] Duplicate pending transaction detected, skipping insert');
    return null;
  }

  const now = new Date();

  const record = {
    user_id: userId,
    app_package: input.bankAppId,
    app_name: input.bankName,
    notification_title: input.notificationTitle || input.bankName,
    notification_text: input.rawNotification,
    notification_timestamp: notifTimestamp,
    posted_at: now.toISOString(),
    extracted_vendor: vendor,
    extracted_amount: amount,
    extracted_timestamp: now.toISOString(),
    confidence: ruleId ? 100 : 0,
    validation_reasons: validationReasons || (ruleId ? 'OK' : 'No rule configured'),
    needs_review: needsReview,
    pattern_id: ruleId || null,
  };

  const { data, error } = await supabase
    .from('pending_transactions')
    .insert(record)
    .select()
    .single();

  if (error) {
    console.error('[insertPending] Error:', error);
    return null;
  }

  return data as PendingTransaction;
}

// ─── Duplicate Detection Against Existing Transactions ──────────

interface DuplicateCheckResult {
  /** Whether a duplicate was found that should block a new transaction */
  isDuplicate: boolean;
  /** Reason for rejection, if any */
  reason?: string;
  /** If a recurring transaction's date was updated, this is its ID */
  updatedExistingId?: string;
}

/**
 * Check if a pending transaction duplicates an existing transaction.
 *
 * Two rules:
 *   1. Recurring (Monthly/Biweekly): same vendor + amount within ±3 days
 *      → update the existing transaction's date to today and return it.
 *   2. One-time: same vendor + amount + exact same day
 *      → reject as duplicate.
 */
export async function checkDuplicateTransaction(
  userId: string,
  pending: PendingTransaction,
): Promise<DuplicateCheckResult> {
  const vendor = formatVendorName(pending.extracted_vendor);
  const amount = Number(pending.extracted_amount);
  const today = new Date().toISOString().slice(0, 10);

  // Fetch existing transactions for this vendor and approximate amount
  const { data: existing, error } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date, recurrence')
    .eq('user_id', userId)
    .ilike('vendor', vendor);

  if (error) {
    console.error('[checkDuplicate] Error fetching transactions:', error);
    return { isDuplicate: false };
  }

  if (!existing || existing.length === 0) {
    return { isDuplicate: false };
  }

  // Filter to matching amounts
  const amountMatches = existing.filter(
    (tx) => Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE,
  );

  if (amountMatches.length === 0) {
    return { isDuplicate: false };
  }

  // Rule 1: Recurring transactions (Monthly/Biweekly) — same vendor + amount within ±3 days
  const todayMs = new Date(today).getTime();
  const toleranceMs = RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY;

  for (const tx of amountMatches) {
    const recurrence = (tx.recurrence || '').toLowerCase();
    if (recurrence !== 'monthly' && recurrence !== 'biweekly') continue;

    const txDateMs = new Date(tx.date).getTime();
    if (Math.abs(todayMs - txDateMs) <= toleranceMs) {
      // Update the existing recurring transaction's date to today
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ date: today })
        .eq('id', tx.id);

      if (updateError) {
        console.error('[checkDuplicate] Error updating recurring tx date:', updateError);
        // Still treat as duplicate even if update fails
      } else {
        console.log(`[checkDuplicate] Updated recurring transaction ${tx.id} date to ${today}`);
      }

      return { isDuplicate: false, updatedExistingId: tx.id };
    }
  }

  // Rule 2: One-time transactions — same vendor + amount + exact same day
  for (const tx of amountMatches) {
    if (tx.date === today) {
      return {
        isDuplicate: true,
        reason: 'Duplicate transaction found in manually recorded transactions',
      };
    }
  }

  return { isDuplicate: false };
}

// ─── Step 5: Auto-Approve Logic ─────────────────────────────────

/**
 * Check if a pending transaction can be auto-approved.
 * Auto-approve requires:
 *   - Vendor has a category via vendor_overrides
 *   - No duplicate transaction today with same vendor+amount
 *   - The rule's auto-approve is conceptually enabled (flagged_count = 0 means no issues)
 */
async function tryAutoApprove(
  userId: string,
  pending: PendingTransaction,
  defaultCategoryId: string | null,
): Promise<{ accepted: boolean; transactionId?: string; categoryId?: string }> {
  // Look up category: vendor override > rule default > none
  let categoryId = defaultCategoryId;
  let autoAcceptEnabled = false;

  const { data: override } = await (async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=ilike.${encodeURIComponent(pending.extracted_vendor)}&limit=1`,
        { headers },
      );
      if (!res.ok) return { data: null };
      const rows = await res.json();
      return { data: Array.isArray(rows) && rows.length > 0 ? rows[0] : null };
    } catch {
      return { data: null };
    }
  })();

  if (override) {
    categoryId = override.category_id;
    autoAcceptEnabled = override.auto_accept === true;
  }

  // Can't auto-approve without a category
  if (!categoryId) {
    return { accepted: false };
  }

  // Only auto-approve if auto_accept is toggled on for this vendor
  if (!autoAcceptEnabled) {
    return { accepted: false };
  }

  // Check for duplicate against existing transactions
  const dupResult = await checkDuplicateTransaction(userId, pending);

  if (dupResult.isDuplicate) {
    // Mark as rejected with reason
    await supabase
      .from('pending_transactions')
      .update({
        needs_review: false,
        reviewed_at: new Date().toISOString(),
        approved: false,
        rejection_reason: dupResult.reason,
      })
      .eq('id', pending.id);
    console.log(`[autoApprove] Duplicate detected: ${dupResult.reason}`);
    return { accepted: false };
  }

  if (dupResult.updatedExistingId) {
    // Recurring transaction date was updated — no new transaction needed
    await supabase
      .from('pending_transactions')
      .update({
        needs_review: false,
        reviewed_at: new Date().toISOString(),
        approved: true,
      })
      .eq('id', pending.id);
    console.log(`[autoApprove] Updated recurring transaction ${dupResult.updatedExistingId} date`);
    return { accepted: true, transactionId: dupResult.updatedExistingId, categoryId };
  }

  // Insert into transactions
  const transactionId = crypto.randomUUID();
  const { error: txError } = await supabase
    .from('transactions')
    .insert({
      id: transactionId,
      user_id: userId,
      vendor: formatVendorName(pending.extracted_vendor),
      amount: pending.extracted_amount,
      date: new Date().toISOString().slice(0, 10),
      category_id: categoryId,
      recurrence: 'One-time',
      label: 'Auto-Added',
      is_projected: false,
    });

  if (txError) {
    console.error('[autoApprove] Error inserting transaction:', txError);
    return { accepted: false };
  }

  // Mark pending as reviewed + approved
  await supabase
    .from('pending_transactions')
    .update({
      needs_review: false,
      reviewed_at: new Date().toISOString(),
      approved: true,
    })
    .eq('id', pending.id);

  return { accepted: true, transactionId, categoryId };
}

// ─── Main Pipeline ──────────────────────────────────────────────

/**
 * Process an incoming bank notification through the manual pipeline.
 *
 * Steps:
 *   1. Fingerprint deduplication
 *   2. Look up notification rule for the bank
 *   3. If no rule → store as unconfigured capture (needs manual setup)
 *   4. Apply regex → no match = ignored, match = extract vendor/amount
 *   5. Ignore rule check
 *   6. Insert pending transaction
 *   7. Auto-approve if vendor has category assigned
 */
export async function processNotification(
  userId: string,
  input: NotificationInput,
): Promise<ProcessingResult> {
  // Normalize bank identifiers to lowercase for case-insensitive matching
  input = { ...input, bankAppId: (input.bankAppId || '').toLowerCase(), bankName: (input.bankName || '').toLowerCase() };

  // ── Step 1: Fingerprint Deduplication ──
  // Extract a quick amount from the raw text for fingerprinting.
  // Require a leading '$' so stray numbers (e.g. "13h" time prefixes) are
  // not mistaken for dollar amounts.
  let quickAmount: number | null = null;
  const quickAmountMatch = input.rawNotification.match(/\$([\d,]+\.?\d{0,2})/);
  if (quickAmountMatch) {
    quickAmount = parseFloat(quickAmountMatch[1].replace(',', ''));
  }

  // Use the notification's original post time (from Android) for a stable
  // fingerprint. Falls back to Date.now() only on non-native platforms.
  const notifTimestamp = input.notificationTimestamp || Date.now();

  const isDuplicate = await checkAndInsertFingerprint(
    userId,
    input.bankAppId,
    quickAmount,
    input.fallbackVendor || input.rawNotification,
    notifTimestamp,
  );

  if (isDuplicate) {
    console.log('[processNotification] Duplicate fingerprint, skipping');
    return { processed: false, skipReason: 'duplicate' };
  }

  // ── Step 2: Look up notification rule ──
  // First check if the notification is ignored by keyword filters
  const keywordIgnored = await isKeywordIgnored(userId, input.bankAppId, input.rawNotification);

  if (keywordIgnored) {
    // Store as keyword-ignored so it shows in the "Ignored Notifications" card
    console.log('[processNotification] Notification ignored by keyword filter');
    const pending = await insertPendingTransaction(
      userId,
      input,
      input.fallbackVendor || 'Unknown',
      input.fallbackAmount ?? 0,
      true,
      KEYWORD_IGNORED_PATTERN_ID,
      'Ignored by keyword filter',
    );

    return {
      processed: true,
      skipReason: 'ignored',
      pendingTransaction: pending || undefined,
    };
  }

  const rule = await getActiveRule(userId, input.bankAppId, input.rawNotification);

  if (!rule) {
    // No rule configured for this bank — store as unconfigured capture
    // so the user can see it and set up a regex rule
    const pending = await insertPendingTransaction(
      userId,
      input,
      input.fallbackVendor || 'Unknown',
      input.fallbackAmount ?? 0,
      true,
      undefined,
      'No rule configured',
    );

    return {
      processed: true,
      skipReason: 'no_rule',
      pendingTransaction: pending || undefined,
    };
  }

  // ── Step 3: Apply regex ──
  const parsed = applyRuleToNotification(
    rule.amount_regex,
    rule.vendor_regex,
    input.rawNotification,
  );

  if (!parsed) {
    // Regex didn't match — store as pending with fallback data so the user
    // can see the notification and adjust their rule if needed.
    // Include the rule.id so the UI knows a rule exists (avoids "needs setup").
    console.log('[processNotification] Regex did not match, storing with fallback data');
    const pending = await insertPendingTransaction(
      userId,
      input,
      input.fallbackVendor || 'Unknown',
      input.fallbackAmount ?? 0,
      true,
      rule.id,
      'Regex did not match notification format',
    );

    return {
      processed: true,
      skipReason: 'no_match',
      pendingTransaction: pending || undefined,
    };
  }

  // ── Step 4: Ignore rule check ──
  const ignored = await shouldIgnore(userId, parsed.vendor, parsed.amount, input.bankAppId);

  if (ignored) {
    console.log('[processNotification] Notification ignored by user rule');
    return { processed: false, skipReason: 'ignored' };
  }

  // ── Step 5: Insert pending transaction ──
  const pending = await insertPendingTransaction(
    userId,
    input,
    parsed.vendor,
    parsed.amount,
    true, // needs review by default
    rule.id,
    'OK',
  );

  if (!pending) {
    return { processed: true };
  }

  // ── Step 6: Auto-approve if vendor has category ──
  const autoResult = await tryAutoApprove(
    userId,
    pending,
    rule.default_category_id,
  );

  return {
    processed: true,
    pendingTransaction: pending,
    autoAccepted: autoResult.accepted,
    transactionId: autoResult.transactionId,
    categoryId: autoResult.categoryId,
  };
}

// ─── Rule Management (for manual setup UI) ──────────────────────

/** Pattern to match emoji characters for stripping from regex anchors */
const EMOJI_PATTERN = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;

/** How many characters of surrounding text to consider when building anchors */
const CONTEXT_WINDOW = 40;

/** Strip emoji and split `text` into non-empty words. */
function anchorWords(text: string): string[] {
  return text.replace(EMOJI_PATTERN, '').trim().split(/\s+/).filter(Boolean);
}

/**
 * Extract up to `maxWords` words from the END of `text`, stripping emoji.
 */
function cleanAnchorEnd(text: string, maxWords = 3): string {
  const words = anchorWords(text);
  return (words.length > maxWords ? words.slice(-maxWords) : words).join(' ');
}

/**
 * Extract up to `maxWords` words from the START of `text`, stripping emoji.
 */
function cleanAnchorStart(text: string, maxWords = 3): string {
  const words = anchorWords(text);
  return (words.length > maxWords ? words.slice(0, maxWords) : words).join(' ');
}

/**
 * Build regex patterns from a user's manual text selection.
 *
 * Given a notification text and the selected vendor/amount substrings,
 * generates regex patterns that capture those values using the
 * structural text BETWEEN and AROUND the two selections as anchors.
 *
 * Key design decisions:
 *   - Uses a non-greedy vendor capture (.+?) to avoid over-consuming.
 *   - Uses only the FIRST word of the between-text as the vendor
 *     stop-anchor.  This keeps the pattern general enough to handle
 *     different transaction types from the same bank (e.g. "You spent"
 *     vs "You made a recurring payment for" both share "You").
 *   - For the amount, skips the between-text anchor entirely and
 *     relies on the text AFTER the amount (e.g. "with your credit").
 *   - Strips emoji from anchor text so patterns don't break when
 *     the bank app uses different emoji per category.
 */
export function buildRegexFromSelection(
  notificationText: string,
  selectedVendor: string,
  selectedAmount: string,
): { vendorRegex: string; amountRegex: string } {
  const vendorIdx = notificationText.indexOf(selectedVendor);
  const amountIdx = notificationText.indexOf(selectedAmount);

  if (vendorIdx === -1 || amountIdx === -1) {
    // Fallback: generic patterns
    return {
      amountRegex: '\\$?([\\d,]+\\.\\d{2})',
      vendorRegex: `(${escapeRegex(selectedVendor)})`,
    };
  }

  const vendorEnd = vendorIdx + selectedVendor.length;
  const amountEnd = amountIdx + selectedAmount.length;

  const amountCapture = '\\$?([\\d,]+\\.\\d{2})';
  // Non-greedy: stops at the first anchor match to avoid over-consuming
  const vendorCapture = '(.+?)';

  let amountRegex: string;
  let vendorRegex: string;

  if (vendorIdx < amountIdx) {
    // Layout: [beforeVendor] VENDOR [between] AMOUNT [afterAmount]
    const beforeVendor = notificationText.slice(Math.max(0, vendorIdx - CONTEXT_WINDOW), vendorIdx);
    const between = notificationText.slice(vendorEnd, amountIdx);
    const afterAmount = notificationText.slice(amountEnd, Math.min(notificationText.length, amountEnd + CONTEXT_WINDOW));

    const beforeVendorAnchor = cleanAnchorEnd(beforeVendor);
    const betweenClean = between.replace(EMOJI_PATTERN, '').trim();
    const afterAmountAnchor = cleanAnchorStart(afterAmount);
    const betweenWords = betweenClean.split(/\s+/).filter(Boolean);

    // Vendor regex: use first word of between-text as stop-anchor
    const vBefore = beforeVendorAnchor ? escapeRegex(beforeVendorAnchor) + '\\s*' : '';
    const vAfter = betweenWords.length > 0
      ? '\\s*' + escapeRegex(betweenWords[0])
      : '';
    vendorRegex = vBefore + vendorCapture + vAfter;

    // Amount regex: skip between-text, rely on after-amount anchor
    const aAfter = afterAmountAnchor ? '\\s*' + escapeRegex(afterAmountAnchor) : '';
    amountRegex = amountCapture + aAfter;
  } else {
    // Layout: [beforeAmount] AMOUNT [between] VENDOR [afterVendor]
    const beforeAmount = notificationText.slice(Math.max(0, amountIdx - CONTEXT_WINDOW), amountIdx);
    const between = notificationText.slice(amountEnd, vendorIdx);
    const afterVendor = notificationText.slice(vendorEnd, Math.min(notificationText.length, vendorEnd + CONTEXT_WINDOW));

    const beforeAmountAnchor = cleanAnchorEnd(beforeAmount);
    const betweenClean = between.replace(EMOJI_PATTERN, '').trim();
    const afterVendorAnchor = cleanAnchorStart(afterVendor);
    const betweenWords = betweenClean.split(/\s+/).filter(Boolean);

    // Amount regex: use before-amount text + first word of between
    const aBefore = beforeAmountAnchor ? escapeRegex(beforeAmountAnchor) + '\\s*' : '';
    const aAfter = betweenWords.length > 0
      ? '\\s*' + escapeRegex(betweenWords[0])
      : '';
    amountRegex = aBefore + amountCapture + aAfter;

    // Vendor regex: use last word of between + after-vendor text
    const vBefore = betweenWords.length > 0
      ? escapeRegex(betweenWords[betweenWords.length - 1]) + '\\s*'
      : '';
    const vAfter = afterVendorAnchor ? '\\s*' + escapeRegex(afterVendorAnchor) : '';
    vendorRegex = vBefore + vendorCapture + vAfter;
  }

  return { vendorRegex, amountRegex };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Save a manually-created notification rule.
 */
export async function saveNotificationRule(options: {
  userId: string;
  bankAppId: string;
  bankName: string;
  amountRegex: string;
  vendorRegex: string;
  sampleNotification: string;
  onlyParse?: string;
  filterKeywords?: string[];
  filterMode?: 'all' | 'some' | 'one';
  notificationType?: string;
}): Promise<NotificationRuleRow | null> {
  const {
    userId,
    bankAppId: rawBankAppId,
    bankName: rawBankName,
    amountRegex,
    vendorRegex,
    onlyParse = '',
    filterKeywords,
    filterMode = 'one',
    notificationType = 'default',
  } = options;
  const bankAppId = (rawBankAppId || '').toLowerCase();
  const bankName = (rawBankName || '').toLowerCase();

  // Derive filter_keywords from only_parse text field
  const derivedKeywords = filterKeywords ?? parseOnlyParseKeywords(onlyParse);

  // Validate regex syntax
  try {
    new RegExp(amountRegex);
    new RegExp(vendorRegex);
  } catch {
    console.error('[saveNotificationRule] Invalid regex syntax');
    return null;
  }

  // Check if an active rule already exists for this bank + notification type
  const { data: existingData } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('bank_app_id', bankAppId)
    .eq('notification_type', notificationType)
    .eq('is_active', true)
    .maybeSingle();

  const existing = existingData as NotificationRuleRow | null;

  if (existing) {
    // Update existing rule — preserve only_parse / filter_keywords when
    // the caller didn't supply them (avoids wiping saved keywords).
    const effectiveOnlyParse = onlyParse || existing.only_parse || '';
    const effectiveKeywords = filterKeywords ?? parseOnlyParseKeywords(effectiveOnlyParse);
    const effectiveFilterMode = options.filterMode ?? existing.filter_mode ?? 'one';

    const { data, error } = await supabase
      .from('notification_rules')
      .update({
        amount_regex: amountRegex,
        vendor_regex: vendorRegex,
        only_parse: effectiveOnlyParse,
        filter_keywords: effectiveKeywords,
        filter_mode: effectiveFilterMode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error('[saveNotificationRule] Error updating rule:', error);
      return null;
    }
    return data as NotificationRuleRow;
  }

  // Insert new rule
  const { data, error } = await supabase
    .from('notification_rules')
    .insert({
      user_id: userId,
      bank_app_id: bankAppId,
      bank_name: bankName,
      amount_regex: amountRegex,
      vendor_regex: vendorRegex,
      only_parse: onlyParse,
      filter_keywords: derivedKeywords,
      filter_mode: filterMode,
      notification_type: notificationType,
    })
    .select()
    .single();

  if (error) {
    console.error('[saveNotificationRule] Error inserting rule:', error);
    return null;
  }

  return data as NotificationRuleRow;
}

/**
 * Re-process all unconfigured captures for a bank after a rule is created.
 * This takes existing pending_transactions with no pattern_id and tries
 * to apply the newly created rule.
 */
export async function reprocessUnconfiguredCaptures(
  userId: string,
  bankAppId: string,
  rule: NotificationRuleRow,
): Promise<void> {
  const normalizedBankAppId = bankAppId.toLowerCase();
  // Get all unconfigured captures for this bank
  const { data: captures, error } = await supabase
    .from('pending_transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('app_package', normalizedBankAppId)
    .is('pattern_id', null)
    .eq('needs_review', true);

  if (error || !captures) {
    console.error('[reprocess] Error fetching unconfigured captures:', error);
    return;
  }

  for (const capture of captures) {
    const parsed = applyRuleToNotification(
      rule.amount_regex,
      rule.vendor_regex,
      capture.notification_text,
    );

    if (parsed) {
      // Update the capture with extracted data
      await supabase
        .from('pending_transactions')
        .update({
          extracted_vendor: parsed.vendor,
          extracted_amount: parsed.amount,
          pattern_id: rule.id,
          confidence: 100,
          validation_reasons: 'OK',
        })
        .eq('id', capture.id);
    } else {
      // Doesn't match — link to the rule so the UI knows a rule exists,
      // but keep needs_review true so the user can still see it.
      await supabase
        .from('pending_transactions')
        .update({
          pattern_id: rule.id,
          validation_reasons: 'Regex did not match notification format',
        })
        .eq('id', capture.id);
    }
  }
}

/**
 * Update keyword filter settings for an existing notification rule.
 * Accepts the `onlyParse` text field, derives `filter_keywords` from it.
 */
export async function updateRuleKeywordFilter(
  ruleId: string,
  userId: string,
  onlyParse: string,
  filterMode: 'all' | 'some' | 'one',
): Promise<boolean> {
  const filterKeywords = parseOnlyParseKeywords(onlyParse);
  const { data, error } = await supabase
    .from('notification_rules')
    .update({
      only_parse: onlyParse,
      filter_keywords: filterKeywords,
      filter_mode: filterMode,
      updated_at: new Date().toISOString(),
    })
    .eq('id', ruleId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('[updateRuleKeywordFilter] Error:', error);
    return false;
  }
  if (!data) {
    console.error('[updateRuleKeywordFilter] No rows updated for rule', ruleId);
    return false;
  }
  return true;
}

// ─── AI Processing Pipeline ─────────────────────────────────────

export interface AIProcessingResult {
  /** Whether the notification was processed */
  processed: boolean;
  /** Whether the AI determined this is a real transaction */
  isTransaction: boolean;
  /** The transaction ID if inserted into the transactions table */
  transactionId?: string;
  /** The vendor name extracted by AI */
  vendor?: string;
  /** The amount extracted by AI */
  amount?: number;
  /** The category ID assigned */
  categoryId?: string;
  /** The category name assigned */
  categoryName?: string;
  /** Reason for rejection if not a transaction or duplicate */
  rejectionReason?: string;
  /** Skip reason */
  skipReason?: 'duplicate_fingerprint' | 'duplicate_vendor_amount' | 'not_transaction' | 'extraction_failed';
  /** The bank name */
  bankName?: string;
}

/**
 * Store a rejected notification in pending_transactions so it appears
 * in the rejected card on the Transaction Parsing screen.
 *
 * Note: extracted_vendor defaults to 'Unknown' and extracted_amount to 0
 * when values are unavailable because the DB columns are NOT NULL.
 */
async function storeRejectedNotification(
  userId: string,
  input: NotificationInput,
  notifTimestamp: number,
  vendor: string | null,
  amount: number | null,
  rejectionReason: string,
): Promise<void> {
  try {
    const now = new Date();
    await supabase.from('pending_transactions').insert({
      user_id: userId,
      app_package: input.bankAppId,
      app_name: input.bankName,
      notification_title: input.notificationTitle || input.bankName,
      notification_text: input.rawNotification,
      notification_timestamp: notifTimestamp,
      posted_at: now.toISOString(),
      extracted_vendor: vendor || 'Unknown',
      extracted_amount: amount ?? 0,
      extracted_timestamp: now.toISOString(),
      confidence: 0,
      validation_reasons: rejectionReason,
      needs_review: false,
      approved: false,
      rejection_reason: rejectionReason,
    });
  } catch (err) {
    console.warn('[AI pipeline] Failed to store rejected notification:', err);
  }
}

/**
 * Process a notification using the AI pipeline.
 *
 * Steps:
 *   1. Fingerprint deduplication
 *   2. AI extraction (vendor, amount, transaction classification)
 *   3. Reject non-transactions (stored in pending_transactions as rejected)
 *   4. Duplicate detection (same vendor + amount pair in existing transactions)
 *   5. Category assignment: vendor_overrides first, then AI suggestion
 *   6. Insert directly into transactions table with 'AI' label
 */
export async function processNotificationWithAI(
  userId: string,
  input: NotificationInput,
  availableCategories: { id: string; name: string }[],
): Promise<AIProcessingResult> {
  // Normalize bank identifiers
  input = {
    ...input,
    bankAppId: (input.bankAppId || '').toLowerCase(),
    bankName: (input.bankName || '').toLowerCase(),
  };

  // ── Step 1: Fingerprint Deduplication ──
  // Require a leading '$' so stray numbers (e.g. "13h" time prefixes) are
  // not mistaken for dollar amounts.
  let quickAmount: number | null = null;
  const quickAmountMatch = input.rawNotification.match(/\$([\d,]+\.?\d{0,2})/);
  if (quickAmountMatch) {
    quickAmount = parseFloat(quickAmountMatch[1].replace(',', ''));
  }

  const notifTimestamp = input.notificationTimestamp || Date.now();
  const isDuplicate = await checkAndInsertFingerprint(
    userId,
    input.bankAppId,
    quickAmount,
    input.fallbackVendor || input.rawNotification,
    notifTimestamp,
  );

  if (isDuplicate) {
    console.log('[AI pipeline] Duplicate fingerprint, skipping');
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'duplicate_fingerprint',
      rejectionReason: 'Duplicate notification (already processed)',
      bankName: input.bankName,
    };
  }

  // ── Step 2: AI Extraction ──
  const categoryNames = availableCategories.map(c => c.name);
  const aiResult = await extractWithAI(input.rawNotification, categoryNames);

  if (!aiResult.vendor && !aiResult.amount) {
    console.log('[AI pipeline] AI could not extract data');
    const reason = aiResult.rejectionReason || 'Could not extract transaction data';
    // Store as rejected so it appears in the rejected card
    await storeRejectedNotification(userId, input, notifTimestamp, null, null, reason);
    return {
      processed: true,
      isTransaction: false,
      skipReason: 'extraction_failed',
      rejectionReason: reason,
      bankName: input.bankName,
    };
  }

  // ── Step 3: Reject non-transactions ──
  if (!aiResult.isTransaction) {
    console.log('[AI pipeline] Not a transaction:', aiResult.rejectionReason);
    const reason = aiResult.rejectionReason || 'Not a purchase or charge';
    // Store as rejected so it appears in the rejected card
    await storeRejectedNotification(
      userId, input, notifTimestamp,
      aiResult.vendor || null, aiResult.amount || null, reason,
    );
    return {
      processed: true,
      isTransaction: false,
      vendor: aiResult.vendor || undefined,
      amount: aiResult.amount || undefined,
      skipReason: 'not_transaction',
      rejectionReason: reason,
      bankName: input.bankName,
    };
  }

  const vendor = aiResult.vendor || input.fallbackVendor || 'Unknown';
  const amount = aiResult.amount ?? input.fallbackAmount ?? 0;

  // ── Step 4: Duplicate detection (vendor + amount pair) ──
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date')
    .eq('user_id', userId)
    .ilike('vendor', vendor);

  if (existingTx && existingTx.length > 0) {
    const duplicateToday = existingTx.find(
      (tx) =>
        Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE &&
        tx.date === today,
    );

    if (duplicateToday) {
      console.log('[AI pipeline] Duplicate vendor+amount found for today');
      const reason = `Duplicate: ${vendor} for $${amount.toFixed(2)} already recorded today`;
      // Store as rejected so it appears in the rejected card
      await storeRejectedNotification(userId, input, notifTimestamp, vendor, amount, reason);
      return {
        processed: true,
        isTransaction: true,
        vendor,
        amount,
        skipReason: 'duplicate_vendor_amount',
        rejectionReason: reason,
        bankName: input.bankName,
      };
    }
  }

  // ── Step 5: Category assignment ──
  let categoryId: string | null = null;
  let categoryName: string | null = null;

  // First check vendor_overrides
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=ilike.${encodeURIComponent(vendor)}&limit=1`,
      { headers },
    );
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        categoryId = rows[0].category_id;
        const matchedCat = availableCategories.find(c => c.id === categoryId);
        categoryName = matchedCat?.name || null;
        console.log(`[AI pipeline] Vendor override found: ${vendor} → ${categoryName}`);
      }
    }
  } catch (err) {
    console.warn('[AI pipeline] Error checking vendor overrides:', err);
  }

  // If no vendor override, use AI suggestion
  if (!categoryId && aiResult.suggestedCategory) {
    const matchedCat = availableCategories.find(
      c => c.name.toLowerCase() === aiResult.suggestedCategory!.toLowerCase(),
    );
    if (matchedCat) {
      categoryId = matchedCat.id;
      categoryName = matchedCat.name;
      console.log(`[AI pipeline] AI suggested category: ${categoryName}`);
    }
  }

  // Fallback to first available category if neither found one
  if (!categoryId && availableCategories.length > 0) {
    // Try to find "Other" category first
    const otherCat = availableCategories.find(
      c => c.name.toLowerCase() === 'other',
    );
    if (otherCat) {
      categoryId = otherCat.id;
      categoryName = otherCat.name;
    } else {
      categoryId = availableCategories[0].id;
      categoryName = availableCategories[0].name;
    }
    console.log(`[AI pipeline] Fallback category: ${categoryName}`);
  }

  if (!categoryId) {
    console.error('[AI pipeline] No category available for transaction');
    return {
      processed: true,
      isTransaction: true,
      vendor,
      amount,
      rejectionReason: 'No budget category available',
      bankName: input.bankName,
    };
  }

  // ── Step 6: Insert transaction with 'AI' label ──
  const transactionId = crypto.randomUUID();
  const { error: txError } = await supabase
    .from('transactions')
    .insert({
      id: transactionId,
      user_id: userId,
      vendor: formatVendorName(vendor),
      amount,
      date: today,
      category_id: categoryId,
      recurrence: 'One-time',
      label: 'AI',
      is_projected: false,
    });

  if (txError) {
    console.error('[AI pipeline] Error inserting transaction:', txError);
    return {
      processed: true,
      isTransaction: true,
      vendor,
      amount,
      rejectionReason: 'Failed to save transaction',
      bankName: input.bankName,
    };
  }

  // Also save/update vendor_override for future categorization
  try {
    const headers = await getAuthHeaders();
    (headers as any)['Prefer'] = 'return=representation';

    // Try to update existing override first
    const patchRes = await fetch(
      `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=eq.${encodeURIComponent(formatVendorName(vendor))}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ category_id: categoryId }),
      },
    );
    const patchBody = await patchRes.text();
    let patchedRows: any[] = [];
    try { patchedRows = patchBody ? JSON.parse(patchBody) : []; } catch (e) { console.warn('[AI pipeline] vendor_override PATCH parse error:', e); patchedRows = []; }

    if (!patchRes.ok || !Array.isArray(patchedRows) || patchedRows.length === 0) {
      // Insert new override
      await fetch(`${REST_BASE}/vendor_overrides`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_id: userId,
          vendor_name: formatVendorName(vendor),
          category_id: categoryId,
        }),
      });
    }
  } catch (err) {
    console.warn('[AI pipeline] vendor_override save failed:', err);
  }

  console.log(`[AI pipeline] Transaction saved: ${vendor} $${amount} → ${categoryName}`);

  return {
    processed: true,
    isTransaction: true,
    transactionId,
    vendor: formatVendorName(vendor),
    amount,
    categoryId,
    categoryName: categoryName || undefined,
    bankName: input.bankName,
  };
}
