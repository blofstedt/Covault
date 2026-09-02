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
import { aiFindRefundMatch, aiLooksLikeIgnoredAlert } from './aiExtractor';
import type { LearnedVendorExample } from './aiExtractor';
import { checkNotificationRules, bumpRuleUseCount, listIgnoredPatterns } from './notificationRules';
import { candidatePatternsFor } from './notificationShape';
import { getLocalToday, parseLocalDate, toLocalIsoDay } from './dateUtils';
import { extractWithAI, type AIExtractionResult } from './aiExtractor';
import { detectMerchantSignal, resolveSignalCategory } from './merchantCategorySignals';
import type { PendingTransaction, Transaction } from '../types';
import { scoreVendorMatch, shouldAutoAccept, toMatchKey } from './vendorMatchConfidence';
import { amountsAgree, daysApart, isSameCharge } from './duplicateCharge';
import { findRecurringScheduleMatch, type RecurringChargeRow } from './recurringSchedule';
import {
  allowedSourceKind,
  isCaptureSourceAllowed,
  type CaptureSourceKind,
} from './captureSources';
import { parseEmailAlert } from './emailNotification';
import {
  hasPairedEmail,
  isBankSourcedRow,
  isEmailSourcedRow,
  isOtherAppSameTap,
  withCaptureMarker,
  withEmailPairedMarker,
} from './captureChannel';
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
 * Ceiling on the recurring rows loaded when checking whether a capture is a
 * subscription the app already knows about.
 *
 * A runaway guard like MAX_VENDOR_RULES, not a page size. A household has a
 * handful of subscriptions, plus one executor-spawned row per month per
 * subscription — a few hundred rows after years of use. Newest first, so if
 * this ever truncates it drops the oldest history rather than the templates
 * still in force.
 */
const MAX_RECURRING_ROWS = 500;

/**
 * Below this confidence, the regex parser is considered a guess and the
 * pipeline falls back to the on-device AI model (extractWithAI). The AI
 * model is slower to load but produces better extractions on ambiguous
 * notifications. Above this threshold we trust the regex to keep things
 * fast for the common case.
 */
const AI_FALLBACK_CONFIDENCE_THRESHOLD = 0.65;

/**
 * Below this AI confidence, the capture still goes into the ledger but must
 * never be filed without the user seeing it.
 *
 * The row lands in Review like any other capture — that list exists precisely
 * for the ones the app is unsure about, and the review card renders the stored
 * confidence as a meter. What the threshold blocks is auto-accept: a learned
 * rule that says "Tim Hortons → Coffee" is no reason to file a charge whose
 * merchant name the model only half-read.
 */
const LOW_CONFIDENCE_REVIEW_THRESHOLD = 0.75;

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
 * Which of several rows for the same charge is the one to keep.
 *
 * Used by the post-insert race check, where two invocations that inserted the
 * same purchase at the same moment each have to decide whether to withdraw.
 * The rule has one job: both sides must reach the same answer from the same
 * rows, so that exactly one row survives. Asking "does another row exist?"
 * does not have that property — both sides answer yes and both withdraw,
 * which deletes the purchase entirely.
 *
 * Oldest wins, because a row that was already there is the one the user may
 * have seen. `created_at` comes back from Postgres with microsecond precision
 * so a genuine tie is vanishingly unlikely, but ids break it if it happens,
 * and any total order will do as long as it is the same one on both sides.
 */
export function pickSurvivingCharge<T extends { id: string; created_at: string }>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null;
  const rank = (row: T) => `${row.created_at}|${row.id}`;
  return rows.reduce((best, row) => (rank(row) < rank(best) ? row : best));
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
  /**
   * Which route the alert arrived by. Absent means 'bank', which is what every
   * capture was before mail was a source — and the safe reading, because the
   * email rules only ever add restrictions.
   */
  channel?: CaptureSourceKind;
  /**
   * Notification body, kept apart from the title.
   *
   * For a mail app the title is the SENDER and the body is subject-plus-snippet.
   * The two have to arrive separately: the sender must be vetted before the body
   * is read at all, and a concatenated string cannot be split back apart.
   */
  notificationBody?: string;
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

  // ── Check pending_transactions table ──
  // Use the notification_timestamp column (bigint ms) for a tighter match.
  const windowStartMs = notificationTimestamp - 5 * MS_PER_MINUTE;
  const windowEndMs   = notificationTimestamp + 5 * MS_PER_MINUTE;

  // Both reads are issued together and neither depends on the other's answer.
  // They used to run one after the other, which cost two round trips on a
  // phone waking its radio — and the second one is a table that does not exist
  // here, so a capture arriving with the app closed waited out a 404 before it
  // could appear. The order the ANSWERS are considered below is unchanged:
  // transactions first, then the pending queue.
  const [{ data: txRows }, { data: ptRows }] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, vendor, amount, date')
      .eq('user_id', userId)
      .gte('date', startDateStr)
      .lte('date', endDateStr),
    supabase
      .from('pending_transactions')
      .select('id, extracted_vendor, extracted_amount, notification_timestamp')
      .eq('user_id', userId)
      .gte('notification_timestamp', windowStartMs)
      .lte('notification_timestamp', windowEndMs),
  ]);

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

