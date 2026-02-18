// lib/notificationProcessor.ts
//
// Notification processing pipeline with AI-based extraction.
//
// Pipeline:
//   1. Duplicate detection (check transactions + pending_transactions tables)
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

/** Milliseconds per hour — window for duplicate detection */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * In-memory cache of recently processed notification keys.
 * Prevents the same notification from being processed multiple times
 * during a scan or when the same notification is re-broadcast.
 * Key: `${bankAppId}|${amount}|${notificationTimestamp}`
 * Value: timestamp when the key was added (for cache expiry)
 */
const recentlyProcessedCache = new Map<string, number>();

/** How long to keep entries in the in-memory dedup cache (ms) */
const DEDUP_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Build an in-memory dedup key from the raw notification fields.
 * Uses bankAppId + raw amount + notification timestamp so that
 * identical notifications from the same app are caught before
 * any async DB calls or AI processing.
 */
function buildInMemoryDedupKey(
  bankAppId: string,
  rawNotification: string,
  notificationTimestamp: number,
): string {
  // Extract amount from raw text for keying
  const amountMatch = rawNotification.match(/\$([\d,]+\.?\d{0,2})/);
  const amount = amountMatch ? amountMatch[1].replace(/,/g, '') : '';
  return `${bankAppId}|${amount}|${notificationTimestamp}`;
}

/**
 * Evict expired entries from the in-memory dedup cache.
 */
function evictExpiredCacheEntries(): void {
  const now = Date.now();
  for (const [key, addedAt] of recentlyProcessedCache) {
    if (now - addedAt > DEDUP_CACHE_TTL_MS) {
      recentlyProcessedCache.delete(key);
    }
  }
}

/** Exposed for testing: clear the in-memory dedup cache */
export function _clearDedupCacheForTesting(): void {
  recentlyProcessedCache.clear();
}

// ─── Types ───────────────────────────────────────────────────────

export interface NotificationInput {
  rawNotification: string;
  bankAppId: string;
  bankName: string;
  notificationTitle?: string;
  notificationTimestamp?: number;
  /** Fallback vendor from native plugin (used if AI fails) */
  fallbackVendor?: string;
  /** Fallback amount from native plugin (used if AI fails) */
  fallbackAmount?: number;
}

export interface ProcessingResult {
  /** Whether the notification was processed (false = dedup'd or ignored) */
  processed: boolean;
  /** Reason processing stopped early */
  skipReason?: 'duplicate' | 'ignored' | 'no_user';
  /** Whether the transaction was auto-accepted directly into transactions */
  autoAccepted?: boolean;
  /** The transaction ID if auto-accepted */
  transactionId?: string;
  /** The category ID assigned when auto-accepted */
  categoryId?: string;
}

// ─── Step 1: Duplicate Detection Against Tables ─────────────────

/**
 * Generate a fingerprint hash from notification content.
 * Used for in-memory deduplication of pending transaction batches.
 * NOT used for Supabase lookups — see checkAlreadyProcessed() instead.
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
 * Check if a notification has already been processed by looking at
 * the transactions and pending_transactions tables directly.
 *
 * A notification is considered a duplicate if a record with the same
 * amount exists within a 1-hour window of the notification timestamp.
 * The vendor is also checked: the existing vendor must contain a word
 * from the notification text (keyword match) OR be an exact
 * case-insensitive match.
 *
 * This replaces the old fingerprint-table approach, which required a
 * separate Supabase table and could silently drop notifications when
 * that table had issues.
 */
