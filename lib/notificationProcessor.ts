// lib/notificationProcessor.ts
//
// Notification processing pipeline (manual regex flow).
// No AI/Gemini — rules are created manually by the user.
//
// Pipeline:
//   1. Fingerprint deduplication
//   2. Look up active notification rule for the bank
//   3. If no rule → store as unconfigured capture
//   4. If rule → apply regex
//      - No match → mark as ignored
//      - Match → extract vendor/amount → insert pending transaction
//   5. Ignore rule check (user-defined vendor ignores)
//   6. Auto-approve if vendor has a category and auto_approve is enabled

import { supabase } from './supabase';
import { formatVendorName } from './formatVendorName';
import type { PendingTransaction } from '../types';

// ─── Constants ───────────────────────────────────────────────────

/** Tolerance for comparing monetary amounts */
const AMOUNT_TOLERANCE = 0.01;

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
 */
async function checkAndInsertFingerprint(
  userId: string,
  bankAppId: string,
  detectedAmount: number | null,
  vendor: string,
  timestampMs: number,
): Promise<boolean> {
  const hash = generateFingerprintHash(bankAppId, detectedAmount, vendor, timestampMs);

  const { data: existing } = await supabase
    .from('notification_fingerprints')
    .select('id')
    .eq('user_id', userId)
    .eq('fingerprint_hash', hash)
    .maybeSingle();

  if (existing) {
    return true;
  }

  const { error } = await supabase
    .from('notification_fingerprints')
    .insert({
      user_id: userId,
      fingerprint_hash: hash,
      bank_app_id: bankAppId,
    });

  if (error) {
    if (error.code === '23505') {
      return true;
    }
    console.error('[fingerprint] Error inserting fingerprint:', error);
  }

  return false;
}

// ─── Step 1b: Second-Phase Deduplication ────────────────────────

/**
 * Deduplicate pending transactions that already exist in the database.
 *
 * Groups pending transactions by fingerprint (app_package + amount +
 * vendor + notification_timestamp to the second).  When duplicates are
 * found within a group, the oldest entry (by created_at) is kept and
 * the rest are deleted.
 *
 * Returns the deduplicated list of pending transactions.
 */