/**
 * The user's recurring templates, with no date window on them.
 *
 * Every other lookup in this file is windowed to +/-3 days, which is right for
 * "have we already written this charge down" and wrong for "is this charge one
 * we are expecting". A monthly subscription's only real row can be a month old
 * — its next occurrence is not written until its due date arrives — so a window
 * around today cannot see the schedule it belongs to.
 *
 * Cached for a few seconds, for the same reason the notification rules are: a
 * `scanActiveNotifications()` burst runs every banking notification in the shade
 * back-to-back, and without this that is one identical query per notification.
 * Short enough that a subscription the user added a moment ago is recognised on
 * the next capture rather than the next launch.
 *
 * Best-effort: a failure here means the charge is captured as an ordinary one,
 * which is the recoverable direction. A duplicate row the user can delete beats
 * a purchase that was silently dropped because a query timed out.
 */
const RECURRING_CACHE_TTL_MS = 30_000;
let recurringCache: { userId: string; rows: RecurringChargeRow[]; at: number } | null = null;

/** Exposed for testing: forget the cached recurring templates. */
export function _clearRecurringCacheForTesting(): void {
  recurringCache = null;
}

async function fetchRecurringCharges(userId: string): Promise<RecurringChargeRow[]> {
  const now = Date.now();
  if (recurringCache && recurringCache.userId === userId && now - recurringCache.at < RECURRING_CACHE_TTL_MS) {
    return recurringCache.rows;
  }
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, vendor, amount, date, recur, source')
      .eq('user_id', userId)
      // The two labels the enum actually has, and no lowercase "just in case"
      // spellings. `recur` is a Postgres enum: a value outside its labels does
      // not match nothing, it fails the query — so asking for 'monthly' as
      // well returned a 400 every time and this check, which is what stops a
      // subscription being captured and announced a second time, has never
      // seen a single row.
      .in('recur', ['Monthly', 'Biweekly'])
      .order('date', { ascending: false })
      .limit(MAX_RECURRING_ROWS);
    if (error) {
      log.warn('[AI pipeline] Could not load recurring charges:', error);
      return [];
    }
    const rows = (data || []) as RecurringChargeRow[];
    // Only a successful read is cached. Caching a failure would mean one bad
    // query silenced the check for the whole burst that follows it.
    recurringCache = { userId, rows, at: now };
    return rows;
  } catch (e) {
    log.warn('[AI pipeline] Could not load recurring charges:', e);
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

  // ── Step 0: Sources the user picked, only ──
  // The last line of defence for "a transaction comes from an app the user
  // chose". The native listener drops everything else first and the hook drops
  // it again, but this is the one place EVERY path into the ledger passes
  // through, so it is the one that has to be right. Cheap: a set lookup on a
  // string already in hand.
  if (!isCaptureSourceAllowed(input.bankAppId)) {
    log.debug(`[AI pipeline] Ignoring notification from an app that is not a capture source: ${input.bankAppId || '(none)'}`);
    return {
      processed: false,
      isTransaction: false,
      skipReason: 'not_bank_app',
      rejectionReason: 'Notification did not come from a selected capture source',
      bankName: input.bankName,
    };
  }

  // ── Step 0a: Mail has to be from a bank ──
  //
  // The single rule that makes reading mail safe. A bank app essentially never
  // says anything but "you were charged"; an inbox is full of receipts, order
  // confirmations, invoices and newsletters that carry dollar amounts and would
  // otherwise all read as purchases.
  //
  // The sender is vetted first, and only then is a SHORT reconstructed
  // subject-and-snippet handed to the ordinary parser — which is not modified by
  // any of this, so every existing protection (deposits, declined cards,
  // statement notices, balance alerts) applies to mail unchanged, and no
  // bank-app capture behaves differently than it did.
  //
  // The channel is decided here rather than taken from the phone: an older APK
  // sends no channel at all, and a build that did could be wrong about an app
  // the user has since re-classified.
  const channel: CaptureSourceKind = allowedSourceKind(input.bankAppId) ?? 'bank';
  input = { ...input, channel };
  if (channel === 'email') {
    const alert = parseEmailAlert({
      title: input.notificationTitle,
      body: input.notificationBody,
      rawText: input.rawNotification,
    });
    if (!alert) {
      log.debug('[AI pipeline] Email is not a bank alert, or stands for several messages; ignoring');
      return {
        processed: false,
        isTransaction: false,
        skipReason: 'not_bank_app',
        rejectionReason: 'Email was not a single message from a bank',
        bankName: input.bankName,
      };
    }
    // Everything downstream — the dedup keys, the parser, the stored row — now
    // works from the vetted text rather than the whole notification.
    input = { ...input, rawNotification: alert.text };
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

  // ── The first two lookups run together ──
  //
  // The rules lookup and the duplicate lookup below need nothing from each
  // other, but ran one after the other — and on a phone that has just woken
  // its radio, each one is most of a second. That wait is the whole reason a
  // purchase captured while the app was closed took a few seconds to appear
  // after opening it: nothing was slow, everything was just in a queue behind
  // something else.
  //
  // Starting the duplicate lookup here changes nothing about the decisions
  // below or the order they are made in — the rule still wins, and still wins
  // first. It only means the answer has arrived by the time Step 1 asks for
  // it. The cost is one wasted read when a rule matches, which is a rare path
  // and a read either way.
  const quickAmountMatch = input.rawNotification.match(/\$([\d,]+(?:\.\d{1,2})?)/);
  const quickAmount = quickAmountMatch
    ? parseFloat(quickAmountMatch[1].replace(/,/g, ''))
    : null;
  const duplicateCheck = checkAlreadyProcessed(
    userId,
    quickAmount,
    input.fallbackVendor || null,
    notifTimestamp,
  ).catch((e) => {
    // Never allowed to reject: this promise is created before the early exits
    // below and may end up with nobody awaiting it. Falling back to "not a
    // duplicate" is also what the function itself does on a failed read, so
    // the behaviour is unchanged.
    log.warn('[AI pipeline] Duplicate check failed; treating as not a duplicate:', e);
    return false;
  });

  // ── Step 0c: User-learned skip rules ──
  // The user can mark a captured item as "not a transaction" from the
  // <> page. That creates a rule in `notification_rules` and every
  // future notification matching the rule is dropped here, before any
  // parsing. We bump the rule's use_count best-effort (fire-and-forget).
  //
  // Applied even under forceReprocess, unlike every other early exit here. A
  // rescan is allowed to look again at things the app GUESSED were not
  // transactions — the rejection cache below is exactly that, a record of
  // guesses — but a rule is not a guess, it is a standing instruction from the
  // user, and rescanning is no reason to overrule it.
  //
  // That distinction was not being made, and it mattered far more than it
  // sounds: everything captured while the app is closed comes back through
  // drainPendingNotifications, which marks the whole batch as a scan. So the
  // skip rules were bypassed for precisely the captures the user never saw
  // happen — every alert they had already marked as noise was quietly
  // re-imported on the next launch.
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
  // Started above, so by now this is usually just reading an answer that has
  // already arrived rather than waiting for one.
  const isDuplicate = await duplicateCheck;

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

  // ── The three lookups the rest of this needs, started together ──
  //
  // Everything below this point is one purchase being checked against the
  // user's own history: nearby transactions (Step 4 and Step 5b), their vendor
  // rules (Step 5a) and their recurring charges (Step 5b). None of the three
  // reads depends on another, and none of them depends on the vendor or amount
  // this call is still working out — the transactions read is a date window,
  // the rules read fetches the whole small table and matches in memory, and
  // the recurring read is the user's recurring rows. They were nonetheless
  // issued one at a time, three round trips deep, which is most of the wait
  // between opening the app and seeing a capture appear.
  //
  // Started here rather than at the top of the function so an alert that is
  // not a purchase at all still costs nothing: the parser has just said this
  // one is. Each promise is made safe to abandon, because the paths below can
  // return before some of them are read.
  const today = getLocalToday();
  const todayMs = parseLocalDate(today).getTime();
  const step4WindowStart = new Date(todayMs - RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);
  const step4WindowEnd = new Date(todayMs + RECURRING_DATE_TOLERANCE_DAYS * MS_PER_DAY).toISOString().slice(0, 10);

  // Promise.resolve rather than calling .then on the builder: a query builder
  // is thenable, so this issues the read immediately, and it also survives a
  // caller that hands back a plain object instead of a promise.
  const nearbyTransactions = Promise.resolve(
    supabase
      .from('transactions')
      // `raw_notification` rides along because it is where a row's capture
      // channel is recorded (see lib/captureChannel.ts). Fetching it here means
      // the email-versus-bank duplicate rule below costs no extra round trip —
      // it reuses rows the pipeline was loading anyway.
      .select('id, vendor, amount, type, date, recur, source, raw_notification, created_at')
      .eq('user_id', userId)
      .gte('date', step4WindowStart)
      .lte('date', step4WindowEnd),
  ).catch((e) => {
    log.warn('[AI pipeline] Could not read nearby transactions:', e);
    return { data: null } as { data: null };
  });

  // ALL of the user's rules, not a recent slice of them — see the match_key
  // lookup in Step 5a for why, and note that the query itself mentions no
  // vendor, which is what makes it safe to start before one is settled on.
  const vendorRules = Promise.resolve(
    supabase
      .from('overrides')
      .select('category_id, proper_name, match_key, match_type, updated_at')
      .eq('user_id', userId)
      .not('match_key', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(MAX_VENDOR_RULES),
  ).catch((e) => {
    log.warn('[AI pipeline] Could not read the vendor rules:', e);
    return { data: null } as { data: null };
  });

  // Already caches its own result and never rejects, so it needs no guard.
  const recurringCharges = fetchRecurringCharges(userId);

  // ── Step 2d: the same alert, reworded ──
  //
  // The user's rules are matched two ways before this: the text as it was
  // written, and the text with its numbers masked, which is what makes "ignore
  // alerts like this one" survive tomorrow's price. Neither survives the alert
  // being REWORDED — a bank changing its phrasing, "Bitcoin price update"
  // where last week said "BTC price alert" — and to the user that is obviously
  // the same notification they have already dealt with once.
  //
  // So the model gets a second look, under two conditions that keep it off the
  // path of ordinary captures entirely:
  //
  //   - only for alerts already sharing most of their wording with something
  //     the user ignored (candidatePatternsFor), so a Loblaws charge is never
  //     compared against anything;
  //   - only once the parser has decided this IS a purchase, so nothing the
  //     app was going to reject anyway costs an inference.
  //
  // Placed after the three reads above are already in flight, so an inference
  // — which can take a second on a phone — overlaps with them rather than
  // holding them up. Returning from here abandons those reads, which is safe:
  // they are read-only and each one is guarded.
  //
  // And the verdict is recorded as a GUESS, not as a rule. A rule is the
  // user's standing instruction and is never revisited; this is the app's
  // opinion about a wording nobody has ruled on, so it goes in the rejection
  // memory that the scan button is allowed to overrule, and it shows up in the
  // processed list with its reason rather than disappearing.
  const ignoredPatterns = await listIgnoredPatterns(userId);
  const rewordCandidates = ignoredPatterns.length > 0
    ? candidatePatternsFor(ignoredPatterns, input.rawNotification)
    : [];
  if (rewordCandidates.length > 0) {
    // A model that throws — no runtime, no network, a WebView that killed the
    // worker — is not an opinion, and must never be the reason a purchase
    // fails to be captured. Same answer as a "no".
    const sameKind = await aiLooksLikeIgnoredAlert(input.rawNotification, rewordCandidates[0])
      .catch(() => false);
    if (sameKind) {
      log.debug('[AI pipeline] Reads as a reworded version of an alert the user ignores');
      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationRejected(inMemoryKey);
      return {
        processed: true,
        isTransaction: false,
        skipReason: 'not_transaction',
        rejectionReason: "Looks like the alerts you've marked as not a transaction",
        bankName: input.bankName,
      };
    }
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
  //
  // An uncertain extraction is exactly what the review list is for, so it goes
  // down the same path as every other capture and lands there with its
  // confidence shown as a meter. The only thing low confidence changes is that
  // the row can never be auto-filed (see `lowConfidenceExtraction` at the
  // insert below) — the user has to look at it.
  //
  // This used to divert instead: it inserted a row into `pending_transactions`
  // and returned. That table does not exist in this database, so the insert
  // 404'd, supabase-js reported the failure in a return value nobody read, and
  // the purchase went nowhere. Worse, the diversion called
  // markNotificationProcessed first, which is permanent — so the capture could
  // never be recovered by a rescan either. The user was told "$X at Y
  // captured" by the notification and then found nothing in Review, with no
  // error anywhere. Every purchase the on-device model was unsure about was
  // silently destroyed.
  const lowConfidenceExtraction =
    !!aiResult && aiResult.isTransaction && (aiResult.confidence ?? 1) < LOW_CONFIDENCE_REVIEW_THRESHOLD;
  if (lowConfidenceExtraction) {
    log.debug(
      `[AI pipeline] Low confidence (${aiResult!.confidenceLabel}, ` +
      `${(aiResult!.confidence ?? 0).toFixed(2)}) — capturing for review rather than auto-filing`,
    );
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
  // Projection is the superset of what step 4 and step 5b need, so step 5b
  // can reuse this result instead of re-issuing the identical query (same
  // user, same +/-3 day window). Nothing between the two steps writes to
  // `transactions`; the post-insert race check in step 6b deliberately stays
  // a fresh query.
  const { data: existingTx } = await nearbyTransactions;

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

  // ── Step 4d: Two apps, one tap — the first to report it wins ──
  //
  // A wallet and the card's own bank app both announce the same tap-to-pay
  // purchase, seconds apart, in completely different words. Nothing above can
  // see that they are one purchase: the fingerprints differ (different app,
  // different text) and the near-duplicate check needs the merchants to match,
  // which is exactly what fails here — a wallet often has only its own name or a
  // terminal id where the merchant should be.
  //
  // So this matches on what both sides always get right: the amount, and how far
  // apart the two announcements were. Whoever reported it first keeps the row;
  // this one is dropped. Deliberately blind to the merchant, and deliberately
  // narrow — five minutes, and only ever against a DIFFERENT app.
  //
  // This is what replaced refusing Google Wallet outright. The exclusion cost a
  // real capability (a card that only notifies through a wallet could not be
  // captured at all) and could only be undone in a release; this can be undone
  // by unticking the app.
  if (existingTx && existingTx.length > 0 && input.bankAppId) {
    const sameTap = existingTx.find((tx) => isOtherAppSameTap(
      tx,
      { packageName: input.bankAppId, amount, notifiedAt: notifTimestamp },
      amountsAgree,
    ));
    if (sameTap) {
      log.debug(
        `[AI pipeline] Another app already reported this tap: ${sameTap.vendor} $${sameTap.amount}; dropping the second report from ${input.bankAppId}`,
      );
      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationProcessed(capturedKey);
      return {
        processed: true,
        isTransaction: true,
        vendor,
        amount,
        skipReason: 'duplicate_ai' as const,
        rejectionReason: 'Another app reported this purchase first',
        bankName: input.bankName,
      };
    }
  }

  // ── Step 4e: An email defers to the bank's own alert ──
  //
  // Most banks announce a purchase twice — a push from their app and an email —
  // and the two are not remotely the same string, so none of the fingerprint
  // dedup above can see that they are one purchase. Step 4's hard skip nearly
  // catches it and then misses: it demands the same day and the same cent,
  // while an email routinely lands the following morning and occasionally
  // rounds differently.
  //
  // Four things make this safe rather than a way to lose purchases:
  //
  //   1. It only ever runs for a capture that came IN by email, so a bank
  //      alert can never be dropped in favour of anything.
  //   2. It only defers to a row that came from a bank app — including every
  //      row captured before this feature existed, which could not have come
  //      from anywhere else. An email is never dropped because of another
  //      email; two mails about two real purchases both survive.
  //   3. It uses the looser "looks like the same charge" test, the one written
  //      for exactly this drift (a premium reported at $477.45 and captured at
  //      $477.46 a day later).
  //   4. ONE email cancels ONE bank row. The row is marked as it is used, so a
  //      second genuine purchase at the same merchant for the same amount
  //      inside the window cannot vanish into the same row — the trap two Fizz
  //      charges three days apart already sprang once on the projection code.
  //
  // Closest first, so when several rows could match, the nearest in amount and
  // then in time is the one consumed.
  if (input.channel === 'email' && existingTx && existingTx.length > 0) {
    const candidates = existingTx
      .filter((tx) => isBankSourcedRow(tx) && !hasPairedEmail(tx.raw_notification))
      .filter((tx) => isSameCharge({ vendor, amount, date: today }, {
        vendor: tx.vendor,
        amount: Number(tx.amount),
        date: tx.date,
      }))
      .sort((a, b) => {
        const byAmount =
          Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount);
        if (byAmount !== 0) return byAmount;
        return (daysApart(a.date, today) ?? 99) - (daysApart(b.date, today) ?? 99);
      });

    const claimed = candidates[0];
    if (claimed) {
      log.debug(
        `[AI pipeline] Email repeats a bank capture: ${claimed.vendor} $${claimed.amount} on ${claimed.date}; dropping the email copy`,
      );
      // Spend the row so it cannot absorb a second email. Deliberately not
      // awaited for its success: if this write fails the only cost is the old
      // behaviour, where one row could swallow two emails, and that is not
      // worth failing a capture over.
      try {
        await supabase
          .from('transactions')
          .update({ raw_notification: withEmailPairedMarker(claimed.raw_notification).slice(0, 4000) })
          .eq('id', claimed.id);
      } catch (e) {
        log.warn('[AI pipeline] Could not mark the bank row as paired:', e);
      }

      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationProcessed(capturedKey);
      return {
        processed: true,
        isTransaction: true,
        vendor,
        amount,
        skipReason: 'duplicate_ai' as const,
        rejectionReason: 'The bank app already reported this purchase',
        bankName: input.bankName,
      };
    }
  }

  // ── Step 4f: The bank's alert upgrades an email that got here first ──
  //
  // The other order of arrival. Sometimes the email lands before the push, or
  // the push is delayed by hours, or that particular card only pushes
  // sometimes. By the time the bank's own alert arrives the email row is
  // already saved — and left alone, step 4 would discard the bank's version and
  // the dashboard would keep the weaker one: an email's merchant is dug out of
  // a truncated snippet, a bank's comes from fixed wording, and the amounts can
  // differ by a cent.
  //
  // So the bank's numbers are written over the email's row rather than beside
  // it. Nothing is deleted and no row appears or disappears — the entry the user
  // may already be looking at in Review simply becomes correct, and is marked as
  // bank-sourced so a later email defers to it like any other.
  //
  // If the update fails the capture is still reported as a duplicate rather than
  // retried as an insert: the money is already on the books with very nearly the
  // right figure, and a second row would be worse than a slightly stale one.
  if (input.channel !== 'email' && existingTx && existingTx.length > 0) {
    const stale = existingTx
      .filter((tx) => isEmailSourcedRow(tx))
      .filter((tx) => isSameCharge({ vendor, amount, date: today }, {
        vendor: tx.vendor,
        amount: Number(tx.amount),
        date: tx.date,
      }))
      .sort((a, b) =>
        Math.abs(Number(a.amount) - amount) - Math.abs(Number(b.amount) - amount))[0];

    if (stale) {
      log.debug(
        `[AI pipeline] Bank alert supersedes an email capture: ${stale.vendor} $${stale.amount} → ${vendor} $${amount.toFixed(2)}`,
      );
      try {
        await supabase
          .from('transactions')
          .update({
            vendor: vendor || stale.vendor,
            amount,
            raw_notification: withCaptureMarker(
              (input.rawNotification || '').slice(0, 3900),
              { channel: 'bank', packageName: input.bankAppId, notifiedAt: notifTimestamp },
            ),
          })
          .eq('id', stale.id);
      } catch (e) {
        log.warn('[AI pipeline] Could not upgrade the email row with the bank alert:', e);
      }

      recentlyProcessedCache.set(inMemoryKey, Date.now());
      markNotificationProcessed(capturedKey);
      return {
        processed: true,
        isTransaction: true,
        vendor,
        amount,
        skipReason: 'duplicate_ai' as const,
        rejectionReason: 'This purchase was already captured from the bank\'s email',
        bankName: input.bankName,
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
      // Issued alongside the other two reads above; this is just collecting it.
      const { data } = await vendorRules;
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

  // ── Step 5b: The charge is one Covault already knows about ──
  //
  // A subscription is accounted for twice, by two different mechanisms: the
  // recurring machinery has it on the books and posts the month's occurrence on
  // its due date, and then the bank announces the real charge a day or two
  // either side and the capture pipeline records it again. One subscription,
  // two rows, and the month is wrong by the amount — plus a review item and a
  // notification for money the user had already accounted for.
  //
  // Everything above this point failed to see it. The hard skip in step 4 only
  // fires on the SAME DAY, and a due date is a guess that lands a day or two
  // off; and until the alias matching added above, "Google" and
  // "GOOGLE *YOUTUBEPREMIUM" did not even look like the same merchant.
  //
  // So this is the one place that treats the recurring machinery as
  // authoritative: when the same charge is already recorded — or already
  // scheduled — as recurring, the capture does not become a second row. Where
  // the row IS this occurrence, the bank's own wording is kept on it, so the
  // charge can still be traced back to the notification that confirmed it.
  //
  // Deliberately narrower than the soft-dup above: only recurring rows, and
  // only an amount matching to the cent. Two ordinary purchases at one
  // merchant in the same week are real and both must survive; a subscription
  // billing twice in three days for the identical amount is not.
  //
  // Matched against the SCHEDULE, not just against rows sitting nearby.
  //
  // The window queried above is +/-3 days, which only ever contained a
  // subscription the executor had already posted. A subscription that has not
  // come due yet has no row at all — the executor writes occurrences up to
  // today and no further, and the future ones on the dashboard are display-only
  // projections — so its only real row is the previous month's, a month outside
  // that window. A Netflix charge announced today with the monthly Netflix due
  // tomorrow therefore matched nothing, and was captured a second time.
  //
  // So the recurring templates are fetched separately, without a date window,
  // and lib/recurringSchedule.ts asks whether an occurrence of each falls near
  // today rather than whether its row happens to.
  //
  // The rows already in hand are checked first, so the common case — the
  // executor posted this month's occurrence a day or two ago — costs nothing
  // extra. The unwindowed lookup only happens when that finds nothing.
  //
  // Every name this capture answers to, including the one the matched rule
  // renamed it to — that is usually the name the recurring row carries.
  const recurringCandidate = {
    vendors: [displayVendor, vendor, ...vendorAliases],
    amount,
    date: today,
  };
  const recurringMatch =
    findRecurringScheduleMatch(recurringCandidate, existingTx || []) ??
    findRecurringScheduleMatch(recurringCandidate, await recurringCharges);

  if (recurringMatch) {
    log.debug(
      `[AI pipeline] Already known as a recurring charge: ${recurringMatch.vendor} ` +
      `$${recurringMatch.amount} on ${recurringMatch.date} (${recurringMatch.id}, ` +
      `recur=${recurringMatch.recur || 'none'}, source=${recurringMatch.source || 'unknown'}) ` +
      `— not capturing a second row`,
    );

    // Attach the bank's wording to the row, but only when the row IS this
    // occurrence. A template matched through its schedule is a different
    // month's charge, and writing today's notification onto it would rewrite
    // history for a row this capture is not.
    //
    // Best-effort either way. The point of the skip is that there is only one
    // row; failing to record where the confirmation came from costs
    // traceability, not correctness, so it must not turn into a duplicate
    // insert.
    const rowGap = daysApart(String(recurringMatch.date || ''), today);
    if (rowGap !== null && rowGap <= RECURRING_DATE_TOLERANCE_DAYS) {
      const { error: attachError } = await supabase
        .from('transactions')
        .update({ raw_notification: (input.rawNotification || '').slice(0, 4000) })
        .eq('id', recurringMatch.id);
      if (attachError) {
        log.warn('[AI pipeline] Could not attach the notification to the recurring row:', attachError);
      }
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
        id: String(recurringMatch.id || ''),
        vendor: String(recurringMatch.vendor || ''),
        amount: Number(recurringMatch.amount),
        date: String(recurringMatch.date || ''),
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
  //
  // This one applies to a forced reprocess as well, unlike the dedup checks at
  // the top. Those ask "have we seen this before?", which a rescan is entitled
  // to answer again. This asks "is another invocation inserting this exact
  // purchase right now?", and the answer is no less true for a rescan — while
  // everything drained from the native queue is marked as a scan, so exempting
  // scans left the whole cold-start path with no concurrency guard at all.
  //
  // Deliberately does NOT mark the notification permanently processed. We are
  // backing off on the strength of another invocation's insert that has not
  // happened yet; if it fails or rolls back, the purchase has to stay
  // recoverable. The invocation that actually writes the row marks it.
  if (!claimPurchase(purchaseKey)) {
    log.debug(`[AI pipeline] Purchase already being inserted by a parallel capture: ${finalVendorName} $${storedAmount}`);
    recentlyProcessedCache.set(inMemoryKey, Date.now());
    return {
      processed: false,
      isTransaction: false,
      vendor: finalVendorName,
      amount: storedAmount,
      bankName: input.bankName,
      skipReason: 'duplicate_fingerprint',
    };
  }
  // AI/parser confidence for this capture — how sure the extraction is, not
  // how sure the categorisation is. Stored on the row so the capture-review UI
  // can show it as a meter, which is the whole reason a low-confidence read is
  // worth keeping: the user can see the app was guessing and correct it.
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
  //
  // Nor can an extraction the model was unsure about (Step 2c). A rule match
  // scores how well a NAME is explained, and a low-confidence read is evidence
  // the name itself may be wrong — filing on the strength of a rule matched
  // against a misread merchant is how a charge ends up in the wrong budget
  // with nobody ever seeing it.
  //
  // Nor can a capture that looks like one already on the books. The soft
  // duplicate above deliberately does NOT skip the insert — the user would
  // rather see both rows than lose a charge — but that bargain only works if
  // they SEE both rows. Filed automatically, a second report of one charge
  // landed straight on the dashboard and was never shown to anybody: a monthly
  // insurance premium counted twice, a day apart, with nothing in Review to say
  // so. The row is still written; it just has to be looked at.
  //
  // Nor can anything that came in by email, ever. Auto-filing is the one path
  // that records a purchase the user never sees, and mail is the least reliable
  // thing the app reads: the sender is vetted but the body is a truncated
  // snippet a mail app chose, and the merchant has to be dug out of prose rather
  // than a bank's fixed wording. A bank push that parses badly costs a row in
  // Review; an email that parses badly and files itself costs a wrong number on
  // the dashboard that nobody was shown. Email captures are always looked at.
  const autoAccepted = input.channel !== 'email'
    && !fuelHold && !lowConfidenceExtraction && !softDupMatch && shouldAutoAccept({
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
    // Both markers ride here. The fuel one records a substituted amount; the
    // capture one records which route the alert arrived by, which is what lets
    // a later email recognise this row as the bank's own report of the same
    // purchase. Neither needs a migration, and the slice leaves room for them.
    raw_notification: withCaptureMarker(
      fuelHold
        // Record the substitution in the row itself. This is what lets the UI
        // recognise a placeholder later without a schema migration, and it
        // keeps the bank's original wording alongside what we stored instead.
        ? withFuelHoldMarker((input.rawNotification || '').slice(0, 3800), fuelHold)
        : (input.rawNotification || '').slice(0, 3900),
      { channel: input.channel ?? 'bank', packageName: input.bankAppId, notifiedAt: notifTimestamp },
    ),
    confidence: captureConfidence,
    // Only set when filing on arrival, so it never enters the review queue.
    // Omitted otherwise so a normal capture's insert keeps exactly the shape it
    // had before auto-accept existed — the column's own default is false, and
    // naming it unconditionally would make every insert depend on it.
    //
    // Not deleted or hidden: an auto-filed row lands in history and counts
    // toward the budget exactly like one the user accepted by hand.
    //
    // `auto_filed` rides along with it, and is the only thing that later
    // distinguishes a row the user never saw from one they reviewed and filed
    // themselves. Without it an auto-filed capture left no trace anywhere: the
    // review list said "All caught up" while purchases were being recorded, and
    // the user re-entered them by hand a minute later. The "Filed
    // automatically" card reads this.
    ...(autoAccepted ? { caught_cleared: true, auto_filed: true } : {}),
  };
  let { error: txError } = await supabase.from('transactions').insert(insertRow);
  // Tolerate DBs where a late-added column hasn't been migrated yet: retry
  // once without them rather than dropping the whole capture. Both are
  // decoration on a row whose purpose is the amount — losing the meter or the
  // "we filed this for you" mark costs the user information, losing the
  // insert costs them a purchase.
  if (txError && /confidence|auto_filed/i.test(txError.message || '')) {
    const { confidence: _omitConfidence, auto_filed: _omitAutoFiled, ...withoutLateColumns } = insertRow;
    ({ error: txError } = await supabase.from('transactions').insert(withoutLateColumns));
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
  // transactions table for every row matching our vendor + amount + date,
  // ours included, and let exactly one of them win.
  //
  // Reading our own row back is the whole point. The original version asked
  // only "does another row like this exist?" and rolled itself back if one
  // did — which is correct when the other row was already there, and
  // catastrophic when both rows were inserted at the same moment: each
  // invocation saw the other as pre-existing, each deleted its own insert,
  // and the purchase disappeared completely with both sides believing they
  // had merely avoided a duplicate.
  //
  // So the winner is chosen by a rule both sides compute identically —
  // oldest `created_at`, ties broken on id — rather than by "the other one".
  // Every interleaving then leaves exactly one row: whoever queries early
  // enough to see only itself keeps its row, and anyone who sees the pair
  // agrees on which of them survives.
  //
  // We compare vendor after normalization so that two surface forms of the
  // same merchant (e.g. "AMZN MKTP" vs "Amazon Prime") are recognized as the
  // same charge.
  const { data: raceCheck } = await supabase
    .from('transactions')
    .select('id, vendor, amount, date, created_at')
    .eq('user_id', userId)
    .eq('date', today)
    .eq('amount', storedAmount);

  if (raceCheck && raceCheck.length > 1) {
    const normalizedOur = normalizeVendorForDedup(finalVendorName);
    const sameCharge = raceCheck.filter(
      (row) => normalizeVendorForDedup(row.vendor) === normalizedOur,
    );
    const ours = sameCharge.find((row) => row.id === transactionId);
    const others = sameCharge.filter((row) => row.id !== transactionId);

    // Our own row missing from a read taken after our own successful insert
    // means we cannot establish an order, so we keep it. A visible duplicate
    // is something the user can delete in one tap; a purchase deleted on a
    // guess is gone.
    if (ours && others.length > 0) {
      const winner = pickSurvivingCharge(sameCharge);

      if (winner && winner.id !== transactionId) {
        log.warn(
          `[AI pipeline] ⚠️ Race-recovery: rolling back our insert of ${finalVendorName} $${storedAmount} ` +
          `(${transactionId}) — duplicate of ${winner.id} (${winner.vendor} $${winner.amount}, created ${winner.created_at})`,
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
        // The winning row is in the ledger, so this notification is captured
        // and must not be imported again.
        markNotificationProcessed(capturedKey);
        recentlyProcessedCache.set(inMemoryKey, Date.now());
        releasePurchase(purchaseKey);
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
            id: winner.id,
            vendor: winner.vendor,
            amount: Number(winner.amount),
            date: winner.date,
          },
        };
      }

      log.warn(
        `[AI pipeline] Race-recovery: keeping our insert of ${finalVendorName} $${storedAmount} ` +
        `(${transactionId}); ${others.length} concurrent duplicate(s) will roll themselves back`,
      );
    }
  }

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
