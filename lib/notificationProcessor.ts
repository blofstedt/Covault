// lib/notificationProcessor.ts
//
// Notification processing pipeline with AI-based extraction.
//
// Pipeline:
//   1. In-memory dedup (fast, prevents re-processing during scans)
//   2. Duplicate detection (check transactions + pending_transactions tables)
//   3. AI extraction: vendor, amount, transaction classification
//   4. Non-transaction filtering (balance alerts, OTPs, etc.)
//   5. Duplicate detection (same vendor + amount pair)
//   6. Category assignment: vendor_overrides first, then AI guess
//   7. Insert into transactions table with 'AI' label

import { supabase } from './supabase';
import { formatVendorName } from './formatVendorName';
import { parseNotificationText } from './deviceTransactionParser';
import { addToReviewQueue, getVendorMapEntry, isNotificationProcessed, markNotificationProcessed } from './localNotificationMemory';
import { getLocalToday, parseLocalDate } from './dateUtils';
import type { PendingTransaction } from '../types';

// ─── Constants ───────────────────────────────────────────────────

/** Tolerance for comparing monetary amounts */
const AMOUNT_TOLERANCE = 0.01;

/** Number of days tolerance for recurring transaction date matching */
const RECURRING_DATE_TOLERANCE_DAYS = 3;

/** Milliseconds per day */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Milliseconds per minute — strict duplicate matching window */
const MS_PER_MINUTE = 60 * 1000;

/**
 * In-memory cache of recently processed notification keys.
 * Prevents the same notification from being processed multiple times
 * during a scan or when the same notification is re-broadcast.
 * Key: `${bankAppId}|${amount}|${notificationTimestamp}`
 * Value: timestamp when the key was added (for cache expiry)
 */
const recentlyProcessedCache = new Map<string, number>();

/**
 * How long to keep entries in the in-memory dedup cache (ms).
 * 2 hours balances preventing duplicate processing during rescans
 * while allowing legitimate repeat purchases (e.g., two coffees
 * from the same vendor on the same day). The DB-based dedup in
 * checkAlreadyProcessed() provides a separate, persistent layer.
 */
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
  const amountMatch = rawNotification.match(/\$([\d,]+(?:\.\d{1,2})?)/);
  const amount = amountMatch ? amountMatch[1].replace(/,/g, '') : 'no-amount';
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
  /** True when user manually triggered a refresh scan of active notifications */
  forceReprocess?: boolean;
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
 * vendor + amount exists within a ±1 minute window of the notification
 * timestamp.
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
  if (amount == null || vendor == null) return false;

  const normalizedVendor = normalizeVendorForDedup(vendor);

  // ── Check transactions table ──
  // Query by `date` (the transaction date) rather than `created_at` (DB insert time).
  // A notification might be rescanned long after the original was processed,
  // so comparing against `created_at` with a narrow window misses the duplicate.
  // Instead, check if the same vendor+amount was already recorded today.
  const today = getLocalToday();
  const { data: txRows } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date')
    .eq('user_id', userId)
    .eq('date', today);

  if (txRows && txRows.length > 0) {
    for (const tx of txRows) {
      if (Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE) {
        if (normalizeVendorForDedup(tx.vendor) === normalizedVendor) {
          console.log(`[dedup] Duplicate found in transactions: ${tx.vendor} $${tx.amount}`);
          return true;
        }
      }
    }
  }

  // ── Check pending_transactions table ──
  // Use the notification_timestamp column (bigint ms) for a tighter match.
  const windowStartMs = notificationTimestamp - 5 * MS_PER_MINUTE;
  const windowEndMs   = notificationTimestamp + 5 * MS_PER_MINUTE;
  const { data: ptRows } = await supabase
    .from('pending_transactions')
    .select('id, extracted_vendor, extracted_amount, notification_timestamp')
    .eq('user_id', userId)
    .gte('notification_timestamp', windowStartMs)
    .lte('notification_timestamp', windowEndMs);

  if (ptRows && ptRows.length > 0) {
    for (const pt of ptRows) {
      if (Math.abs(Number(pt.extracted_amount) - amount) < AMOUNT_TOLERANCE) {
        if (normalizeVendorForDedup(pt.extracted_vendor) === normalizedVendor) {
          console.log(`[dedup] Duplicate found in pending_transactions: ${pt.extracted_vendor} $${pt.extracted_amount}`);
          return true;
        }
      }
    }
  }

  return false;
}

