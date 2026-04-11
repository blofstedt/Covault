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
