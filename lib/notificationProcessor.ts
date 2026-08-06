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

import { log } from './log';
import { djb2Base36 } from './hash';
import { supabase } from './supabase';
import { formatVendorName, fuzzyVendorMatch, normalizeVendorForDedup } from './formatVendorName';
import { parseNotificationText } from './deviceTransactionParser';
import { addToReviewQueue, getVendorMapEntry, getVendorMap, isNotificationProcessed, markNotificationProcessed, isNotificationRejected, markNotificationRejected, getCachedAIResult, setCachedAIResult, type CachedAIResult } from './localNotificationMemory';
import { findMatchingExpense, REFUND_MATCH_WINDOW_DAYS } from './refundMatching';
import { aiFindRefundMatch } from './aiExtractor';
import type { LearnedVendorExample } from './aiExtractor';
import { checkNotificationRules, bumpRuleUseCount } from './notificationRules';
import { getLocalToday, parseLocalDate, toLocalIsoDay } from './dateUtils';
import { extractWithAI, type AIExtractionResult } from './aiExtractor';
import { detectMerchantSignal, resolveSignalCategory } from './merchantCategorySignals';
import type { PendingTransaction, Transaction } from '../types';
import { scoreVendorMatch, shouldAutoAccept, toMatchKey } from './vendorMatchConfidence';
import { isSameCharge } from './duplicateCharge';
import { isBankingApp } from './bankingApps';
import { detectFuelHold, isFuelMerchant, isHoldAmount, pastFillAmounts, withFuelHoldMarker } from './fuelHold';

// ─── Constants ───────────────────────────────────────────────────

/** Tolerance for comparing monetary amounts */
const AMOUNT_TOLERANCE = 0.01;

/** Number of days tolerance for recurring transaction date matching */
const RECURRING_DATE_TOLERANCE_DAYS = 3;

/**
 * Ceiling on the learned vendor rules loaded when categorising a capture.
 *
 * Not a page size — every rule has to be considered or a rule the user wrote
 * silently stops applying. This is a runaway guard, set far above any real
 * household's rule count, so a corrupt table can't turn one capture into a
 * multi-megabyte download.
 */
const MAX_VENDOR_RULES = 2000;

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
 * Key: `${bankAppId}|h${djb2(rawNotification)}` — see `buildInMemoryDedupKey`.
 * Value: timestamp when the key was added (for cache expiry)
 */
const recentlyProcessedCache = new Map<string, number>();

/**
 * Set of notification keys that are CURRENTLY being processed.
 *
 * This is the defense against the double-capture race: when a scan fires
 * the same notification twice in rapid succession (which happens at app
 * start because BOTH the native NotificationListener.onListenerConnected
 * and the JS useEffect's refreshMonitoredAppsAndScan trigger a scan),
 * both invocations reach processNotificationWithAI before the first one
 * finishes the async insert and marks recentlyProcessedCache.
 *
 * The in-flight set is claimed at the very top of processing (before any
 * await) and released in a finally block. This serializes concurrent
 * duplicates: the second caller sees the key in the set, returns the
 * "duplicate" skip, and the first caller continues to insert.
 */
const inFlightProcessingKeys = new Set<string>();

/**
 * In-flight claims on a PURCHASE, as opposed to a notification.
 *
 * inFlightProcessingKeys is keyed on bankAppId + raw text, so two apps
 * announcing the SAME purchase (the bank app and Google Wallet) never collide
 * there and can both reach the insert concurrently. Step 4's pre-insert DB
 * check does not help either: neither row exists yet when the other queries,
 * and the Step 6b race check has the same blind spot for the same reason.
 * Result: two identical rows, same vendor, same amount, same day.
 *
 * Claiming the purchase itself closes that window. Entries carry a timestamp
 * and expire, so a path that returns without releasing cannot wedge capture
 * for that purchase permanently.
 */
const inFlightPurchaseKeys = new Map<string, number>();
const PURCHASE_CLAIM_TTL_MS = 60_000;

function claimPurchase(key: string): boolean {
  const now = Date.now();
  for (const [k, at] of inFlightPurchaseKeys) {
    if (now - at > PURCHASE_CLAIM_TTL_MS) inFlightPurchaseKeys.delete(k);
  }
  if (inFlightPurchaseKeys.has(key)) return false;
  inFlightPurchaseKeys.set(key, now);
  return true;
}

function releasePurchase(key: string): void {
  inFlightPurchaseKeys.delete(key);
}

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
 *
 * Key format: `bankAppId|<hash of raw text>`.
 *
 * Intentionally CONTENT-ONLY — no `notificationTimestamp`. The original
 * design included the timestamp because Android's `sbn.getPostTime()` is
 * supposed to be stable across re-broadcasts, but in practice the JS-side
 * `event.timestamp` can vary when:
 *   - The native broadcast doesn't include a timestamp and the plugin
 *     falls back to `System.currentTimeMillis()` (see
 *     android-custom/CovaultNotificationPlugin.java).
 *   - The notification is re-fired by a `scanActiveNotifications()` call
 *     with a different JSON payload shape.
 *   - Two notification events for the same charge arrive within the
 *     same second but with sub-second clock differences.
 * Any of these would make the two invocations get different dedup keys
 * and BOTH proceed to insert — which is exactly the double-capture bug
 * the in-flight check was supposed to prevent.
 *
 * Same notification text from the same bank → same key, regardless of
 * how many times it's re-broadcast. Two different transactions that
 * happen to share the same amount (e.g. "Hyundai $458.69" and
 * "Costco $458.69") get distinct keys because their raw text differs
 * and the hash captures that.
 *
 * Hash is djb2 — matches the one `extractVendorSlug` uses as its
 * fallback so we don't pull in a new dependency just for this.
 */
/**
 * Key for the PERSISTENT captured store.
 *
 * The in-memory key above is content-only, which is right for collapsing
 * re-broadcasts of one notification but wrong for a permanent record: two
 * genuinely separate purchases at the same vendor for the same amount produce
 * byte-identical text, so the second was silently dropped forever. A daily
 * coffee at the same price simply stopped being captured.
 *
 * Appending the notification's own local day fixes that, but ONLY when a real
 * post time is available. `sbn.getPostTime()` is stable across rescans, so the
 * key is stable; when the field is missing the caller falls back to Date.now(),
 * which would change across midnight and could re-capture something already in
 * the ledger. In that case we keep the content-only key, which can over-dedup
 * but can never double-insert.
 *
 * Same-day repeats still collapse here — Step 4's same-day/same-amount hard
 * skip is the intended guard for those.
 */
/**
 * The user's confirmed vendor -> category decisions, most recent first.
 *
 * Sourced from the local vendor map, which is written every time a capture is
 * accepted, recategorized or renamed — i.e. every time the user corrects or
 * confirms the pipeline. Recency ordering matters: a changed mind should
 * outweigh an old habit.
 */