export async function deduplicatePendingTransactions(
  userId: string,
  pendingTransactions: PendingTransaction[],
): Promise<PendingTransaction[]> {
  if (pendingTransactions.length <= 1) return pendingTransactions;

  // Build fingerprint → list of pending transactions
  const groups = new Map<string, PendingTransaction[]>();

  for (const pt of pendingTransactions) {
    const hash = generateFingerprintHash(
      pt.app_package,
      pt.extracted_amount,
      pt.extracted_vendor,
      pt.notification_timestamp || 0,
    );
    const group = groups.get(hash);
    if (group) {
      group.push(pt);
    } else {
      groups.set(hash, [pt]);
    }
  }

  // Collect IDs to delete (keep the oldest in each group)
  const idsToDelete: string[] = [];
  const keepSet = new Set<string>();

  for (const group of groups.values()) {
    if (group.length <= 1) {
      keepSet.add(group[0].id);
      continue;
    }

    // Sort ascending by created_at so the oldest is first
    group.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    keepSet.add(group[0].id);
    for (let i = 1; i < group.length; i++) {
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

    const vendor = formatVendorName(vendorMatch[1].trim());
    return { vendor, amount };
  } catch {
    return null;
  }
}

/**
 * Get an existing active notification rule for (user, bank_app_id).
 */
export async function getActiveRule(
  userId: string,
  bankAppId: string,
): Promise<NotificationRuleRow | null> {
  const { data, error } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('user_id', userId)
    .eq('bank_app_id', bankAppId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .maybeSingle();

  if (error) {
    console.error('[getActiveRule] Error:', error);
    return null;
  }

  return data as NotificationRuleRow | null;
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
  const now = new Date();

  const record = {
    user_id: userId,
    app_package: input.bankAppId,
    app_name: input.bankName,
    notification_title: input.notificationTitle || input.bankName,
    notification_text: input.rawNotification,
    notification_timestamp: input.notificationTimestamp || Date.now(),
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

  const { data: override } = await supabase
    .from('vendor_overrides')
    .select('*')
    .eq('user_id', userId)
    .ilike('vendor_name', pending.extracted_vendor)
    .maybeSingle();

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

  // Check for duplicate transactions today
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabase
    .from('transactions')
    .select('id, amount, vendor')
    .eq('user_id', userId)
    .eq('vendor', pending.extracted_vendor)
    .eq('date', today);

  if (existing && existing.length > 0) {
    const hasDuplicate = existing.some(
      (tx) => Math.abs(tx.amount - pending.extracted_amount) < AMOUNT_TOLERANCE,
    );
    if (hasDuplicate) {
      await supabase
        .from('pending_transactions')
        .update({
          needs_review: true,
          validation_reasons: (pending.validation_reasons || 'OK') + '; Potential duplicate',
        })
        .eq('id', pending.id);
      return { accepted: false };
    }
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

  // ── Step 2: Look up notification rule ──
  const rule = await getActiveRule(userId, input.bankAppId);

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
    console.log('[processNotification] Regex did not match, storing with fallback data');
    const pending = await insertPendingTransaction(
      userId,
      input,
      input.fallbackVendor || 'Unknown',
      input.fallbackAmount ?? 0,
      true,
      undefined,
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

/**
 * Build regex patterns from a user's manual text selection.
 *
 * Given a notification text and the selected vendor/amount substrings,
 * generates regex patterns that capture those values using surrounding
 * context as anchors.
 */
export function buildRegexFromSelection(
  notificationText: string,
  selectedVendor: string,
  selectedAmount: string,
): { vendorRegex: string; amountRegex: string } {
  // Build amount regex: escape the surrounding context, capture the number pattern
  const amountRegex = buildCaptureRegex(notificationText, selectedAmount, true);
  const vendorRegex = buildCaptureRegex(notificationText, selectedVendor, false);

  return { vendorRegex, amountRegex };
}

/**
 * Build a regex that captures the selected text using surrounding context.
 */
function buildCaptureRegex(
  fullText: string,
  selected: string,
  isAmount: boolean,
): string {
  const idx = fullText.indexOf(selected);
  if (idx === -1) {
    // Fallback: just match the literal
    return isAmount
      ? `(\\$?[\\d,]+\\.\\d{2})`
      : `(${escapeRegex(selected)})`;
  }

  // Get surrounding context (up to 20 chars before and after)
  const beforeStart = Math.max(0, idx - 20);
  const afterEnd = Math.min(fullText.length, idx + selected.length + 20);

  let before = fullText.slice(beforeStart, idx);
  let after = fullText.slice(idx + selected.length, afterEnd);

  // Trim to word boundaries for cleaner patterns
  const beforeWordMatch = before.match(/(\s\S+\s?)$/);
  if (beforeWordMatch) {
    before = beforeWordMatch[1];
  }
  const afterWordMatch = after.match(/^(\s?\S+\s)/);
  if (afterWordMatch) {
    after = afterWordMatch[1];
  }

  // Trim whitespace edges and escape
  before = before.trimStart();
  after = after.trimEnd();

  const escapedBefore = escapeRegex(before);
  const escapedAfter = escapeRegex(after);

  // Build capture group
  let captureGroup: string;
  if (isAmount) {
    // Match dollar amounts: $1,234.56 or 1234.56
    captureGroup = '\\$?([\\d,]+\\.\\d{2})';
  } else {
    // Match vendor text: word characters, spaces, common punctuation
    captureGroup = '([A-Za-z0-9][A-Za-z0-9\\s&\'.,-]*)';
  }

  // Combine: before + capture + after
  if (escapedBefore && escapedAfter) {
    return `${escapedBefore}${captureGroup}${escapedAfter}`;
  } else if (escapedBefore) {
    return `${escapedBefore}${captureGroup}`;
  } else if (escapedAfter) {
    return `${captureGroup}${escapedAfter}`;
  }

  return captureGroup;
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
}): Promise<NotificationRuleRow | null> {
  const { userId, bankAppId, bankName, amountRegex, vendorRegex } = options;

  // Validate regex syntax
  try {
    new RegExp(amountRegex);
    new RegExp(vendorRegex);
  } catch {
    console.error('[saveNotificationRule] Invalid regex syntax');
    return null;
  }

  // Check if an active rule already exists for this bank
  const existing = await getActiveRule(userId, bankAppId);

  if (existing) {
    // Update existing rule
    const { data, error } = await supabase
      .from('notification_rules')
      .update({
        amount_regex: amountRegex,
        vendor_regex: vendorRegex,
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
  // Get all unconfigured captures for this bank
  const { data: captures, error } = await supabase
    .from('pending_transactions')
    .select('*')
    .eq('user_id', userId)
    .eq('app_package', bankAppId)
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
      // Doesn't match — mark as ignored (not a transaction notification)
      await supabase
        .from('pending_transactions')
        .update({
          needs_review: false,
          approved: false,
          validation_reasons: 'Ignored - does not match transaction format',
        })
        .eq('id', capture.id);
    }
  }
}