function normalizeVendorForDedup(vendor: string | null): string {
  if (!vendor) return '';
  return vendor.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
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
  const today = getLocalToday();

  // Fetch existing transactions for this vendor and approximate amount
  const { data: existing, error } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date, recur, created_at')
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
  const todayMs = parseLocalDate(today).getTime();
  const toleranceMs = RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY;

  for (const tx of amountMatches) {
    const recurrence = (tx.recur || '').toLowerCase();
    if (recurrence !== 'monthly' && recurrence !== 'biweekly') continue;

    const txDateMs = parseLocalDate(tx.date).getTime();
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

  // Rule 2: One-time transactions — same vendor + amount on the same date
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
 * Process a notification using the on-device parsing pipeline.
 *
 * Steps:
 *   1. In-memory dedup (fast, prevents re-processing during scans)
 *   2. Duplicate detection (check transactions + pending_transactions tables)
 *   3. Deterministic extraction (vendor, amount, transaction classification)
 *   4. Non-transaction filtering
 *   5. Duplicate detection (same vendor + amount pair in existing transactions)
 *   6. Category assignment from device-side vendor map (fallback: Other)
 *   7. Insert directly into transactions table with 'AI' label and mark for review
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
  if (!input.forceReprocess && recentlyProcessedCache.has(inMemoryKey)) {
    console.log('[AI pipeline] In-memory dedup hit, skipping');
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'duplicate_fingerprint',
      bankName: input.bankName,
    };
  }

  // ── Step 0b: Persistent dedup (survives app restarts) ──
  // The in-memory cache above is cleared every time the JS module re-loads
  // (app restart, hot reload). This localStorage-backed check ensures a
  // notification that was already processed is never re-inserted after the
  // user clears it from the <> page and the app is closed/reopened.
  // NOTE: forceReprocess does NOT bypass this — it only bypasses the
  // in-memory TTL cache so rescans can retry recently-rejected notifications,
  // but a notification that was successfully inserted must never be re-inserted.
  if (isNotificationProcessed(inMemoryKey)) {
    console.log('[AI pipeline] Persistent dedup hit, skipping');
    // Warm the in-memory cache so subsequent checks in this session are fast
    recentlyProcessedCache.set(inMemoryKey, Date.now());
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
  const quickAmountMatch = input.rawNotification.match(/\$([\d,]+(?:\.\d{1,2})?)/);
  if (quickAmountMatch) {
    quickAmount = parseFloat(quickAmountMatch[1].replace(/,/g, ''));
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

  // ── Step 2: Deterministic extraction ──
  const parsed = parseNotificationText(input.rawNotification);

  if (!parsed.isOutgoing) {
    const reason = parsed.rejectionReason || 'Not an outgoing transaction notification';
    recentlyProcessedCache.set(inMemoryKey, Date.now());
    markNotificationProcessed(inMemoryKey);
    return {
      processed: true,
      isTransaction: false,
      vendor: parsed.vendorDisplay || undefined,
      amount: parsed.amount || undefined,
      skipReason: 'not_transaction',
      rejectionReason: reason,
      bankName: input.bankName,
    };
  }

  // Use the deterministic extraction result unless it failed ('Unknown'), in which
  // case fall back to whatever the native plugin extracted from the notification title.
  const extractedVendor = (parsed.vendorDisplay && parsed.vendorDisplay !== 'Unknown')
    ? parsed.vendorDisplay
    : null;
  const vendor = extractedVendor || input.fallbackVendor || null;
  const amount = parsed.amount ?? input.fallbackAmount ?? 0;

  // ── Step 3b: Reject if no vendor could be identified ──
  if (!vendor) {
    const reason = 'No vendor name found in notification';
    console.log('[AI pipeline] Skipped: no vendor identified');
    recentlyProcessedCache.set(inMemoryKey, Date.now());
    markNotificationProcessed(inMemoryKey);
    return {
      processed: true,
      isTransaction: false,
      amount,
      skipReason: 'not_transaction',
      rejectionReason: reason,
      bankName: input.bankName,
    };
  }

  // ── Step 4: Duplicate detection (exact vendor + amount today) ──
  const today = getLocalToday();
  const normalizedVendor = normalizeVendorForDedup(vendor);

  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id, vendor, amount, type, date')
    .eq('user_id', userId)
    .eq('date', today);

  if (existingTx && existingTx.length > 0) {
    const duplicateToday = existingTx.find((tx) => {
      const vendorMatch = normalizeVendorForDedup(tx.vendor) === normalizedVendor;
      const amountMatch = Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE;
      return vendorMatch && amountMatch;
    });

    if (duplicateToday) {
      // Distinguish manual vs AI duplicates
      const isAIDuplicate = duplicateToday.type === 'Automatic';
      const skipReason = isAIDuplicate ? 'duplicate_ai' as const : 'duplicate_manual' as const;
      const reason = isAIDuplicate
        ? `Duplicate transaction found: ${vendor} for $${amount.toFixed(2)} was already recorded by AI`
        : `Duplicate transaction found: ${vendor} for $${amount.toFixed(2)} matches a manually recorded transaction`;
      console.log(`[AI pipeline] ${reason}`);
      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationProcessed(inMemoryKey);
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

  // ── Step 5: Category assignment ──
  // Priority: server vendor_overrides → localStorage vendorMap → "Other" → first available
  let categoryId: string | null = null;
  let categoryName: string | null = null;
  let displayVendor: string = vendor;

  // 5a: Check server-side overrides table
  // Schema: vendor_overrides(id, user_id, vendor_name text, proper_name text, category_id uuid)
  // vendor_name is the raw vendor string to match; proper_name is the canonical display name
  if (vendor) {
    const { data: overrideRows } = await supabase
      .from('vendor_overrides')
      .select('category_id, proper_name')
      .eq('user_id', userId)
      .ilike('vendor_name', vendor)
      .limit(1);

    if (overrideRows && overrideRows.length > 0) {
      const overrideBudgetName = overrideRows[0].category_id as string; // e.g. 'Groceries'
      const overrideCat = availableCategories.find(
        (c) => c.name.toLowerCase() === (overrideBudgetName || '').toLowerCase(),
      );
      if (overrideCat) {
        categoryId = overrideCat.id;
        categoryName = overrideCat.name;
        // Use the stored proper_name as the display vendor if available
        if (overrideRows[0].proper_name) {
          displayVendor = overrideRows[0].proper_name;
        }
        console.log(`[AI pipeline] overrides match: ${vendor} → ${categoryName}`);
      }
    }
  }

  // 5b: Check localStorage vendor map
  if (!categoryId && parsed.vendorKey) {
    const vendorMapEntry = getVendorMapEntry(parsed.vendorKey);
    if (vendorMapEntry) {
      displayVendor = vendorMapEntry.vendor_display || displayVendor;
      const matchedCategory = availableCategories.find(
        (c) => c.name.toLowerCase() === vendorMapEntry.budget.toLowerCase(),
      );
      if (matchedCategory) {
        categoryId = matchedCategory.id;
        categoryName = matchedCategory.name;
      }
    }
  }

  // 5c: Fallback to "Other" or first available category
  if (!categoryId && availableCategories.length > 0) {
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

  // ── Step 5b: Recurring dedup (same vendor + amount within ±3 days) ──
  // If a recurring transaction already exists nearby, update its date
  // instead of inserting a duplicate.
  const recurrence = (parsed.recurrence || '').toLowerCase();
  if (recurrence === 'monthly' || recurrence === 'biweekly') {
    const { data: recurCandidates } = await supabase
      .from('transactions')
      .select('id, vendor, amount, date, recur')
      .eq('user_id', userId)
      .ilike('vendor', formatVendorName(displayVendor));

    if (recurCandidates && recurCandidates.length > 0) {
      const todayMs = parseLocalDate(today).getTime();
      const toleranceMs = RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY;

      for (const tx of recurCandidates) {
        const txRecur = (tx.recur || '').toLowerCase();
        if (txRecur !== 'monthly' && txRecur !== 'biweekly') continue;
        if (Math.abs(Number(tx.amount) - amount) >= AMOUNT_TOLERANCE) continue;

        const txDateMs = parseLocalDate(tx.date).getTime();
        if (Math.abs(todayMs - txDateMs) <= toleranceMs) {
          // Update the existing recurring transaction's date to today
          await supabase
            .from('transactions')
            .update({ date: today })
            .eq('id', tx.id);

          console.log(`[AI pipeline] Recurring dedup: updated tx ${tx.id} date to ${today}`);
          recentlyProcessedCache.set(inMemoryKey, Date.now());
          markNotificationProcessed(inMemoryKey);
          return {
            processed: true,
            isTransaction: true,
            vendor: formatVendorName(displayVendor),
            amount,
            skipReason: 'duplicate_ai' as const,
            rejectionReason: `Recurring transaction updated: ${vendor} $${amount.toFixed(2)}`,
            bankName: input.bankName,
          };
        }
      }
    }
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
      // Use the same column names as toSupabaseTransaction (the known-working manual insert path)
      budget: categoryName || 'Other',
      type: 'Automatic',
      recur: parsed.recurrence,
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

  console.log(`[AI pipeline] Transaction saved: ${finalVendorName} $${amount} → ${categoryName}`);
  addToReviewQueue(transactionId);

  // Persist to localStorage so this notification is never re-processed
  // after app restart (the in-memory cache below is cleared on reload).
  markNotificationProcessed(inMemoryKey);
  recentlyProcessedCache.set(inMemoryKey, Date.now());

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