function collectLearnedExamples(): LearnedVendorExample[] {
  try {
    return Object.values(getVendorMap())
      .filter((e) => e?.vendor_display && e?.budget)
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .map((e) => ({ vendor: e.vendor_display, category: e.budget }));
  } catch {
    return [];
  }
}

export function buildCapturedKey(
  bankAppId: string,
  rawNotification: string,
  postTimeMs?: number,
): string {
  const base = buildInMemoryDedupKey(bankAppId, rawNotification);
  if (!postTimeMs || !Number.isFinite(postTimeMs) || postTimeMs <= 0) return base;
  return `${base}|${toLocalIsoDay(new Date(postTimeMs))}`;
}

export function buildInMemoryDedupKey(
  bankAppId: string,
  rawNotification: string,
): string {
  // The bankAppId prefix prevents the same text from different banks from
  // being conflated (rare, but possible if a user has two banking apps that
  // both notify on the same transaction).
  return `${bankAppId || '?'}|h${djb2Base36(rawNotification)}`;
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
  /**
   * Opt-in: file a capture straight into its budget, skipping review, when a
   * learned vendor rule explains the incoming name well enough
   * (AUTO_ACCEPT_MIN_CONFIDENCE in lib/vendorMatchConfidence.ts).
   *
   * Only rules the user wrote can trigger this — see the auto-accept block in
   * Step 6. Defaults to off, and any missing information means review.
   */
  autoAcceptKnownVendors?: boolean;
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
  return djb2Base36(raw);
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
  //
  // Centred on the notification's own timestamp, not on today. Those are the
  // same thing for a notification arriving now, and different for the case
  // this exists to catch — a rescan of the shade picking up something from
  // several days ago, where a window around today can sit entirely past the
  // charge it should have matched.
  const anchor = notificationTimestamp > 0
    ? new Date(notificationTimestamp)
    : parseLocalDate(getLocalToday());
  const todayDate = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
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
          log.debug(`[dedup] Duplicate found in transactions: ${tx.vendor} $${tx.amount} (fuzzy=${fuzzyMatch})`);
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
          log.debug(`[dedup] Duplicate found in pending_transactions: ${pt.extracted_vendor} $${pt.extracted_amount}`);
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
  pendingTransactions: PendingTransaction[],
): Promise<PendingTransaction[]> {
  if (pendingTransactions.length <= 1) return pendingTransactions;

  // Parse created_at once per row. The four grouping passes below each sort
  // their groups by it, and `new Date(...).getTime()` inside a comparator
  // re-parses both operands on every comparison.
  const createdAtMs = new Map<string, number>();
  for (const pt of pendingTransactions) {
    createdAtMs.set(pt.id, new Date(pt.created_at).getTime());
  }
  const byCreatedAt = (a: PendingTransaction, b: PendingTransaction) =>
    (createdAtMs.get(a.id) ?? 0) - (createdAtMs.get(b.id) ?? 0);

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
    group.sort(byCreatedAt);
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
    group.sort(byCreatedAt);
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
    group.sort(byCreatedAt);
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
    group.sort(byCreatedAt);
    for (let i = 1; i < group.length; i++) {
      keepSet.delete(group[i].id);
      idsToDelete.push(group[i].id);
    }
  }

  // Delete duplicates from the database
  if (idsToDelete.length > 0) {
    log.debug(`[dedup] Removing ${idsToDelete.length} duplicate pending transaction(s)`);
    const { error } = await supabase
      .from('pending_transactions')
      .delete()
      .in('id', idsToDelete);

    if (error) {
      log.error('[dedup] Error deleting duplicates:', error);
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
    log.error('[checkDuplicate] Error fetching transactions:', error);
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
    log.debug(`[checkDuplicate] Hard skip: same-day same-amount match ${exactSameDay.vendor} $${exactSameDay.amount} (${exactSameDay.date})`);
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

  log.debug(`[checkDuplicate] Soft-dup: similar ${closest.vendor} $${closest.amount} (${closest.date}, source=${closest.source || 'unknown'}) but new charge is $${amount}`);
  return {
    isDuplicate: false,
    softDuplicateOfId: closest.id,
    softDuplicateVendor: closest.vendor,
    softDuplicateAmount: Number(closest.amount),
    softDuplicateDate: closest.date,
    softDuplicateSource: closest.source || undefined,
  };
}

/**
 * The user's past settled fills at a station, for sizing a hold placeholder.
 *
 * Best-effort by design: if this query fails or returns nothing the caller
 * falls back to the flat $100 default, so a slow or unavailable database costs
 * accuracy on one row rather than blocking the capture.
 */
async function fetchPriorFuelFills(userId: string, vendor: string): Promise<number[]> {
  try {
    const { data } = await supabase
      .from('transactions')
      .select('id, vendor, amount, date, raw_notification, is_projected')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(200);
    if (!data || data.length === 0) return [];
    return pastFillAmounts(vendor, data as unknown as Transaction[]);
  } catch (e) {
    log.debug('[AI pipeline] Could not load fill history for placeholder sizing:', e);
    return [];
  }
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
  /**
   * True when a learned rule matched well enough that the row was filed
   * without review. The listener uses this to word the capture notification
   * differently — a transaction the user will never be shown should at least
   * say where it went.
   */
  autoAccepted?: boolean;
  /** Reason for rejection if not a transaction or duplicate */
  rejectionReason?: string;
  /** Skip reason */
  skipReason?: 'duplicate_fingerprint' | 'duplicate_vendor_amount' | 'duplicate_manual' | 'duplicate_ai' | 'duplicate_recurring' | 'not_transaction' | 'extraction_failed' | 'needs_review' | 'not_bank_app';
  /**
   * Set when the capture was a fuel pre-authorisation. The stored amount is a
   * placeholder, not what was pumped; `holdAmount` is the round figure the bank
   * announced. The UI asks the user for the real number.
   */
  fuelHold?: { holdAmount: number; placeholderAmount: number; basis: 'median-fill' | 'default' };
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
  /**
   * If the notification was a refund and matched an existing expense, this
   * is the matched expense. The original row is marked refunded=true and
   * NO new transaction is inserted. The UI can show a success toast
   * "refund matched: <vendor> $<amount>".
   */
  refundMatched?: {
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

  // ── Step 0: Banks only ──
  // The last line of defence for "a transaction comes from a bank". The native
  // listener drops non-banks first and the hook drops them again, but this is
  // the one place EVERY path into the ledger passes through, so it is the one
  // that has to be right. Cheap: a set lookup on a string already in hand.
  if (!isBankingApp(input.bankAppId)) {
    log.debug(`[AI pipeline] Ignoring notification from non-banking app: ${input.bankAppId || '(none)'}`);
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'not_bank_app',
      rejectionReason: 'Notification did not come from a banking app',
      bankName: input.bankName,
    };
  }

  const notifTimestamp = input.notificationTimestamp || Date.now();

  // Build the dedup key up-front so the in-flight check can run before
  // any of the expensive async work below.
  const inMemoryKey = buildInMemoryDedupKey(input.bankAppId, input.rawNotification);

  // ── Step 0 (pre): In-flight check ──
  // If another invocation is already processing this exact notification
  // (e.g. the native onListenerConnected scan and the JS useEffect scan
  // both fire at app start, or a scan is in flight when the user taps
  // the manual refresh button), drop the duplicate. This must run BEFORE
  // the TTL cache check below, otherwise the second caller still
  // participates in the work and we double-insert.
  if (!input.forceReprocess && inFlightProcessingKeys.has(inMemoryKey)) {
    log.debug('[AI pipeline] In-flight dedup hit, skipping duplicate invocation');
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'duplicate_fingerprint',
      bankName: input.bankName,
    };
  }

  // Claim the key for the duration of this call. The try/finally below
  // guarantees the key is released on every exit path (success, error,
  // or any of the early returns). Concurrent invocations that arrive
  // while we're still processing will see the key in the set and bail
  // out at the check above.
  inFlightProcessingKeys.add(inMemoryKey);
  try {
    return await processNotificationWithAIImpl(
      userId,
      input,
      availableCategories,
      notifTimestamp,
      inMemoryKey,
    );
  } finally {
    inFlightProcessingKeys.delete(inMemoryKey);
  }
}

