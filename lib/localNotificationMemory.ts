import { djb2Base36 } from './hash';
export type ReviewStatus = 'needs_review' | 'reviewed';

export interface VendorMapEntry {
  vendor_key: string;
  vendor_display: string;
  budget: string;
  updated_at: string;
}

interface ReviewQueueEntry {
  transaction_id: string;
  created_at: string;
  status: ReviewStatus;
}

const VENDOR_MAP_KEY = 'covault_vendor_map_v1';
const REVIEW_QUEUE_KEY = 'covault_review_queue_v1';
const REVIEW_QUEUE_EVENT = 'covault-review-queue-changed';
const PROCESSED_NOTIFS_KEY = 'covault_processed_notifs_v1';

/** Max entries to keep in the processed-notifications set (oldest trimmed beyond this) */
const MAX_PROCESSED_NOTIFS = 500;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (!canUseStorage()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

function emitReviewQueueChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(REVIEW_QUEUE_EVENT));
  }
}

export function getReviewQueueChangedEventName(): string {
  return REVIEW_QUEUE_EVENT;
}

export function getVendorMap(): Record<string, VendorMapEntry> {
  return readJson<Record<string, VendorMapEntry>>(VENDOR_MAP_KEY, {});
}

export function getVendorMapEntry(vendorKey: string): VendorMapEntry | null {
  const map = getVendorMap();
  return map[vendorKey] || null;
}

export function upsertVendorMapEntry(entry: VendorMapEntry): void {
  const map = getVendorMap();
  map[entry.vendor_key] = entry;
  writeJson(VENDOR_MAP_KEY, map);
}

export function addToReviewQueue(transactionId: string): void {
  const queue = readJson<ReviewQueueEntry[]>(REVIEW_QUEUE_KEY, []);
  if (queue.some(item => item.transaction_id === transactionId)) return;
  queue.unshift({
    transaction_id: transactionId,
    created_at: new Date().toISOString(),
    status: 'needs_review',
  });
  writeJson(REVIEW_QUEUE_KEY, queue);
  emitReviewQueueChanged();
}

export function markReviewQueueStatus(transactionId: string, status: ReviewStatus): void {
  const queue = readJson<ReviewQueueEntry[]>(REVIEW_QUEUE_KEY, []);
  const next = queue.map(item =>
    item.transaction_id === transactionId ? { ...item, status } : item,
  );
  writeJson(REVIEW_QUEUE_KEY, next);
  emitReviewQueueChanged();
}

export function getNeedsReviewCount(): number {
  const queue = readJson<ReviewQueueEntry[]>(REVIEW_QUEUE_KEY, []);
  return queue.filter(item => item.status === 'needs_review').length;
}

export function getNeedsReviewIdSet(): Set<string> {
  const queue = readJson<ReviewQueueEntry[]>(REVIEW_QUEUE_KEY, []);
  return new Set(
    queue
      .filter(item => item.status === 'needs_review')
      .map(item => item.transaction_id),
  );
}

// ── Processed notification keys ─────────────────────────────────────────────
// Persists across app restarts so the same bank notification is never
// re-inserted after the user clears it from the <> page.
// Keys are: `bankAppId|amount|notificationTimestamp`

export function isNotificationProcessed(key: string): boolean {
  const keys = readJson<string[]>(PROCESSED_NOTIFS_KEY, []);
  return keys.includes(key);
}

/**
 * Record a notification as CAPTURED. Permanent by design: the transaction is in
 * the ledger and must never be inserted twice. Rejections must NOT come here —
 * use markNotificationRejected.
 */
export function markNotificationProcessed(key: string): void {
  let keys = readJson<string[]>(PROCESSED_NOTIFS_KEY, []);
  if (keys.includes(key)) return;
  keys.push(key);
  // Trim oldest entries if we've exceeded the cap
  if (keys.length > MAX_PROCESSED_NOTIFS) {
    keys = keys.slice(keys.length - MAX_PROCESSED_NOTIFS);
  }
  writeJson(PROCESSED_NOTIFS_KEY, keys);
}

// ── Rejected notifications ────────────────────────────────────────────────────
// Distinct from the "processed" list above, which means "captured into the
// ledger — never insert again" and is therefore permanent.
//
// A rejection means only "examined and not captured *this time*". Reasons are
// frequently transient: the on-device AI model had not finished loading, a
// refund arrived before the expense it pairs with, a bank reworded its alert.
// Recording those permanently made them unrecoverable — no rescan could ever
// look at them again, which defeats the scan button.
//
// So rejections live here instead: timestamped, expiring, and bypassable by an
// explicit user-initiated rescan.
const REJECTED_NOTIFS_KEY = 'covault_rejected_notifs';
const MAX_REJECTED_NOTIFS = 500;
/** After this, a rejection is forgotten and the notification is re-examined. */
const REJECTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type RejectedEntry = { key: string; at: number };