async function checkAlreadyProcessed(
  userId: string,
  amount: number | null,
  vendor: string | null,
  notificationTimestamp: number,
): Promise<boolean> {
  if (amount == null) return false;

  const windowStart = new Date(notificationTimestamp - MS_PER_HOUR).toISOString();
  const windowEnd   = new Date(notificationTimestamp + MS_PER_HOUR).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  // ── Check transactions table ──
  // Query 1: created_at within the notification time window
  const { data: txRows } = await supabase
    .from('transactions')
    .select('id, vendor, amount, created_at')
    .eq('user_id', userId)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd);

  if (txRows && txRows.length > 0) {
    for (const tx of txRows) {
      if (Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE) {
        if (vendorMatches(tx.vendor, vendor)) {
          console.log(`[dedup] Duplicate found in transactions: ${tx.vendor} $${tx.amount}`);
          return true;
        }
      }
    }
  }

  // Query 2: same amount + vendor on today's date (catches duplicates where
  // the notification timestamp and created_at don't overlap, e.g. delayed
  // processing or re-scanning old notifications)
  const { data: todayTxRows } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date')
    .eq('user_id', userId)
    .eq('date', today);

  if (todayTxRows && todayTxRows.length > 0) {
    for (const tx of todayTxRows) {
      if (Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE) {
        if (vendorMatches(tx.vendor, vendor)) {
          console.log(`[dedup] Duplicate found in today's transactions: ${tx.vendor} $${tx.amount}`);
          return true;
        }
      }
    }
  }

  // ── Check pending_transactions table ──
  const { data: ptRows } = await supabase
    .from('pending_transactions')
    .select('id, extracted_vendor, extracted_amount, created_at')
    .eq('user_id', userId)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd);

  if (ptRows && ptRows.length > 0) {
    for (const pt of ptRows) {
      if (Math.abs(Number(pt.extracted_amount) - amount) < AMOUNT_TOLERANCE) {
        if (vendorMatches(pt.extracted_vendor, vendor)) {
          console.log(`[dedup] Duplicate found in pending_transactions: ${pt.extracted_vendor} $${pt.extracted_amount}`);
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check whether two vendor names match.
 * Returns true if:
 *   - They are an exact case-insensitive match, OR
 *   - One vendor name contains a significant word (3+ chars) from the other
 */
export function vendorMatches(existingVendor: string | null, newVendor: string | null): boolean {
  if (existingVendor == null || newVendor == null) return existingVendor == null && newVendor == null;

  const a = existingVendor.toLowerCase().trim();
  const b = newVendor.toLowerCase().trim();

  if (a === b) return true;
  if (!a || !b) return false;

  // Check if any significant word from one appears in the other
  const wordsA = a.split(/\s+/).filter(w => w.length >= 3);
  for (const word of wordsA) {
    if (b.includes(word)) return true;
  }
  const wordsB = b.split(/\s+/).filter(w => w.length >= 3);
  for (const word of wordsB) {
    if (a.includes(word)) return true;
  }

  return false;
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

// ─── Step 2: Ignore Rule Check ──────────────────────────────────

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
  skipReason?: 'duplicate_fingerprint' | 'duplicate_vendor_amount' | 'duplicate_manual' | 'duplicate_ai' | 'not_transaction' | 'extraction_failed';
  /** The bank name */
  bankName?: string;
}

/**
 * Store a rejected notification in pending_transactions so it appears
 * in the rejected card on the Transaction Parsing screen.
 *
 * Privacy: We do NOT store the raw notification text. Only the extracted
 * vendor, amount, and bank app identifier are persisted.
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
    // Check for existing rejected entry with same vendor + amount to avoid duplicates
    const normalizedVendor = (vendor || 'Unknown').toLowerCase().trim();
    const normalizedAmount = amount ?? 0;

    const { data: existing } = await supabase
      .from('pending_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'rejected')
      .eq('notification_timestamp', notifTimestamp);

    if (existing && existing.length > 0) {
      console.log(`[AI pipeline] Rejected notification already stored, skipping duplicate`);
      return;
    }

    // Also check for same vendor + amount rejected today (different notification_timestamp
    // but same underlying transaction)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: todayExisting } = await supabase
      .from('pending_transactions')
      .select('id, extracted_vendor, extracted_amount')
      .eq('user_id', userId)
      .eq('status', 'rejected')
      .gte('created_at', todayStart.toISOString());

    if (todayExisting && todayExisting.length > 0) {
      const isDup = todayExisting.some(pt => {
        const ptVendor = (pt.extracted_vendor || '').toLowerCase().trim();
        const ptAmount = Number(pt.extracted_amount) || 0;
        return ptVendor === normalizedVendor && Math.abs(ptAmount - normalizedAmount) < AMOUNT_TOLERANCE;
      });
      if (isDup) {
        console.log(`[AI pipeline] Similar rejected notification already stored today, skipping`);
        return;
      }
    }

    const now = new Date();
    await supabase.from('pending_transactions').insert({
      user_id: userId,
      app_package: input.bankAppId,
      app_name: input.bankName,
      notification_timestamp: notifTimestamp,
      posted_at: now.toISOString(),
      extracted_vendor: vendor || 'Unknown',
      extracted_amount: amount ?? 0,
      extracted_timestamp: now.toISOString(),
      confidence: 0,
      status: 'rejected',
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
 *   1. Duplicate detection (check transactions + pending_transactions tables)
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

  const notifTimestamp = input.notificationTimestamp || Date.now();

  // ── Step 0: In-memory dedup ──
  // Fast check to prevent the same notification from being processed
  // multiple times during a scan or rapid re-broadcast.
  evictExpiredCacheEntries();
  const inMemoryKey = buildInMemoryDedupKey(
    input.bankAppId,
    input.rawNotification,
    notifTimestamp,
  );
  if (recentlyProcessedCache.has(inMemoryKey)) {
    console.log('[AI pipeline] In-memory dedup hit, skipping');
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'duplicate_fingerprint',
      bankName: input.bankName,
    };
  }

  // ── Step 1: Duplicate Detection ──
  // Extract a quick amount from the raw text for the duplicate check.
  let quickAmount: number | null = null;
  const quickAmountMatch = input.rawNotification.match(/\$([\d,]+\.?\d{0,2})/);
  if (quickAmountMatch) {
    quickAmount = parseFloat(quickAmountMatch[1].replace(',', ''));
  }

  const isDuplicate = await checkAlreadyProcessed(
    userId,
    quickAmount,
    input.fallbackVendor || null,
    notifTimestamp,
  );

  if (isDuplicate) {
    console.log('[AI pipeline] Duplicate detected, skipping');
    // Also add to in-memory cache to prevent re-processing
    recentlyProcessedCache.set(inMemoryKey, Date.now());
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'duplicate_fingerprint',
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
    const reason = aiResult.rejectionReason || 'Not cost-related notification';
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

  const vendor = aiResult.vendor || input.fallbackVendor || null;
  const amount = aiResult.amount ?? input.fallbackAmount ?? 0;

  // ── Step 3b: Reject if no vendor could be identified ──
  if (!vendor) {
    const reason = 'No vendor name found in notification';
    console.log('[AI pipeline] Rejected: no vendor identified');
    await storeRejectedNotification(userId, input, notifTimestamp, null, amount, reason);
    return {
      processed: true,
      isTransaction: false,
      amount,
      skipReason: 'not_transaction',
      rejectionReason: reason,
      bankName: input.bankName,
    };
  }

  // ── Step 4: Duplicate detection (vendor + amount pair) ──
  const today = new Date().toISOString().slice(0, 10);
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date, label, recurrence')
    .eq('user_id', userId)
    .ilike('vendor', vendor);

  if (existingTx && existingTx.length > 0) {
    // Filter to matching amounts
    const amountMatches = existingTx.filter(
      (tx) => Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE,
    );

    // Check recurring transactions first: same vendor + amount within ±3 days
    // → update the existing transaction's date to today (not a duplicate)
    const todayMs = new Date(today).getTime();
    const toleranceMs = RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY;

    for (const tx of amountMatches) {
      const recurrence = (tx.recurrence || '').toLowerCase();
      if (recurrence !== 'monthly' && recurrence !== 'biweekly') continue;

      const txDateMs = new Date(tx.date).getTime();
      if (Math.abs(todayMs - txDateMs) <= toleranceMs) {
        // Update the existing recurring transaction's date to today
        await supabase
          .from('transactions')
          .update({ date: today })
          .eq('id', tx.id);
        console.log(`[AI pipeline] Updated recurring transaction ${tx.id} date to ${today}`);
        // Not a duplicate — the recurring entry is refreshed
        break;
      }
    }

    // Check one-time duplicates: same vendor + amount + same day
    const duplicateToday = amountMatches.find(
      (tx) => tx.date === today,
    );

    if (duplicateToday) {
      // Distinguish manual vs AI duplicates
      const isAIDuplicate = duplicateToday.label === 'AI' || duplicateToday.label === 'Auto-Added';
      const skipReason = isAIDuplicate ? 'duplicate_ai' as const : 'duplicate_manual' as const;
      const reason = isAIDuplicate
        ? `Duplicate transaction found: ${vendor} for $${amount.toFixed(2)} was already recorded by AI`
        : `Duplicate transaction found: ${vendor} for $${amount.toFixed(2)} matches a manually recorded transaction`;
      console.log(`[AI pipeline] ${reason}`);
      // Only store rejection for manual duplicates — AI duplicates are expected
      // when re-scanning notifications and don't need to clutter the rejected card
      if (!isAIDuplicate) {
        await storeRejectedNotification(userId, input, notifTimestamp, vendor, amount, reason);
      }
      return {
        processed: true,
        isTransaction: true,
        vendor,
        amount,
        skipReason,
        rejectionReason: reason,
        bankName: input.bankName,
      };
    }
  }

  // ── Step 5: Category assignment + vendor name override ──
  let categoryId: string | null = null;
  let categoryName: string | null = null;
  // The display vendor name — may be overridden by vendor_overrides
  let displayVendor: string = vendor;

  // First check vendor_overrides for category_id, proper_name, and vendor_name
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=ilike.${encodeURIComponent(vendor)}&limit=1`,
      { headers },
    );
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const override = rows[0];
        categoryId = override.category_id;
        const matchedCat = availableCategories.find(c => c.id === categoryId);
        categoryName = matchedCat?.name || null;
        // Use proper_name if available, otherwise use vendor_name from override
        if (override.proper_name) {
          displayVendor = override.proper_name;
          console.log(`[AI pipeline] Vendor override proper_name: ${vendor} → ${displayVendor} (${categoryName})`);
        } else if (override.vendor_name) {
          displayVendor = override.vendor_name;
          console.log(`[AI pipeline] Vendor override vendor_name: ${vendor} → ${displayVendor} (${categoryName})`);
        } else {
          console.log(`[AI pipeline] Vendor override found: ${vendor} → ${categoryName}`);
        }
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
  const finalVendorName = formatVendorName(displayVendor);
  const { error: txError } = await supabase
    .from('transactions')
    .insert({
      id: transactionId,
      user_id: userId,
      vendor: finalVendorName,
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
      vendor: finalVendorName,
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
      `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=eq.${encodeURIComponent(finalVendorName)}`,
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
          vendor_name: finalVendorName,
          category_id: categoryId,
        }),
      });
    }
  } catch (err) {
    console.warn('[AI pipeline] vendor_override save failed:', err);
  }

  console.log(`[AI pipeline] Transaction saved: ${finalVendorName} $${amount} → ${categoryName}`);

  return {
    processed: true,
    isTransaction: true,
    transactionId,
    vendor: finalVendorName,
    amount,
    categoryId,
    categoryName: categoryName || undefined,
    bankName: input.bankName,
  };
}