/**
 * Internal implementation of processNotificationWithAI. Lives in its own
 * function so the outer wrapper can claim/release the in-flight dedup key
 * around the entire processing pipeline — even though the body has many
 * early returns and a final await on the insert, the finally block in the
 * outer wrapper guarantees the key is released exactly once.
 */
async function processNotificationWithAIImpl(
  userId: string,
  input: NotificationInput,
  availableCategories: { id: string; name: string }[],
  notifTimestamp: number,
  inMemoryKey: string,
): Promise<AIProcessingResult> {
  // Written for every new capture. Reads must ALSO consult inMemoryKey, because
  // captures recorded before this key existed used that form — missing them
  // would re-import a transaction already in the ledger.
  const capturedKey = buildCapturedKey(
    input.bankAppId,
    input.rawNotification,
    input.notificationTimestamp,
  );

  // Tracks a soft-dup match found in Step 4 so the Step 6 insert can
  // surface the warning in the returned result. Cleared on every call.
  let softDupMatch: { id: string; vendor: string; amount: number; date: string } | null = null;

  // ── Step 0: In-memory dedup ──
  // Fast check to prevent the same notification from being processed
  // multiple times during a scan or rapid re-broadcast.
  evictExpiredCacheEntries();
  if (!input.forceReprocess && recentlyProcessedCache.has(inMemoryKey)) {
    log.debug('[AI pipeline] In-memory dedup hit, skipping');
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'duplicate_fingerprint',
      bankName: input.bankName,
    };
  }

  // ── Step 0c: User-learned skip rules ──
  // The user can mark a captured item as "not a transaction" from the
  // <> page. That creates a rule in `notification_rules` and every
  // future notification matching the rule is dropped here, before any
  // parsing. We bump the rule's use_count best-effort (fire-and-forget).
  if (!input.forceReprocess) {
    const matchedRule = await checkNotificationRules(userId, input.rawNotification);
    if (matchedRule) {
      log.debug(`[AI pipeline] Skipped by user rule #${matchedRule.id} (${matchedRule.pattern_type}: "${matchedRule.pattern.slice(0, 50)}...")`);
      // Best-effort: bump the count without blocking the result
      void bumpRuleUseCount(matchedRule.id);
      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationRejected(inMemoryKey);
      return {
        processed: true,
        isTransaction: false,
        skipReason: 'not_transaction',
        rejectionReason: `Skipped by user rule (${matchedRule.pattern_type} match)`,
        bankName: input.bankName,
      };
    }
  }

  // ── Step 0b: Persistent dedup (survives app restarts) ──
  // The in-memory cache above is cleared every time the JS module re-loads
  // (app restart, hot reload). This localStorage-backed check ensures a
  // notification that was already processed is never re-inserted after the
  // user clears it from the <> page and the app is closed/reopened.
  // A CAPTURE is permanent: the row is in the ledger and must never be
  // inserted twice, so forceReprocess deliberately does not bypass this.
  if (isNotificationProcessed(capturedKey) || isNotificationProcessed(inMemoryKey)) {
    log.debug('[AI pipeline] Persistent dedup hit (already captured), skipping');
    // Warm the in-memory cache so subsequent checks in this session are fast
    recentlyProcessedCache.set(inMemoryKey, Date.now());
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'duplicate_fingerprint',
      bankName: input.bankName,
    };
  }

  // A REJECTION is provisional. Its causes are often transient — the AI model
  // still loading, a refund whose expense has not arrived yet, a reworded bank
  // alert — so an explicit rescan (the scan button) is allowed to look again.
  // Rejections also expire on their own; see localNotificationMemory.
  if (!input.forceReprocess && isNotificationRejected(inMemoryKey)) {
    log.debug('[AI pipeline] Previously rejected, skipping (a rescan will retry)');
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
    log.debug('[AI pipeline] Duplicate detected, skipping');
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
    markNotificationRejected(inMemoryKey);
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
  // Declared at function scope so Step 2c (confidence gating) and Step 5c
  // (AI category fallback) below can read the AI result produced here.
  let aiResult: AIExtractionResult | CachedAIResult | null = null;
  const parserConfidence = parsed.confidence ?? 0.5;
  if (parserConfidence < AI_FALLBACK_CONFIDENCE_THRESHOLD) {
    // Check the cache first — same notification text is never re-inferred
    const cached = getCachedAIResult(input.rawNotification);
    if (cached) {
      log.debug(`[AI fallback] cache hit for "${input.rawNotification.slice(0, 40)}..."`);
      aiResult = cached;
    } else {
      try {
        // Feed the user's own confirmed vendor -> category decisions in as
        // few-shot examples. The deterministic override lookup (Step 5a) already
        // short-circuits vendors the user has taught, so the model only ever
        // sees NEW merchants — precedent from similar ones is exactly what it
        // lacks. This is how capture improves with use: flan-t5-small cannot be
        // fine-tuned on-device, but it can be shown how this household sorts
        // things.
        aiResult = await extractWithAI(
          input.rawNotification,
          availableCategories.map(c => c.name),
          collectLearnedExamples(),
        );
        // Persist for next time
        setCachedAIResult(input.rawNotification, {
          isTransaction: aiResult.isTransaction,
          vendor: aiResult.vendor,
          amount: aiResult.amount,
          suggestedCategory: aiResult.suggestedCategory,
          rejectionReason: aiResult.rejectionReason,
          confidence: aiResult.confidence,
          confidenceLabel: aiResult.confidenceLabel,
        });
      } catch (err) {
        // AI failed to load (network, WASM not supported, etc.) — fall
        // through and use the regex result anyway. Better a slightly-wrong
        // extraction than no extraction at all.
        log.warn('[AI fallback] failed, using regex result:', err);
        aiResult = null;
      }
    }
    if (aiResult) {
      if (aiResult.isTransaction && aiResult.vendor && aiResult.amount) {
        log.debug(
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
        log.debug(`[AI fallback] parser=${parserConfidence.toFixed(2)} → AI rejected: ${aiResult.rejectionReason}`);
        recentlyProcessedCache.set(inMemoryKey, Date.now());
        markNotificationRejected(inMemoryKey);
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

  // ── Step 2c: Confidence gating ──
  // If AI is uncertain, route to pending review instead of auto-inserting
  if (aiResult && aiResult.isTransaction && (aiResult.confidence ?? 1) < 0.75) {
    log.debug(`[AI pipeline] Low confidence (${aiResult.confidenceLabel}, ${(aiResult.confidence ?? 0).toFixed(2)}) — routing to review queue`);
    const pendingId = crypto.randomUUID();
    await supabase.from('pending_transactions').insert({
      id: pendingId,
      user_id: userId,
      extracted_vendor: aiResult.vendor,
      extracted_amount: aiResult.amount,
      suggested_category: aiResult.suggestedCategory,
      confidence: aiResult.confidence,
      raw_notification: (input.rawNotification || '').slice(0, 4000),
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    markNotificationProcessed(capturedKey);
    recentlyProcessedCache.set(inMemoryKey, Date.now());
    return {
      processed: true,
      isTransaction: true,
      vendor: aiResult.vendor,
      amount: aiResult.amount,
      skipReason: 'needs_review',
      rejectionReason: `AI confidence too low (${aiResult.confidenceLabel})`,
      bankName: input.bankName,
    };
  }

  // Use the deterministic extraction result unless it failed ('Unknown'), in which
  // case fall back to whatever the native plugin extracted from the notification title.
  const extractedVendor = (parsed.vendorDisplay && parsed.vendorDisplay !== 'Unknown')
    ? parsed.vendorDisplay
    : null;
  const vendor = extractedVendor || input.fallbackVendor || null;
  // Other names this same merchant answers to — today, the name with its
  // payment-processor prefix still attached ("Google Youtubepremium" for a
  // charge the parser reduced to "Youtubepremium"). Used for matching learned
  // rules and for recognising a charge already on the books; never displayed
  // and never stored. See ParsedNotification.vendorAliases.
  const vendorAliases = (parsed.vendorAliases || []).filter(
    (name): name is string => !!name && name !== vendor,
  );
  const rawAmount = parsed.amount ?? input.fallbackAmount ?? 0;
  // Refunds are NOT stored as separate negative-amount rows. They are
  // applied to the original expense via the refunded=true flag (see
  // Step 3a below). Income notifications are rejected entirely (no row).
  const amount = rawAmount;

  // ── Step 3a: Refund handling — strike through the original expense ──
  // If the parser detected a refund phrase and we have a vendor + amount,
  // we look for a matching expense in the same user's transaction history
  // (exact vendor + exact amount, same budget, within
  // REFUND_MATCH_WINDOW_DAYS). If a match is found we set refunded=true
  // on the original row and return without inserting a new transaction.
  // The original row's amount is unchanged; the UI applies strikethrough
  // and the budget reduce excludes the refunded row from the spent total.
  if (parsed.isRefund && vendor && rawAmount > 0) {
    const refundWindowStart = new Date(
      notifTimestamp - REFUND_MATCH_WINDOW_DAYS * MS_PER_DAY
    ).toISOString().slice(0, 10);
    const refundWindowEnd = new Date(
      notifTimestamp + REFUND_MATCH_WINDOW_DAYS * MS_PER_DAY
    ).toISOString().slice(0, 10);
    const { data: refundCandidates } = await supabase
      .from('transactions')
      .select('id, vendor, amount, date, budget, refunded')
      .eq('user_id', userId)
      .gte('date', refundWindowStart)
      .lte('date', refundWindowEnd)
      .eq('refunded', false)
      .gt('amount', 0)
      .eq('is_projected', false);

    if (refundCandidates && refundCandidates.length > 0) {
      const mapped: any[] = refundCandidates.map((row: any) => ({
        id: row.id,
        vendor: row.vendor,
        amount: Number(row.amount),
        date: row.date,
        budget_id: row.budget || '',
        is_projected: false,
        refunded: row.refunded === true,
      }));
      let match = findMatchingExpense(
        { vendor, amount: rawAmount, date: new Date(notifTimestamp).toISOString().slice(0, 10), budget_id: '' },
        mapped,
      );
      // AI fallback: try semantic vendor matching for refunds with different names
      if (!match && mapped.length > 0) {
        const aiMatchId = await aiFindRefundMatch(vendor, Math.abs(rawAmount), mapped.map(c => ({
          id: c.id,
          vendor: c.vendor,
          amount: Number(c.amount),
          date: String(c.date).slice(0, 10),
        })));
        if (aiMatchId) {
          match = mapped.find((c: any) => c.id === aiMatchId) || null;
          if (match) {
            log.debug(`[AI pipeline] Refund matched via AI: ${match.vendor} $${match.amount}`);
          }
        }
      }
      if (match) {
        const { error: refundUpdateError } = await supabase
          .from('transactions')
          .update({ refunded: true })
          .eq('id', match.id);
        if (refundUpdateError) {
          log.error('[AI pipeline] Failed to mark expense refunded:', refundUpdateError);
        } else {
          log.debug(
            `[AI pipeline] Refund matched: struck through ${match.vendor} $${match.amount} (${match.date})`,
          );
          recentlyProcessedCache.set(inMemoryKey, Date.now());
          markNotificationProcessed(capturedKey);
          return {
            processed: true,
            isTransaction: true,
            vendor,
            amount: rawAmount,
            bankName: input.bankName,
            // Surfaced to the parsing UI as a successful refund match.
            refundMatched: {
              id: match.id,
              vendor: match.vendor,
              amount: Number(match.amount),
              date: String(match.date).slice(0, 10),
            },
          };
        }
        // Fall through to the regular insert path if the update failed
        // (rare; the user will see the refund twice but it won't block).
      } else {
        log.debug(
          `[AI pipeline] Refund ${vendor} $${rawAmount} has no matching expense in ${REFUND_MATCH_WINDOW_DAYS}-day window; skipping`,
        );
        recentlyProcessedCache.set(inMemoryKey, Date.now());
        markNotificationRejected(inMemoryKey);
        return {
          processed: true,
          isTransaction: false,
          vendor,
          amount: rawAmount,
          bankName: input.bankName,
          skipReason: 'not_transaction',
          rejectionReason: `Refund has no matching expense within ${REFUND_MATCH_WINDOW_DAYS} days`,
        };
      }
    } else {
      log.debug(
        `[AI pipeline] Refund ${vendor} $${rawAmount} has no candidate expenses; skipping`,
      );
      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationRejected(inMemoryKey);
      return {
        processed: true,
        isTransaction: false,
        vendor,
        amount: rawAmount,
        bankName: input.bankName,
        skipReason: 'not_transaction',
        rejectionReason: `Refund has no matching expense within ${REFUND_MATCH_WINDOW_DAYS} days`,
      };
    }
  }

  // ── Step 3b: Reject if no vendor could be identified ──
  if (!vendor) {
    const reason = 'No vendor name found in notification';
    log.debug('[AI pipeline] Skipped: no vendor identified');
    recentlyProcessedCache.set(inMemoryKey, Date.now());
    markNotificationRejected(inMemoryKey);
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

  /**
   * Is `existingName` the same merchant as the one we just captured?
   *
   * Checks every name the capture answers to, not just the polished one. A
   * recurring "Google" on the books and an incoming "GOOGLE *YOUTUBEPREMIUM"
   * are the same merchant, but only the alias makes that visible — the parser
   * hands us "Youtubepremium", which shares nothing with "Google".
   */
  const matchesCapturedVendor = (existingName: string | null | undefined): boolean => {
    const existing = String(existingName || '');
    if (!existing) return false;
    if (normalizeVendorForDedup(existing) === normalizedVendor) return true;
    if (fuzzyVendorMatch(existing, vendor)) return true;
    return vendorAliases.some((alias) => fuzzyVendorMatch(existing, alias));
  };
  const todayMs = parseLocalDate(today).getTime();
  const step4WindowStart = new Date(todayMs - RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
  const step4WindowEnd = new Date(todayMs + RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);

  // Projection is the superset of what step 4 and step 5b need, so step 5b
  // can reuse this result instead of re-issuing the identical query (same
  // user, same +/-3 day window). Nothing between the two steps writes to
  // `transactions`; the post-insert race check in step 6b deliberately stays
  // a fresh query.
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('id, vendor, amount, type, date, recur, source')
    .eq('user_id', userId)
    .gte('date', step4WindowStart)
    .lte('date', step4WindowEnd);

  if (existingTx && existingTx.length > 0) {
    // Single permissive pass: any same-vendor match in the window is a
    // soft-dup. The only hard-skip is same-day same-amount, which is
    // almost certainly a re-broadcast of the same notification.
    const sameDaySameAmount = existingTx.find((tx) => {
      if (tx.date !== today) return false;
      if (Math.abs(Number(tx.amount) - amount) >= AMOUNT_TOLERANCE) return false;
      // Exact normalized equality first, then fuzzy. Two apps often report one
      // purchase in different wordings ("Staples" vs "Staples #462 Ca"), and
      // exact equality alone let both through as separate rows. Same day AND
      // same amount AND a similar vendor is a double-report, not two
      // coincidental purchases.
      return matchesCapturedVendor(tx.vendor);
    });

    if (sameDaySameAmount) {
      // True re-broadcast of the same notification — hard skip. The
      // in-memory cache above should catch this first, but we keep this
      // as a belt-and-suspenders.
      log.debug(`[AI pipeline] Hard skip: same-day same-amount match ${sameDaySameAmount.vendor} $${sameDaySameAmount.amount} (${sameDaySameAmount.date})`);
      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationProcessed(capturedKey);
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
    //
    // Matched the same way as the hard skip above. It used to demand exact
    // equality of the normalised names while the hard skip matched fuzzily,
    // so a charge whose bank wording differs from the recorded one — the
    // common case, and the whole reason the fuzzy matcher exists — produced
    // no warning at all.
    const allMatches = existingTx.filter((tx) => matchesCapturedVendor(tx.vendor));
    if (allMatches.length > 0) {
      const sameAmount = allMatches.find((tx) => Math.abs(Number(tx.amount) - amount) < AMOUNT_TOLERANCE);
      const closest = sameAmount || allMatches.sort((a, b) =>
        Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount)
      )[0];
      log.debug(`[AI pipeline] Soft-dup: similar ${closest.vendor} $${closest.amount} on ${closest.date} (source=${closest.source || 'unknown'}), but new charge is $${amount.toFixed(2)}`);
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
  // How completely the matched rule explains the incoming vendor name, 0..1.
  // Only set by Step 5a — a localStorage or heuristic match (5b/5c) is not
  // evidence the user ever taught us this vendor, so it stays 0 and can never
  // reach the auto-accept threshold.
  let overrideMatchConfidence = 0;
  // True when the incoming vendor matches learned rules pointing at DIFFERENT
  // categories. The capture must then go to review for the user to pick, and
  // must never be auto-accepted. See the note in step 5a.
  let overrideRuleConflict = false;

  // 5a: Check server-side overrides table.
  // Schema: overrides(id, user_id, proper_name, match_key, match_type, category_id, updated_at).
  // Lookup priority:
  //   1. match_key (normalized vendor slug) with respect to match_type:
  //        - 'exact'    : incoming vendorKey === override.match_key
  //        - 'prefix'   : incoming vendorKey starts with override.match_key
  //        - 'contains' : incoming vendorKey contains override.match_key
  //      The most recently updated row wins (ORDER BY updated_at DESC).
  //   2. proper_name ilike — fallback for legacy rows that pre-date match_key.
  if (vendor) {
    const vendorKey = toMatchKey(vendor);
    // The keys the alias names reduce to, e.g. "googleyoutubepremium" for a
    // charge whose polished name is only "Youtubepremium". Tried in order,
    // and only after the polished name has found nothing — a rule written
    // against the name the app shows must always win over one written against
    // a name it merely recognises.
    const aliasKeys = vendorAliases
      .map(toMatchKey)
      .filter((key) => key && key !== vendorKey);
    // Which key actually found the rule, so the confidence score below is
    // computed against the string the match was really made on.
    let matchedKey = vendorKey;

    // 1) match_key lookup (match_type aware)
    let overrideRows: any[] | null = null;
    if (vendorKey) {
      // ALL of the user's rules, not a recent slice of them.
      //
      // This asked for the 20 most recently updated and matched among those.
      // The matching happens here rather than in the query — the stored keys
      // are not reliably lowercase, so the comparison has to be
      // case-insensitive, which a server-side filter on this column is not.
      // Twenty was fine when a household had a handful of rules. At a hundred
      // and fourteen it meant a rule taught months ago was simply not in the
      // room: Costco → Groceries had matched every Costco run for a year and
      // then quietly stopped, and the charge landed in Other with no sign that
      // a rule existed. The list is small data — a few hundred short rows —
      // and this runs a few times a day, so fetching all of it costs nothing
      // that matters.
      const { data } = await supabase
        .from('overrides')
        .select('category_id, proper_name, match_key, match_type, updated_at')
        .eq('user_id', userId)
        .not('match_key', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(MAX_VENDOR_RULES);
      const allRows = data || [];
      // Filter in-memory by match_type semantics. Most-recent-wins is
      // already guaranteed by the ORDER BY + first-match in loop.
      const rulesMatching = (key: string) => allRows.filter((row: any) => {
        const mk = (row.match_key || '').toLowerCase();
        if (!mk) return false;
        const mt = row.match_type || 'exact';
        if (mt === 'exact') return key === mk;
        if (mt === 'prefix') return key.startsWith(mk);
        if (mt === 'contains') return key.includes(mk);
        return false;
      });

      let matching = rulesMatching(vendorKey);
      // Nothing under the polished name — try the merchant's other names before
      // giving up. This is what keeps a rule taught as "googleyoutubepremium"
      // working after the parser started stripping the "GOOGLE *" prefix off
      // the name it extracts.
      for (const aliasKey of aliasKeys) {
        if (matching.length > 0) break;
        matching = rulesMatching(aliasKey);
        if (matching.length > 0) {
          matchedKey = aliasKey;
          log.debug(`[AI pipeline] No rule for "${vendor}"; matched on alias key "${aliasKey}"`);
        }
      }

      // A vendor may legitimately have more than one rule: Walmart→Groceries
      // and Walmart→Other are both real purchases at the same merchant. When
      // that happens the app CANNOT know which one this purchase was, so it
      // must ask rather than guess.
      //
      // This used to be `.slice(0, 1)` — most-recently-updated wins — which
      // silently picked one and, worse, handed it a full confidence score, so
      // auto-accept filed it without the user ever seeing it. Whichever rule
      // they happened to teach last would quietly swallow every purchase at
      // that merchant.
      //
      // Leaving `categoryId` unset routes the capture to review. The review UI
      // recomputes the candidate categories from the overrides it has already
      // loaded, so nothing extra needs persisting.
      const distinctCategories = new Set(
        matching.map((row: any) => String(row.category_id || '').toLowerCase()),
      );
      overrideRuleConflict = distinctCategories.size > 1;
      overrideRows = overrideRuleConflict ? [] : matching.slice(0, 1);

      if (overrideRuleConflict) {
        log.debug(
          `[AI pipeline] ${vendor} matches ${distinctCategories.size} rules ` +
          `(${[...distinctCategories].join(', ')}) — routing to review instead of auto-filing`,
        );
      }
    }

    // 2) proper_name ilike fallback
    //
    // Skipped entirely on a conflict. Otherwise the fallback would find one of
    // the very rules we just decided were ambiguous and re-apply it with
    // confidence 1 (`matchedByProperName` scores as exact by construction),
    // reinstating the silent auto-file this change exists to prevent.
    let matchedByProperName = false;
    if (!overrideRuleConflict && (!overrideRows || overrideRows.length === 0)) {
      // Same order as the match_key lookup: the polished name first, the
      // merchant's other names only if it finds nothing.
      for (const name of [vendor, ...vendorAliases]) {
        const { data } = await supabase
          .from('overrides')
          .select('category_id, proper_name, match_key')
          .eq('user_id', userId)
          .ilike('proper_name', name)
          .order('updated_at', { ascending: false })
          .limit(1);
        if (data && data.length > 0) {
          overrideRows = data;
          matchedByProperName = true;
          break;
        }
      }
    }

    if (overrideRows && overrideRows.length > 0) {
      const row = overrideRows[0];
      const overrideBudgetName = row.category_id as string; // e.g. 'Groceries'
      const overrideCat = availableCategories.find(
        (c) => c.name.toLowerCase() === (overrideBudgetName || '').toLowerCase(),
      );
      if (overrideCat) {
        categoryId = overrideCat.id;
        categoryName = overrideCat.name;
        // Use the stored proper_name as the display vendor if available
        if (row.proper_name) {
          displayVendor = row.proper_name;
        }
        // Score the match for auto-accept. `ilike proper_name` is a whole-name
        // comparison, so it is exact by construction; the match_key path is
        // scored by how much of the incoming name the rule accounts for.
        overrideMatchConfidence = matchedByProperName
          ? 1
          : scoreVendorMatch(matchedKey, (row.match_key || '').toLowerCase(), row.match_type || 'exact');
        log.debug(`[AI pipeline] overrides match: ${vendor} → ${categoryName} (match_type=${row.match_type || 'exact'}, confidence=${overrideMatchConfidence.toFixed(2)})`);
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

    // Same fallback as the server rules: the merchant's other names, tried
    // only after its polished one comes up empty.
    if (!vendorMapEntry) {
      for (const aliasKey of vendorAliases.map(toMatchKey)) {
        if (!aliasKey) continue;
        vendorMapEntry = getVendorMapEntry(aliasKey);
        if (vendorMapEntry) break;
      }
    }

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
        log.debug(`[AI pipeline] vendorMap fuzzy match: "${parsed.vendorDisplay}" → "${vendorMapEntry.vendor_display}" (key=${bestKey})`);
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

  // 5c: Fallback category — try AI suggestion first, then "Other"
  if (!categoryId && availableCategories.length > 0) {
    const aiSuggested = (aiResult as any)?.suggestedCategory || (parsed as any).suggestedCategory;
    if (aiSuggested) {
      const matched = availableCategories.find(
        c => c.name.toLowerCase() === aiSuggested.toLowerCase(),
      );
      if (matched) {
        categoryId = matched.id;
        categoryName = matched.name;
        log.debug(`[AI pipeline] AI suggested category: ${categoryName}`);
      }
    }

    // Offline merchant-descriptor signal (lib/merchantCategorySignals.ts).
    //
    // Competes with "Other" — never with a category the model actually chose.
    // Note the second half of the condition: a suggestion of "Other" resolves
    // to a real categoryId above, but it is not an answer, it is the same shrug
    // the fallback below gives. Gating on `!categoryId` alone would skip this
    // for exactly the captures it exists to rescue.
    //
    // Reads the raw notification as well as the vendor because the strongest
    // tell — the TST*/Toast processor prefix — is stripped out of the display
    // name by polishVendor before it ever reaches here.
    //
    // `overrideMatchConfidence` is deliberately left at 0: a descriptor token
    // is a decent guess, not something the user taught us, so this can suggest
    // a category but can never clear the auto-accept threshold and file money
    // without review.
    if (!categoryId || (categoryName || '').toLowerCase() === 'other') {
      const signal = detectMerchantSignal(`${vendor || ''} ${input.rawNotification || ''}`);
      const signalCat = signal ? resolveSignalCategory(signal, availableCategories) : null;
      if (signal && signalCat) {
        categoryId = signalCat.id;
        categoryName = signalCat.name;
        log.debug(`[AI pipeline] merchant signal ${signal.kind} (${signal.evidence}) → ${categoryName}`);
      }
    }

    if (!categoryId) {
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
      log.debug(`[AI pipeline] Fallback category: ${categoryName}`);
    }
  }

  if (!categoryId) {
    log.error('[AI pipeline] No category available for transaction');
    return {
      processed: true,
      isTransaction: true,
      vendor,
      amount,
      rejectionReason: 'No budget category available',
      bankName: input.bankName,
    };
  }

  // ── Step 5b: The charge is already on the books as a recurring one ──
  //
  // A subscription is recorded twice, by two different mechanisms: the
  // recurring machinery posts the month's occurrence on its due date, and then
  // the bank announces the real charge a day or two later and the capture
  // pipeline records it again. One subscription, two rows, and the month is
  // wrong by the amount.
  //
  // Everything above this point failed to see it. The hard skip in step 4 only
  // fires on the SAME DAY, and a due date is a guess that lands a day or two
  // off; and until the alias matching added above, "Google" and
  // "GOOGLE *YOUTUBEPREMIUM" did not even look like the same merchant.
  //
  // So this is the one place that treats a recurring row as authoritative:
  // when the same charge is already recorded as recurring, the capture does
  // not become a second row. It is recorded ON that row instead — the bank's
  // own wording, kept so the charge can still be traced back to the
  // notification that confirmed it.
  //
  // Deliberately narrower than the soft-dup above: only recurring rows, and
  // only an amount matching to the cent (isSameCharge). Two ordinary purchases
  // at one merchant in the same week are real and both must survive; a
  // subscription billing twice in three days for the identical amount is not.
  const recurringMatch = (existingTx || []).find((tx) => {
    const txRecur = (tx.recur || '').toLowerCase();
    const isRecurringRow =
      txRecur === 'monthly' || txRecur === 'biweekly' || tx.source === 'executor';
    if (!isRecurringRow) return false;
    // Every name this capture answers to, including the one the matched rule
    // renamed it to — that is usually the name the recurring row carries.
    return [displayVendor, vendor, ...vendorAliases].some((name) =>
      isSameCharge(
        { vendor: name, amount, date: today },
        { vendor: tx.vendor, amount: Number(tx.amount), date: tx.date },
      ),
    );
  });

  if (recurringMatch) {
    log.debug(
      `[AI pipeline] Already recorded as a recurring charge: ${recurringMatch.vendor} ` +
      `$${recurringMatch.amount} on ${recurringMatch.date} (${recurringMatch.id}, ` +
      `source=${recurringMatch.source || 'unknown'}) — recording the notification on it ` +
      `instead of inserting a second row`,
    );

    // Best-effort. The point of the skip is that there is only one row; failing
    // to attach the bank's wording to it costs traceability, not correctness,
    // so it must not turn into a duplicate insert.
    const { error: attachError } = await supabase
      .from('transactions')
      .update({ raw_notification: (input.rawNotification || '').slice(0, 4000) })
      .eq('id', recurringMatch.id);
    if (attachError) {
      log.warn('[AI pipeline] Could not attach the notification to the recurring row:', attachError);
    }

    recentlyProcessedCache.set(inMemoryKey, Date.now());
    markNotificationProcessed(capturedKey);
    return {
      processed: true,
      isTransaction: true,
      vendor: formatVendorName(displayVendor),
      amount,
      categoryId: categoryId || undefined,
      categoryName: categoryName || undefined,
      skipReason: 'duplicate_recurring',
      rejectionReason: 'Already recorded as a recurring charge',
      bankName: input.bankName,
      softDuplicateOf: {
        id: recurringMatch.id,
        vendor: recurringMatch.vendor,
        amount: Number(recurringMatch.amount),
        date: recurringMatch.date,
      },
    };
  }

  // ── Step 6: Insert transaction with 'AI' label ──
  const transactionId = crypto.randomUUID();
  const finalVendorName = formatVendorName(displayVendor);

  // ── Fuel pre-authorisation ──
  // A station announces a round hold ($150, $250, sometimes a $1 ping) and
  // then, when the fill settles at $71.43, often sends nothing. Storing the
  // hold means the month is wrong by the difference, permanently and
  // invisibly. So the row carries a placeholder instead — the user's own median
  // fill at this station when we have the history for one — is never
  // auto-filed, and asks for the real number in Review.
  //
  // Detected here rather than earlier on purpose: every duplicate check above
  // compares against the amount the BANK sent, and substituting sooner would
  // make two separate fills at the same station on the same day look like one
  // notification arriving twice. See lib/fuelHold.ts.
  //
  // The shape test runs first and costs two regex matches. Only a capture that
  // already looks like a hold is worth a round-trip for the user's fill history,
  // which keeps the added query off the path of every ordinary purchase.
  let priorFills: number[] = [];
  if (isHoldAmount(amount) && isFuelMerchant(`${finalVendorName} ${input.rawNotification || ''}`)) {
    priorFills = await fetchPriorFuelFills(userId, finalVendorName);
  }
  const fuelHold = detectFuelHold({
    vendor: finalVendorName,
    rawText: input.rawNotification,
    amount,
    priorFills,
  });
  const storedAmount = fuelHold ? fuelHold.placeholderAmount : amount;
  if (fuelHold) {
    log.debug(
      `[AI pipeline] Fuel hold at ${finalVendorName}: bank said $${fuelHold.holdAmount}, ` +
      `storing $${storedAmount} (${fuelHold.basis}) pending the real amount`,
    );
  }

  // Claim this purchase before inserting. Two apps reporting the same charge
  // arrive as different notifications, so every guard above lets both through;
  // this is the first point where we know enough to recognise them as one
  // purchase. Whoever claims it inserts, the other backs off.
  const purchaseKey = `${userId}|${today}|${storedAmount.toFixed(2)}|${normalizeVendorForDedup(finalVendorName)}`;
  if (!input.forceReprocess && !claimPurchase(purchaseKey)) {
    log.debug(`[AI pipeline] Purchase already being inserted by a parallel capture: ${finalVendorName} $${storedAmount}`);
    recentlyProcessedCache.set(inMemoryKey, Date.now());
    markNotificationProcessed(capturedKey);
    return {
      processed: false,
      isTransaction: false,
      vendor: finalVendorName,
      amount: storedAmount,
      bankName: input.bankName,
      skipReason: 'duplicate_fingerprint',
    };
  }
  // AI/parser confidence for this capture. Rows reach Step 6 only after the
  // Step 2c gate, so this is the model's (or regex's) confidence in the
  // extraction; the capture-review UI shows it as a meter.
  const captureConfidence = aiResult?.confidence ?? parsed.confidence ?? null;

  // ── Auto-accept ──
  // Opt-in. When a learned rule explains the incoming vendor name well enough,
  // the row is filed straight into its budget under the rule's proper name and
  // never appears in the review list.
  //
  // Gated on the OVERRIDE match score, not the AI's extraction confidence.
  // Those measure different things: captureConfidence says "I read $12.40 at
  // TIM HORTONS correctly", which tells you nothing about whether TIM HORTONS
  // belongs in Groceries. Only a rule the user wrote themselves justifies
  // skipping their review, so 5b/5c matches leave overrideMatchConfidence at 0
  // and always go to the queue.
  //
  // A fuel hold can never be auto-filed, however well the user's rule matches.
  // Auto-accept means the row is never shown, and the whole point of a
  // placeholder is that somebody has to replace it with the real number.
  const autoAccepted = !fuelHold && shouldAutoAccept({
    enabled: input.autoAcceptKnownVendors === true,
    confidence: overrideMatchConfidence,
    hasCategory: !!categoryId,
  });
  if (autoAccepted) {
    log.debug(
      `[AI pipeline] Auto-accepting ${finalVendorName} → ${categoryName} ` +
      `(rule confidence ${(overrideMatchConfidence * 100).toFixed(0)}%)`,
    );
  }

  const insertRow: Record<string, unknown> = {
    id: transactionId,
    user_id: userId,
    vendor: finalVendorName,
    // Placeholder rather than the announced figure when this is a fuel hold.
    // The raw notification below still carries what the bank actually said,
    // plus a marker recording the substitution, so nothing is lost.
    amount: storedAmount,
    date: today,
    // Use the same column names as toSupabaseTransaction (the known-working manual insert path)
    budget: categoryName || 'Other',
    type: 'Automatic',
    // Mark notification-inserted rows so the dedup logic can distinguish
    // them from executor-spawned rows of the same vendor+amount.
    source: 'notification',
    recur: parsed.recurrence,
    is_projected: false,
    // Store the original raw notification text so the <> page reviewer
    // can show "what did the parser see?" — and the user can correct
    // the vendor from the source. Truncate to 4KB to avoid hitting
    // any text column limits.
    raw_notification: (
      fuelHold
        // Record the substitution in the row itself. This is what lets the UI
        // recognise a placeholder later without a schema migration, and it
        // keeps the bank's original wording alongside what we stored instead.
        ? withFuelHoldMarker((input.rawNotification || '').slice(0, 3900), fuelHold)
        : (input.rawNotification || '').slice(0, 4000)
    ),
    confidence: captureConfidence,
    // Only set when filing on arrival, so it never enters the review queue.
    // Omitted otherwise so a normal capture's insert keeps exactly the shape it
    // had before auto-accept existed — the column's own default is false, and
    // naming it unconditionally would make every insert depend on it.
    //
    // Not deleted or hidden: an auto-filed row lands in history and counts
    // toward the budget exactly like one the user accepted by hand.
    ...(autoAccepted ? { caught_cleared: true } : {}),
  };
  let { error: txError } = await supabase.from('transactions').insert(insertRow);
  // Tolerate DBs where the confidence column hasn't been migrated yet: retry
  // once without it rather than dropping the whole capture.
  if (txError && /confidence/i.test(txError.message || '')) {
    const { confidence: _omit, ...withoutConfidence } = insertRow;
    ({ error: txError } = await supabase.from('transactions').insert(withoutConfidence));
  }

  if (txError) {
    log.error('[AI pipeline] Error inserting transaction:', txError);
    return {
      processed: true,
      isTransaction: true,
      vendor: finalVendorName,
      amount,
      rejectionReason: 'Failed to save transaction',
      bankName: input.bankName,
    };
  }

  // ── Step 6b: Post-insert race-recovery ──
  // The in-memory key + in-flight set + pre-insert DB check above catch
  // most re-broadcasts, but there's still a race window: if two
  // notifications for the same charge arrive in the same instant (e.g.
  // both the native `onListenerConnected` scan and the JS useEffect's
  // `scanActiveNotifications` fire at app start), both invocations can
  // pass Step 1's pre-insert check BEFORE either has actually written
  // its row. They then both proceed to Step 6 and both insert — the
  // exact double-capture bug the user is hitting.
  //
  // Recovery: immediately after our insert completes, re-query the
  // transactions table for any OTHER row matching our vendor + amount
  // + date. If we find one, we're the loser of the race — the other
  // row was inserted between our Step 1 check and our Step 6 insert
  // (or by a parallel invocation that won the in-flight check). Roll
  // back our insert so the user only sees the winner.
  //
  // The `created_at` order isn't strictly required here — the pre-
  // existing row is the winner by definition (it existed before ours)
  // — but we use it for clearer log output. We compare vendor after
  // normalization so that two surface forms of the same merchant
  // (e.g. "AMZN MKTP" vs "Amazon Prime") are correctly recognized
  // as duplicates.
  const { data: raceCheck } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date, created_at')
    .eq('user_id', userId)
    .eq('date', today)
    .eq('amount', storedAmount)
    .neq('id', transactionId);

  if (raceCheck && raceCheck.length > 0) {
    const normalizedOur = normalizeVendorForDedup(finalVendorName);
    const race = raceCheck.find(
      (row) => normalizeVendorForDedup(row.vendor) === normalizedOur,
    );
    if (race) {
      log.warn(
        `[AI pipeline] ⚠️ Race-recovery: rolling back our insert of ${finalVendorName} $${storedAmount} ` +
        `(${transactionId}) — duplicate of ${race.id} (${race.vendor} $${race.amount}, created ${race.created_at})`,
      );
      const { error: rollbackError } = await supabase
        .from('transactions')
        .delete()
        .eq('id', transactionId);
      if (rollbackError) {
        log.error('[AI pipeline] Race-recovery rollback failed:', rollbackError);
        // We couldn't roll back, so the user will see both rows. Log
        // loudly so we know to investigate.
      }
      // Still mark as processed so we don't keep retrying.
      markNotificationProcessed(capturedKey);
      recentlyProcessedCache.set(inMemoryKey, Date.now());
      return {
        processed: true,
        isTransaction: true,
        vendor: finalVendorName,
        amount: storedAmount,
        skipReason: 'duplicate_ai' as const,
        rejectionReason: 'Duplicate detected after insert (race-recovery rollback)',
        bankName: input.bankName,
        // Surface the winning row as the soft-dup so the UI can
        // show the "possible duplicate" badge.
        softDuplicateOf: {
          id: race.id,
          vendor: race.vendor,
          amount: Number(race.amount),
          date: race.date,
        },
      };
    }
  }
  releasePurchase(purchaseKey);

  releasePurchase(purchaseKey);
  log.debug(`[AI pipeline] Transaction saved: ${finalVendorName} $${storedAmount} → ${categoryName}`);
  // An auto-accepted row is already filed, so flagging it "needs a look" would
  // be a contradiction — and the review-queue badge would count a row the list
  // never shows.
  if (!autoAccepted) {
    addToReviewQueue(transactionId);
  }

  // Persist to localStorage so this notification is never re-processed
  // after app restart (the in-memory cache below is cleared on reload).
  markNotificationProcessed(capturedKey);
  recentlyProcessedCache.set(inMemoryKey, Date.now());

  return {
    processed: true,
    isTransaction: true,
    transactionId,
    vendor: finalVendorName,
    amount: storedAmount,
    categoryId,
    categoryName: categoryName || undefined,
    autoAccepted,
    fuelHold: fuelHold || undefined,
    bankName: input.bankName,
    // Surface the soft-dup warning from Step 4 so the UI can show a
    // "possible duplicate" badge. The transaction is still saved — the
    // user said they prefer seeing both rows over missing a charge.
    softDuplicateOf: softDupMatch || undefined,
  };
}