function readRejected(): RejectedEntry[] {
  const now = Date.now();
  // readJson hands back whatever the blob parses to, so a corrupt value must
  // not be assumed to be an array.
  const raw = readJson<unknown>(REJECTED_NOTIFS_KEY, []);
  if (!Array.isArray(raw)) return [];
  return (raw as RejectedEntry[]).filter(
    (e) => e && typeof e.key === 'string' && typeof e.at === 'number' && now - e.at < REJECTED_TTL_MS,
  );
}

export function markNotificationRejected(key: string): void {
  const entries = readRejected().filter((e) => e.key !== key);
  entries.push({ key, at: Date.now() });
  writeJson(
    REJECTED_NOTIFS_KEY,
    entries.length > MAX_REJECTED_NOTIFS ? entries.slice(entries.length - MAX_REJECTED_NOTIFS) : entries,
  );
}

export function isNotificationRejected(key: string): boolean {
  return readRejected().some((e) => e.key === key);
}

/** Forget every rejection, so the next pass re-examines them all. */
export function clearRejectedNotifications(): void {
  writeJson(REJECTED_NOTIFS_KEY, []);
}

// ── Dismissed soft-dup pairs ──────────────────────────────────────────────────
// The dedup pipeline flags transactions as soft duplicates of one another.
// The user can dismiss the warning ("not a duplicate — keep both"). We persist
// those dismissals so the warning doesn't come back on the next reload.
// Key: `${currentTxId}|${similarTxId}`

const DISMISSED_DUPS_KEY = 'covault_dismissed_dups_v1';

/** Max entries to keep in the dismissed set (oldest trimmed beyond this) */
const MAX_DISMISSED_DUPS = 500;

function dismissedDupKey(currentTxId: string, similarTxId: string): string {
  return `${currentTxId}|${similarTxId}`;
}

export function isSoftDupDismissed(currentTxId: string, similarTxId: string): boolean {
  const keys = readJson<string[]>(DISMISSED_DUPS_KEY, []);
  return keys.includes(dismissedDupKey(currentTxId, similarTxId));
}

export function markSoftDupDismissed(currentTxId: string, similarTxId: string): void {
  let keys = readJson<string[]>(DISMISSED_DUPS_KEY, []);
  const key = dismissedDupKey(currentTxId, similarTxId);
  if (keys.includes(key)) return;
  keys.push(key);
  if (keys.length > MAX_DISMISSED_DUPS) {
    keys = keys.slice(keys.length - MAX_DISMISSED_DUPS);
  }
  writeJson(DISMISSED_DUPS_KEY, keys);
}

// ── AI extraction cache ──────────────────────────────────────────────────────
// The on-device Flan-T5 model is slow on first load and slow per call
// (a few hundred ms). We cache the result of every AI extraction so the
// same notification text is never re-inferred. Key: a hash of the input
// text. Value: the full AIExtractionResult.

const AI_CACHE_KEY = 'covault_ai_extraction_cache_v1';
const MAX_AI_CACHE_ENTRIES = 200;

function aiCacheKey(text: string): string {
  return `ai:${djb2Base36(text)}`;
}

export interface CachedAIResult {
  isTransaction: boolean;
  vendor: string | null;
  amount: number | null;
  suggestedCategory: string | null;
  rejectionReason: string | null;
  /** AI confidence (0.0–1.0), cached alongside the extraction. */
  confidence?: number;
  /** Human-readable confidence label. */
  confidenceLabel?: 'high' | 'medium' | 'low';
  cachedAt: number;
}

export function getCachedAIResult(text: string): CachedAIResult | null {
  const all = readJson<Record<string, CachedAIResult>>(AI_CACHE_KEY, {});
  return all[aiCacheKey(text)] || null;
}

export function setCachedAIResult(text: string, result: Omit<CachedAIResult, 'cachedAt'>): void {
  const all = readJson<Record<string, CachedAIResult>>(AI_CACHE_KEY, {});
  const key = aiCacheKey(text);
  all[key] = { ...result, cachedAt: Date.now() };
  // Trim oldest entries if we've exceeded the cap
  const entries = Object.entries(all);
  if (entries.length > MAX_AI_CACHE_ENTRIES) {
    entries.sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    const trimmed = Object.fromEntries(entries.slice(entries.length - MAX_AI_CACHE_ENTRIES));
    writeJson(AI_CACHE_KEY, trimmed);
  } else {
    writeJson(AI_CACHE_KEY, all);
  }
}

