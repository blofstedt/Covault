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
import { formatVendorName, fuzzyVendorMatch, normalizeVendorForDedup } from './formatVendorName';
import { parseNotificationText } from './deviceTransactionParser';
import { addToReviewQueue, getVendorMapEntry, getVendorMap, isNotificationProcessed, markNotificationProcessed, getCachedAIResult, setCachedAIResult } from './localNotificationMemory';
import { getLocalToday, parseLocalDate } from './dateUtils';
import { extractWithAI } from './aiExtractor';
import type { PendingTransaction } from '../types';

// ─── Constants ───────────────────────────────────────────────────

/** Tolerance for comparing monetary amounts */
const AMOUNT_TOLERANCE = 0.01;

/** Number of days tolerance for recurring transaction date matching */
const RECURRING_DATE_TOLERANCE_DAYS = 3;

/**
 * Below this confidence, the regex parser is considered a guess and the
 * pipeline falls back to the on-device AI model (extractWithAI). The AI
 * model is slower to load but produces better extractions on ambiguous
 * notifications. Above this threshold we trust the regex to keep things
 * fast for the common case.
 */
const AI_FALLBACK_CONFIDENCE_THRESHOLD = 0.65;

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
  // Query by `date` using a ±3 day window so that recurring transactions
  // or slightly delayed notifications are caught across all budgets.
  const today = getLocalToday();
  const todayDate = parseLocalDate(today);
  const windowStartDate = new Date(todayDate.getTime() - RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY);
  const windowEndDate = new Date(todayDate.getTime() + RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY);
  const startDateStr = windowStartDate.toISOString().slice(0, 10);
  const endDateStr = windowEndDate.toISOString().slice(0, 10);
  const { data: txRows } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date')
    .eq('user_id', userId)
    .gte('date', startDateStr)
    .lte('date', endDateStr);

  if (txRows && txRows.length > 0) {
    for (const tx of txRows) {
      if (Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE) {
        const exactMatch = normalizeVendorForDedup(tx.vendor) === normalizedVendor;
        const fuzzyMatch = fuzzyVendorMatch(tx.vendor, vendor);
        if (exactMatch || fuzzyMatch) {
          console.log(`[dedup] Duplicate found in transactions: ${tx.vendor} $${tx.amount} (fuzzy=${fuzzyMatch})`);
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

// Re-exported from formatVendorName.ts so existing call sites keep working.
// The canonical definition strips parenthetical suffixes like "(Tx. Incl.)"
// and trailing location codes, which the old version did not.
export { normalizeVendorForDedup } from './formatVendorName';

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
 * nearest minute (60-second window).  Two records that share the same key
 * are considered duplicates per the issue requirements.
 */
function extractedDedupKey(pt: PendingTransaction): string {
  const vendor = (pt.extracted_vendor || '').toLowerCase().trim();
  const amt = Number(pt.extracted_amount);
  const amount = Number.isFinite(amt) ? amt.toFixed(2) : '0.00';
  // Truncate extracted_timestamp to the minute (60s window) to catch near-duplicates
  const tsMs = pt.extracted_timestamp ? new Date(pt.extracted_timestamp).getTime() : 0;
  const tsMinute = Math.floor(tsMs / 60000);
  return `${vendor}|${amount}|${tsMinute}`;
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

  // ── Pass 4: Same amount from same app within ±5 minutes ──
  // Catches duplicates where the bank re-broadcasts the same notification
  // with slightly different vendor text (e.g., "PUB MOBILE" vs "PUBLIC MOBILE SELF").
  survivors = pendingTransactions.filter(pt => keepSet.has(pt.id));
  const appAmountGroups = new Map<string, PendingTransaction[]>();

  for (const pt of survivors) {
    const amt = Number(pt.extracted_amount);
    const amount = Number.isFinite(amt) ? amt.toFixed(2) : '0.00';
    // Group by app + amount + 5-minute window
    const tsWindow = Math.floor((pt.notification_timestamp || 0) / (5 * MS_PER_MINUTE));
    const key = `${pt.app_package}|${amount}|${tsWindow}`;
    const group = appAmountGroups.get(key);
    if (group) {
      group.push(pt);
    } else {
      appAmountGroups.set(key, [pt]);
    }
  }

  for (const group of appAmountGroups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
  /**
   * Whether a duplicate was found that should block a new transaction.
   * With the "never miss a charge" policy, this is only true when the
   * existing row is the SAME notification being reprocessed (caught by
   * the in-memory + localStorage caches upstream) or an obvious same-day
   * same-amount same-vendor dup. The user said they'd rather see both
   * rows and dedup manually for everything else.
   */
  isDuplicate: boolean;
  /** Reason for rejection, if any */
  reason?: string;
  /**
   * If a recurring transaction's date was updated, this is its ID.
   * @deprecated The system no longer auto-updates dates.
   */
  updatedExistingId?: string;
  /** If a same-day hard match was found, this is its ID. The new transaction is skipped. */
  skippedExistingId?: string;
  /**
   * If any match was found (same vendor after normalization, within the
   * ±3 day window, same OR different amount), this is the closest one's
   * ID. The new transaction is NOT skipped — the user gets a soft-dedup
   * warning so they don't miss a charge that might be legitimate (e.g.
   * Fizz's two $26.20 charges per month).
   *
   * The UI uses this to render a "possible duplicate" badge on the
   * auto-entered card. The source field on the existing row tells the
   * UI what kind of match it is:
   *   - source: 'executor'    → executor-spawned recurring charge
   *   - source: 'notification' → another notification (might be re-broadcast)
   *   - source: 'manual'      → user already entered it
   *   - source: 'import'      → bulk-imported
   */
  softDuplicateOfId?: string;
  /** Vendor of the soft-dup match (for the warning message) */
  softDuplicateVendor?: string;
  /** Amount of the soft-dup match */
  softDuplicateAmount?: number;
  /** Date of the soft-dup match */
  softDuplicateDate?: string;
  /** Source of the soft-dup match (drives the warning text) */
  softDuplicateSource?: 'executor' | 'notification' | 'manual' | 'import';
}

/**
 * Check if a pending transaction duplicates an existing transaction.
 *
 * With the "never miss a charge" policy, this is much more permissive
 * than before. The only HARD skip is a same-day same-vendor same-amount
 * match — which is almost certainly the same notification being
 * reprocessed. Everything else returns a soft-dup warning and lets the
 * caller insert anyway.
 *
 * This is what fixes the Fizz case: the two $26.20 charges (3 days
 * apart) are NOT hard-skipped. The second one is inserted and the user
 * sees a "possible duplicate" badge they can dismiss.
 */
export async function checkDuplicateTransaction(
  userId: string,
  pending: PendingTransaction,
): Promise<DuplicateCheckResult> {
  const vendor = formatVendorName(pending.extracted_vendor);
  const amount = Number(pending.extracted_amount);
  const today = getLocalToday();
  const todayMs = parseLocalDate(today).getTime();
  const toleranceMs = RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY;

  // Query transactions within ±3 days (broader than just exact vendor match)
  const windowStart = new Date(todayMs - toleranceMs).toISOString().slice(0, 10);
  const windowEnd = new Date(todayMs + toleranceMs).toISOString().slice(0, 10);

  const { data: existing, error } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date, recur, source, created_at')
    .eq('user_id', userId)
    .gte('date', windowStart)
    .lte('date', windowEnd);

  if (error) {
    console.error('[checkDuplicate] Error fetching transactions:', error);
    return { isDuplicate: false };
  }

  if (!existing || existing.length === 0) {
    return { isDuplicate: false };
  }

  // Use the strong normalizer (strips "(Tx. Incl.)", location codes, etc.)
  // so "Fizz (Tx. Incl.)" and "Fizz" compare equal.
  const normalizedIncoming = normalizeVendorForDedup(vendor);

  // Single pass: find ALL matches (same vendor + within window), regardless
  // of amount. The only hard-skip is a same-day exact match — which is
  // almost certainly a re-broadcast of the same notification.
  const allMatches = existing.filter((tx) => {
    const normalizedExisting = normalizeVendorForDedup(tx.vendor);
    if (normalizedExisting !== normalizedIncoming) return false;
    return true;
  });

  if (allMatches.length === 0) {
    return { isDuplicate: false };
  }

  // Hard-skip only: same day, same amount (within tolerance), same vendor.
  // This is the "I just reprocessed the same notification" case. For
  // everything else, we soft-warn.
  const exactSameDay = allMatches.find((tx) => {
    if (tx.date !== today) return false;
    return Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE;
  });

  if (exactSameDay) {
    console.log(`[checkDuplicate] Hard skip: same-day same-amount match ${exactSameDay.vendor} $${exactSameDay.amount} (${exactSameDay.date})`);
    return {
      isDuplicate: true,
      reason: 'Same notification reprocessed on the same day',
      skippedExistingId: exactSameDay.id,
    };
  }

  // Soft-warn: pick the closest match (by amount) to surface to the UI.
  // We prefer same-amount over different-amount for the "this is almost
  // certainly a dup" message, but any match is worth flagging.
  const sameAmount = allMatches.find((tx) => Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE);
  const closest = sameAmount || allMatches.sort((a, b) => {
    return Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount);
  })[0];

  console.log(`[checkDuplicate] Soft-dup: similar ${closest.vendor} $${closest.amount} (${closest.date}, source=${closest.source || 'unknown'}) but new charge is $${amount}`);
  return {
    isDuplicate: false,
    softDuplicateOfId: closest.id,
    softDuplicateVendor: closest.vendor,
    softDuplicateAmount: Number(closest.amount),
    softDuplicateDate: closest.date,
    softDuplicateSource: closest.source || undefined,
  };
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
  /**
   * If the new transaction looks like a soft duplicate (same vendor after
   * normalization, but a different amount) the system still inserts it so
   * the user never misses a charge, and surfaces this warning instead.
   * The UI should show a "possible duplicate" badge.
   */
  softDuplicateOf?: {
    id: string;
    vendor: string;
    amount: number;
    date: string;
  };
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

  // Tracks a soft-dup match found in Step 4 so the Step 6 insert can
  // surface the warning in the returned result. Cleared on every call.
  let softDupMatch: { id: string; vendor: string; amount: number; date: string } | null = null;

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
  let parsed = parseNotificationText(input.rawNotification);

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

  // ── Step 2b: AI fallback for low-confidence extractions ──
  // The regex parser is fast but brittle. If it wasn't confident (e.g. no
  // strong go-phrase, no clear preposition-based vendor, multiple amount
  // candidates) we fall back to the on-device Flan-T5 model. The first
  // call loads the model (slow, ~60MB), subsequent calls are fast.
  // Results are cached in localStorage so we never re-infer the same text.
  const parserConfidence = parsed.confidence ?? 0.5;
  if (parserConfidence < AI_FALLBACK_CONFIDENCE_THRESHOLD) {
    // Check the cache first — same notification text is never re-inferred
    const cached = getCachedAIResult(input.rawNotification);
    let aiResult;
    if (cached) {
      console.log(`[AI fallback] cache hit for "${input.rawNotification.slice(0, 40)}..."`);
      aiResult = cached;
    } else {
      try {
        aiResult = await extractWithAI(input.rawNotification, []); // [] = use default categories
        // Persist for next time
        setCachedAIResult(input.rawNotification, {
          isTransaction: aiResult.isTransaction,
          vendor: aiResult.vendor,
          amount: aiResult.amount,
          suggestedCategory: aiResult.suggestedCategory,
          rejectionReason: aiResult.rejectionReason,
        });
      } catch (err) {
        // AI failed to load (network, WASM not supported, etc.) — fall
        // through and use the regex result anyway. Better a slightly-wrong
        // extraction than no extraction at all.
        console.warn('[AI fallback] failed, using regex result:', err);
        aiResult = null;
      }
    }
    if (aiResult) {
      if (aiResult.isTransaction && aiResult.vendor && aiResult.amount) {
        console.log(
          `[AI fallback] parser=${parserConfidence.toFixed(2)} → using AI: ` +
          `${aiResult.vendor} $${aiResult.amount}` +
          (parsed.confidenceReasons ? ` (reasons: ${parsed.confidenceReasons.join(', ')})` : ''),
        );
        // Merge the AI result over the regex result. The AI's vendor
        // wins if the regex didn't find one or if the AI's vendor is
        // meaningfully different.
        parsed = {
          ...parsed,
          vendorDisplay: aiResult.vendor,
          vendorKey: aiResult.vendor.toLowerCase().replace(/[^a-z0-9]/g, ''),
          amount: aiResult.amount,
        };
      } else if (aiResult.rejectionReason) {
        // The AI thinks this isn't a transaction. Trust it over the regex.
        console.log(`[AI fallback] parser=${parserConfidence.toFixed(2)} → AI rejected: ${aiResult.rejectionReason}`);
        recentlyProcessedCache.set(inMemoryKey, Date.now());
        markNotificationProcessed(inMemoryKey);
        return {
          processed: true,
          isTransaction: false,
          vendor: aiResult.vendor || undefined,
          amount: aiResult.amount || undefined,
          skipReason: 'not_transaction',
          rejectionReason: `AI: ${aiResult.rejectionReason}`,
          bankName: input.bankName,
        };
      }
    }
  }

  // Use the deterministic extraction result unless it failed ('Unknown'), in which
  // case fall back to whatever the native plugin extracted from the notification title.
  const extractedVendor = (parsed.vendorDisplay && parsed.vendorDisplay !== 'Unknown')
    ? parsed.vendorDisplay
    : null;
  const vendor = extractedVendor || input.fallbackVendor || null;
  const rawAmount = parsed.amount ?? input.fallbackAmount ?? 0;
  // Refunds and income are stored as negative amounts so they naturally reduce budget totals
  const amount = (parsed.isRefund || parsed.isIncome) ? -Math.abs(rawAmount) : rawAmount;

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

  // ── Step 4: Duplicate detection (fuzzy vendor + amount ±3 days) ──
  const today = getLocalToday();
  const normalizedVendor = normalizeVendorForDedup(vendor);
  const todayMs = parseLocalDate(today).getTime();
  const step4WindowStart = new Date(todayMs - RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
  const step4WindowEnd = new Date(todayMs + RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);

  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id, vendor, amount, type, date, source')
    .eq('user_id', userId)
    .gte('date', step4WindowStart)
    .lte('date', step4WindowEnd);

  if (existingTx && existingTx.length > 0) {
    // Single permissive pass: any same-vendor match in the window is a
    // soft-dup. The only hard-skip is same-day same-amount, which is
    // almost certainly a re-broadcast of the same notification.
    const sameDaySameAmount = existingTx.find((tx) => {
      if (normalizeVendorForDedup(tx.vendor) !== normalizedVendor) return false;
      if (tx.date !== today) return false;
      return Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE;
    });

    if (sameDaySameAmount) {
      // True re-broadcast of the same notification — hard skip. The
      // in-memory cache above should catch this first, but we keep this
      // as a belt-and-suspenders.
      console.log(`[AI pipeline] Hard skip: same-day same-amount match ${sameDaySameAmount.vendor} $${sameDaySameAmount.amount} (${sameDaySameAmount.date})`);
      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationProcessed(inMemoryKey);
      return {
        processed: true,
        isTransaction: true,
        vendor,
        amount,
        skipReason: 'duplicate_ai' as const,
        rejectionReason: 'Same notification reprocessed on the same day',
        bankName: input.bankName,
      };
    }

    // Soft-dup: any other same-vendor match in the window. We do NOT skip
    // — the user has said they'd rather see both rows and dedup manually.
    // Pick the closest match (by amount) to surface in the parsing UI.
    const allMatches = existingTx.filter((tx) => normalizeVendorForDedup(tx.vendor) === normalizedVendor);
    if (allMatches.length > 0) {
      const sameAmount = allMatches.find((tx) => Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE);
      const closest = sameAmount || allMatches.sort((a, b) =>
        Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount)
      )[0];
      console.log(`[AI pipeline] Soft-dup: similar ${closest.vendor} $${closest.amount} on ${closest.date} (source=${closest.source || 'unknown'}), but new charge is $${amount.toFixed(2)}`);
      softDupMatch = {
        id: closest.id,
        vendor: closest.vendor,
        amount: Number(closest.amount),
        date: closest.date,
      };
    }
  }

  // ── Step 5: Category assignment ──
  // Priority: server vendor_overrides → localStorage vendorMap → "Other" → first available
  let categoryId: string | null = null;
  let categoryName: string | null = null;
  let displayVendor: string = vendor;

  // 5a: Check server-side overrides table
  // Schema: overrides(id, user_id, proper_name text, match_key text, category_id text)
  // Lookup priority:
  //   1. match_key (normalized vendor slug) — survives display-name variants
  //      and trailing prefixes like "KIA FINANCE CORP" vs "Kia".
  //   2. proper_name ilike — fallback for legacy rows that pre-date match_key.
  if (vendor) {
    const vendorKey = vendor.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1) match_key lookup
    let overrideRows: any[] | null = null;
    if (vendorKey) {
      const { data } = await supabase
        .from('overrides')
        .select('category_id, proper_name, match_key')
        .eq('user_id', userId)
        .eq('match_key', vendorKey)
        .limit(1);
      overrideRows = data;
    }

    // 2) proper_name ilike fallback
    if (!overrideRows || overrideRows.length === 0) {
      const { data } = await supabase
        .from('overrides')
        .select('category_id, proper_name, match_key')
        .eq('user_id', userId)
        .ilike('proper_name', vendor)
        .limit(1);
      overrideRows = data;
    }

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

  // 5b: Check localStorage vendor map (exact match first, then fuzzy)
  // Exact match handles the common case (user corrected "AMZN MKTP" → "Amazon"
  // and future "AMZN MKTP" notifications hit the exact key). The fuzzy pass
  // handles the case where the same underlying merchant shows up under a
  // slightly different surface form (e.g. "AMAZON.COM" vs "AMZN MKTP" vs
  // "Amazon Prime" all map to "Amazon"). Without fuzzy matching, the user
  // would have to correct each variant separately.
  if (!categoryId && parsed.vendorKey) {
    let vendorMapEntry = getVendorMapEntry(parsed.vendorKey);

    if (!vendorMapEntry) {
      // Fuzzy fallback: scan all stored entries and find the closest one
      // by token-level Jaccard similarity. The user said they want the
      // system to learn from their corrections — fuzzy matching is how
      // we make one correction apply to many surface forms.
      const allEntries = getVendorMap();
      let bestKey: string | null = null;
      let bestScore = 0;
      for (const [key, entry] of Object.entries(allEntries)) {
        if (!fuzzyVendorMatch(parsed.vendorDisplay || parsed.vendorKey, entry.vendor_display)) continue;
        // Prefer matches with the same normalized prefix (e.g. "amazon"
        // vs "amzn") to avoid accidentally mapping "Spotify" to "Amazon".
        const normalizedStored = (entry.vendor_display || '').toLowerCase().split(/\s+/)[0];
        const normalizedIncoming = (parsed.vendorDisplay || parsed.vendorKey).toLowerCase().split(/\s+/)[0];
        const score = normalizedStored && normalizedIncoming && normalizedStored === normalizedIncoming ? 1.0 : 0.5;
        if (score > bestScore) {
          bestScore = score;
          bestKey = key;
        }
      }
      if (bestKey) {
        vendorMapEntry = allEntries[bestKey];
        console.log(`[AI pipeline] vendorMap fuzzy match: "${parsed.vendorDisplay}" → "${vendorMapEntry.vendor_display}" (key=${bestKey})`);
      }
    }

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
    // Query recent transactions broadly, then filter with fuzzy matching
    const recurWindowStart = new Date(todayMs - RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
    const recurWindowEnd = new Date(todayMs + RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
    const { data: recurCandidates } = await supabase
      .from('transactions')
      .select('id, vendor, amount, date, recur, source')
      .eq('user_id', userId)
      .gte('date', recurWindowStart)
      .lte('date', recurWindowEnd);

    if (recurCandidates && recurCandidates.length > 0) {
      for (const tx of recurCandidates) {
        const txRecur = (tx.recur || '').toLowerCase();
        if (txRecur !== 'monthly' && txRecur !== 'biweekly') continue;
        if (Math.abs(Number(tx.amount) - amount) >= AMOUNT_TOLERANCE) continue;
        // Use fuzzy vendor matching for recurring dedup
        if (!fuzzyVendorMatch(tx.vendor, displayVendor)) continue;

        // Step 5b is now a soft-dup detector, not a hard skipper. We
        // record the recurring match but still let the new transaction
        // through — the user said they'd rather see both rows. The UI
        // gets the soft-dup info via the `softDuplicateOf` field on the
        // returned result.
        console.log(`[AI pipeline] Recurring soft-dup: existing tx ${tx.id} (${tx.vendor} $${tx.amount} on ${tx.date}, source=${tx.source || 'unknown'}) matches the new charge`);
        if (!softDupMatch) {
          softDupMatch = {
            id: tx.id,
            vendor: tx.vendor,
            amount: Number(tx.amount),
            date: tx.date,
          };
        }
        break; // Only need one match for the soft-dup warning.
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
      // Mark notification-inserted rows so the dedup logic can distinguish
      // them from executor-spawned rows of the same vendor+amount.
      source: 'notification',
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
    // Surface the soft-dup warning from Step 4 so the UI can show a
    // "possible duplicate" badge. The transaction is still saved — the
    // user said they prefer seeing both rows over missing a charge.
    softDuplicateOf: softDupMatch || undefined,
  };
}

/**
 * Process multiple notifications in parallel. The AI model is a singleton
 * so concurrent calls share the loaded weights; the dedup cache is in-memory
 * and shared too. Returns results in the same order as the inputs.
 *
 * Use this when the Android NotificationListener fires a scan that produces
 * 5-20 notifications at once — the per-call overhead of await and DB round
 * trips adds up when you do them sequentially.
 */
export async function processNotificationBatch(
  userId: string,
  inputs: NotificationInput[],
  availableCategories: { id: string; name: string }[],
  options: { concurrency?: number } = {},
): Promise<AIProcessingResult[]> {
  const concurrency = options.concurrency ?? 4;
  const results: AIProcessingResult[] = new Array(inputs.length);

  // Simple bounded-concurrency executor. For most batches the natural
  // async overhead keeps us well under any rate limits; the cap is just
  // a safety net against a 50-notification scan overwhelming the WASM
  // model with simultaneous inferences.
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= inputs.length) return;
      try {
        results[idx] = await processNotificationWithAI(userId, inputs[idx], availableCategories);
      } catch (err: any) {
        console.error(`[batch] notification ${idx} failed:`, err?.message || err);
        results[idx] = {
          processed: false,
          isTransaction: false,
          rejectionReason: 'Batch processing error',
          bankName: inputs[idx].bankName,
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
