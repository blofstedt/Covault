import { fuzzyVendorMatch, normalizeVendorForDedup } from './formatVendorName';
import { hasPairedEmail, isBankSourcedRow, isEmailSourcedRow } from './captureChannel';
import { daysApart, isSameCharge, type ChargeLike } from './duplicateCharge';

/** Amounts closer than this are treated as the same reported charge. */
export const NOTIFICATION_AMOUNT_TOLERANCE = 0.01;

export interface NotificationTransactionCandidate {
  id: string;
  vendor: string | null | undefined;
  amount: number | string;
  date: string;
}

export interface CapturedPurchase {
  vendor: string;
  aliases: readonly string[];
  amount: number;
  date: string;
}

export type NotificationDuplicateDecision<T extends NotificationTransactionCandidate> =
  | { kind: 'hard'; transaction: T }
  | { kind: 'soft'; transaction: T }
  | { kind: 'none' };

export interface BankCaptureCandidate extends NotificationTransactionCandidate {
  raw_notification?: string | null;
  source?: string | null;
}

export interface EmailCaptureCandidate extends NotificationTransactionCandidate {
  raw_notification?: string | null;
}

export interface InsertedChargeCandidate {
  id: string;
  created_at: string;
}

export type ConcurrentCaptureDecision<T extends InsertedChargeCandidate> =
  | { kind: 'rollback'; survivor: T }
  | { kind: 'keep'; reason: 'insert-not-visible' | 'only-our-row' | 'insert-survives' };

/** Match the capture's polished name and any merchant aliases to an old row. */
export function matchesCapturedVendor(
  existingName: string | null | undefined,
  vendor: string,
  aliases: readonly string[],
): boolean {
  const existing = String(existingName || '');
  if (!existing) return false;

  const normalizedVendor = normalizeVendorForDedup(vendor);
  if (normalizeVendorForDedup(existing) === normalizedVendor) return true;
  if (fuzzyVendorMatch(existing, vendor)) return true;
  return aliases.some((alias) => fuzzyVendorMatch(existing, alias));
}

/**
 * Classify an already-recorded nearby purchase without performing I/O.
 *
 * Only a same-day, near-exact match is a hard skip. Other matches remain
 * visible as possible duplicates so a real second purchase is never silently
 * lost. The closest amount is surfaced when there is more than one candidate.
 */
export function findNotificationDuplicate<T extends NotificationTransactionCandidate>(
  existing: readonly T[],
  purchase: CapturedPurchase,
): NotificationDuplicateDecision<T> {
  const hardMatch = existing.find((transaction) =>
    transaction.date === purchase.date &&
    Math.abs(Number(transaction.amount) - purchase.amount) < NOTIFICATION_AMOUNT_TOLERANCE &&
    matchesCapturedVendor(transaction.vendor, purchase.vendor, purchase.aliases),
  );
  if (hardMatch) return { kind: 'hard', transaction: hardMatch };

  const vendorMatches = existing.filter((transaction) =>
    matchesCapturedVendor(transaction.vendor, purchase.vendor, purchase.aliases),
  );
  if (vendorMatches.length === 0) return { kind: 'none' };

  const sameAmount = vendorMatches.find((transaction) =>
    Math.abs(Number(transaction.amount) - purchase.amount) < NOTIFICATION_AMOUNT_TOLERANCE,
  );
  const closest = sameAmount || [...vendorMatches].sort((a, b) =>
    Math.abs(Number(a.amount) - purchase.amount) - Math.abs(Number(b.amount) - purchase.amount),
  )[0];

  return { kind: 'soft', transaction: closest };
}

/**
 * Find the one unpaired bank capture an incoming email most likely repeats.
 *
 * The email route is allowed to defer only to an automatic bank row, never to
 * another email or to a hand-entered purchase. A bank row can absorb only one
 * email, so rows already marked as paired are excluded. When several rows
 * qualify, prefer the closest amount, then the closest date.
 */
export function findUnpairedBankCaptureForEmail<T extends BankCaptureCandidate>(
  existing: readonly T[],
  purchase: ChargeLike,
): T | undefined {
  return existing
    .filter((transaction) =>
      isBankSourcedRow(transaction) && !hasPairedEmail(transaction.raw_notification),
    )
    .filter((transaction) => isSameCharge(purchase, {
      vendor: transaction.vendor,
      amount: Number(transaction.amount),
      date: transaction.date,
    }))
    .sort((a, b) => {
      const byAmount =
        Math.abs(Number(a.amount) - Number(purchase.amount)) -
        Math.abs(Number(b.amount) - Number(purchase.amount));
      if (byAmount !== 0) return byAmount;
      return (daysApart(a.date, String(purchase.date || '')) ?? 99) -
        (daysApart(b.date, String(purchase.date || '')) ?? 99);
    })[0];
}

/** Find the closest email capture that a later bank alert can upgrade. */
export function findEmailCaptureForBank<T extends EmailCaptureCandidate>(
  existing: readonly T[],
  purchase: ChargeLike,
): T | undefined {
  return existing
    .filter((transaction) => isEmailSourcedRow(transaction))
    .filter((transaction) => isSameCharge(purchase, {
      vendor: transaction.vendor,
      amount: Number(transaction.amount),
      date: transaction.date,
    }))
    .sort((a, b) =>
      Math.abs(Number(a.amount) - Number(purchase.amount)) -
      Math.abs(Number(b.amount) - Number(purchase.amount)))[0];
}

/**
 * Decide whether this invocation should keep or roll back its inserted row.
 *
 * `sameMerchantRows` must already contain only rows for this normalized
 * merchant, including the current insert when it was visible to the query.
 * Both concurrent invocations apply the same oldest-created-then-id ordering
 * so they agree on which row should survive whenever they see the same rows.
 * A visible loser can withdraw without risking the selected survivor.
 */
export function decideConcurrentCapture<T extends InsertedChargeCandidate>(
  sameMerchantRows: readonly T[],
  insertedId: string,
): ConcurrentCaptureDecision<T> {
  const insertedRow = sameMerchantRows.find((row) => row.id === insertedId);
  if (!insertedRow) return { kind: 'keep', reason: 'insert-not-visible' };
  if (sameMerchantRows.length === 1) return { kind: 'keep', reason: 'only-our-row' };

  const rank = (row: T) => `${row.created_at}|${row.id}`;
  const survivor = sameMerchantRows.reduce((oldest, row) =>
    rank(row) < rank(oldest) ? row : oldest,
  );

  return survivor.id === insertedId
    ? { kind: 'keep', reason: 'insert-survives' }
    : { kind: 'rollback', survivor };
}
