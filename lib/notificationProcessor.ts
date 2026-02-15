// lib/notificationProcessor.ts
//
// Notification processing pipeline (AI-powered extraction).
// Uses a local AI model (Transformers.js) to automatically extract
// vendor names and amounts from bank notifications — no manual regex setup.
//
// Pipeline:
//   1. Fingerprint deduplication
//   2. AI-based extraction of vendor + amount
//      - If extraction fails → store with fallback data for review
//   3. Keyword filtering (if configured)
//   4. Ignore rule check (user-defined vendor ignores)
//   5. Insert pending transaction
//   6. Auto-approve if vendor has a category and auto_approve is enabled

import { supabase } from './supabase';
import { REST_BASE, getAuthHeaders } from './apiHelpers';
import { formatVendorName } from './formatVendorName';
import { getTransactionModel } from './localTransactionModel';
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

interface NotificationRuleRow {
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
const KEYWORD_IGNORED_PATTERN_ID = 'keyword-ignored';

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

// ─── Step 2: Keyword Filtering ──────────────────────────────────

/**
 * Get all active notification rules for (user, bank_app_id).
 * Used internally by keyword filtering.
 */
async function getActiveRulesForBank(
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
async function isKeywordIgnored(
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

// ─── Main Pipeline ──────────────────────────────────────────────

/**
 * Process an incoming bank notification through the AI-powered pipeline.
 * All valid transactions are automatically approved — no manual review needed.
 *
 * Steps:
 *   1. Fingerprint deduplication
 *   2. Keyword filtering (if rules with keywords exist for this bank)
 *   3. AI-based extraction of vendor + amount
 *   4. Ignore rule check
 *   5. Duplicate detection against existing transactions
 *   6. Auto-approve: insert transaction + create vendor override
 */
export async function processNotification(
  userId: string,
  input: NotificationInput,
): Promise<ProcessingResult> {
  // Normalize bank identifiers to lowercase for case-insensitive matching
  input = { ...input, bankAppId: (input.bankAppId || '').toLowerCase(), bankName: (input.bankName || '').toLowerCase() };

  // ── Step 1: Fingerprint Deduplication ──
  // Extract a quick amount from the raw text for fingerprinting
  let quickAmount: number | null = null;
  const quickAmountMatch = input.rawNotification.match(/\$?([\d,]+\.?\d{0,2})/);
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

  // ── Step 2: Keyword filtering (if configured) ──
  const keywordIgnored = await isKeywordIgnored(userId, input.bankAppId, input.rawNotification);

  if (keywordIgnored) {
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

  // ── Step 3: AI-based extraction of vendor + amount ──
  const model = getTransactionModel();
  await model.initialize();
  const aiResult = await model.extractTransaction(input.rawNotification);

  let vendor: string;
  let amount: number;
  let suggestedCategory: string | null = null;

  if (aiResult.success && aiResult.data) {
    vendor = aiResult.data.vendor;
    amount = aiResult.data.amount;
    suggestedCategory = aiResult.data.suggestedCategory;
  } else if (input.fallbackVendor && input.fallbackAmount != null && input.fallbackAmount > 0) {
    // AI extraction failed but we have fallback data from the native plugin
    vendor = formatVendorName(input.fallbackVendor);
    amount = input.fallbackAmount;
  } else {
    // No extraction possible — store as rejected
    console.log('[processNotification] AI extraction failed, storing as rejected');
    const pending = await insertPendingTransaction(
      userId,
      input,
      input.fallbackVendor || 'Unknown',
      input.fallbackAmount ?? 0,
      false,
      undefined,
      aiResult.error || 'AI extraction failed',
    );

    if (pending) {
      await supabase
        .from('pending_transactions')
        .update({
          approved: false,
          rejection_reason: 'Could not extract transaction data',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', pending.id);
    }

    return {
      processed: true,
      skipReason: 'no_match',
      pendingTransaction: pending || undefined,
    };
  }

  // ── Step 4: Ignore rule check ──
  const ignored = await shouldIgnore(userId, vendor, amount, input.bankAppId);

  if (ignored) {
    console.log('[processNotification] Notification ignored by user rule');
    return { processed: false, skipReason: 'ignored' };
  }

  // ── Step 5: Insert pending transaction record ──
  const pending = await insertPendingTransaction(
    userId,
    input,
    vendor,
    amount,
    false, // no manual review needed — auto-approved
    undefined,
    'OK',
  );

  if (!pending) {
    return { processed: true };
  }

  // ── Step 6: Auto-approve — always insert as a transaction ──
  // Resolve category: vendor override > AI suggestion > fallback
  let categoryId: string | null = null;

  // Check vendor overrides first (user-configured)
  const { data: overrideData } = await (async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=ilike.${encodeURIComponent(vendor)}&limit=1`,
        { headers },
      );
      if (!res.ok) return { data: null };
      const rows = await res.json();
      return { data: Array.isArray(rows) && rows.length > 0 ? rows[0] : null };
    } catch {
      return { data: null };
    }
  })();

  if (overrideData?.category_id) {
    categoryId = overrideData.category_id;
  }

  // If no override, try to resolve AI-suggested category name to a budget ID
  if (!categoryId && suggestedCategory) {
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', userId);

    if (categories && categories.length > 0) {
      const lowerSuggested = suggestedCategory.toLowerCase();
      const match = categories.find((c: any) => c.name.toLowerCase() === lowerSuggested);
      if (match) {
        categoryId = match.id;
      } else {
        // Fallback: use "Other" or the first available category
        const other = categories.find((c: any) => c.name.toLowerCase() === 'other');
        categoryId = other?.id || categories[0]?.id || null;
      }
    }
  }

  // If still no category, try to find any default
  if (!categoryId) {
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', userId)
      .limit(1);

    if (categories && categories.length > 0) {
      categoryId = categories[0].id;
    }
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
    console.log(`[processNotification] Duplicate detected: ${dupResult.reason}`);
    return { processed: true, pendingTransaction: pending };
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
    console.log(`[processNotification] Updated recurring transaction ${dupResult.updatedExistingId} date`);
    return { processed: true, pendingTransaction: pending, autoAccepted: true, transactionId: dupResult.updatedExistingId, categoryId: categoryId || undefined };
  }

  // Insert the transaction
  if (categoryId) {
    const transactionId = crypto.randomUUID();
    const { error: txError } = await supabase
      .from('transactions')
      .insert({
        id: transactionId,
        user_id: userId,
        vendor: formatVendorName(vendor),
        amount,
        date: new Date().toISOString().slice(0, 10),
        category_id: categoryId,
        recurrence: 'One-time',
        label: 'Auto-Added',
        is_projected: false,
      });

    if (txError) {
      console.error('[processNotification] Error inserting transaction:', txError);
    } else {
      // Mark pending as approved
      await supabase
        .from('pending_transactions')
        .update({
          needs_review: false,
          reviewed_at: new Date().toISOString(),
          approved: true,
        })
        .eq('id', pending.id);

      // Save vendor override for future auto-categorization (if not already saved)
      if (!overrideData) {
        try {
          const headers = await getAuthHeaders();
          (headers as any)['Prefer'] = 'return=representation';
          await fetch(`${REST_BASE}/vendor_overrides`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              user_id: userId,
              vendor_name: formatVendorName(vendor),
              category_id: categoryId,
              auto_accept: true,
            }),
          });
        } catch {
          // Non-critical
        }
      }

      // Remember vendor→category in AI model
      const { data: catData } = await supabase
        .from('categories')
        .select('name')
        .eq('id', categoryId)
        .single();
      if (catData?.name) {
        model.rememberVendorCategory(vendor, catData.name);
      }

      return {
        processed: true,
        pendingTransaction: pending,
        autoAccepted: true,
        transactionId,
        categoryId,
      };
    }
  }

  // If we couldn't determine a category at all, still mark as approved
  // but without a budget category — it will show as uncategorized
  await supabase
    .from('pending_transactions')
    .update({
      needs_review: false,
      reviewed_at: new Date().toISOString(),
      approved: true,
    })
    .eq('id', pending.id);

  return {
    processed: true,
    pendingTransaction: pending,
    autoAccepted: true,
  };
}

