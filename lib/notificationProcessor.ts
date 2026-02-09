// lib/notificationProcessor.ts
//
// End-to-end notification processing pipeline.
// Implements the 7-step flow:
//   1. Fingerprint deduplication
//   2. Regex parsing
//   3. Validation & confidence scoring
//   4. Gemini Flash invocation (authoring only)
//   5. Ignore rule check
//   6. Pending transaction insert
//   7. Auto-accept logic

import { supabase } from './supabase';
import type { PendingTransaction, ValidationBaseline } from '../types';

// ─── Constants ───────────────────────────────────────────────────

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/** Default confidence threshold if no validation_baselines row exists */
const DEFAULT_CONFIDENCE_THRESHOLD = 70;

/** Timestamp bucket size for fingerprinting (± 3 minutes) */
const FINGERPRINT_TIME_BUCKET_MS = 3 * 60 * 1000;

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
  skipReason?: 'duplicate' | 'ignored' | 'no_user';
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
  created_at: string;
  updated_at: string;
}

// ─── Step 1: Fingerprint Deduplication ──────────────────────────

/**
 * Generate a fingerprint hash from notification content.
 * Uses: bank_app_id + normalized text + timestamp bucket.
 */
function generateFingerprintHash(
  bankAppId: string,
  rawNotification: string,
  detectedAmount: number | null,
  timestamp: number,
): string {
  // Normalize: lowercase, strip extra whitespace
  const normalizedText = rawNotification.toLowerCase().replace(/\s+/g, ' ').trim();
  // Time bucket: round to nearest FINGERPRINT_TIME_BUCKET_MS
  const timeBucket = Math.floor(timestamp / FINGERPRINT_TIME_BUCKET_MS);
  const amountStr = detectedAmount != null ? detectedAmount.toFixed(2) : '';
  const raw = `${bankAppId}|${normalizedText}|${amountStr}|${timeBucket}`;

  // Simple hash (djb2) — deterministic and fast
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Check if this notification has already been processed (deduplication).
 * If not, insert the fingerprint and return false (not a duplicate).
 */
async function checkAndInsertFingerprint(
  userId: string,
  bankAppId: string,
  rawNotification: string,
  detectedAmount: number | null,
  timestamp: number,
): Promise<boolean> {
  const hash = generateFingerprintHash(bankAppId, rawNotification, detectedAmount, timestamp);

  // Check if fingerprint already exists for this user
  const { data: existing } = await supabase
    .from('notification_fingerprints')
    .select('id')
    .eq('user_id', userId)
    .eq('fingerprint_hash', hash)
    .maybeSingle();

  if (existing) {
    return true; // duplicate
  }

  // Insert new fingerprint
  const { error } = await supabase
    .from('notification_fingerprints')
    .insert({
      user_id: userId,
      fingerprint_hash: hash,
      bank_app_id: bankAppId,
    });

  if (error) {
    // If unique constraint violation, it's a concurrent duplicate
    if (error.code === '23505') {
      return true;
    }
    console.error('[fingerprint] Error inserting fingerprint:', error);
  }

  return false;
}

// ─── Step 2: Regex Parsing ──────────────────────────────────────

/**
 * Apply regex rule to extract vendor + amount from notification text.
 * Returns null if parsing fails.
 */
function applyRuleToNotification(
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

    const vendor = vendorMatch[1].trim();
    return { vendor, amount };
  } catch {
    return null;
  }
}

/**
 * Get an existing active notification rule for (user, bank_app_id).
 */
async function getActiveRule(
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

// ─── Step 3: Validation & Confidence Scoring ────────────────────

interface ValidationResult {
  confidence: number;
  reasons: string[];
  needsReview: boolean;
}

/**
 * Validate extracted vendor/amount against validation_baselines
 * and return a confidence score with reasons.
 */
async function validateExtraction(
  userId: string,
  bankAppId: string,
  vendor: string | null,
  amount: number | null,
  regexWorked: boolean,
): Promise<ValidationResult> {
  const reasons: string[] = [];
  let confidence = 100;

  // If regex didn't work at all, low confidence
  if (!regexWorked || vendor == null || amount == null) {
    confidence = 20;
    reasons.push('Regex extraction failed');
    return { confidence, reasons, needsReview: true };
  }

  // Basic structural checks
  if (vendor.length < 2) {
    confidence -= 20;
    reasons.push('Vendor name too short');
  }
  if (vendor.length > 100) {
    confidence -= 15;
    reasons.push('Vendor name unusually long');
  }
  if (amount <= 0) {
    confidence -= 30;
    reasons.push('Amount is zero or negative');
  }
  if (amount > 50000) {
    confidence -= 10;
    reasons.push('Unusually large amount');
  }

  // Check for forbidden patterns in vendor name
  const forbiddenPatterns = [/^\d+$/, /^[^a-zA-Z]+$/, /password/i, /error/i, /failed/i];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(vendor)) {
      confidence -= 25;
      reasons.push('Vendor name matches forbidden pattern');
      break;
    }
  }

  // Validate against saved baselines if available
  const { data: baseline } = await supabase
    .from('validation_baselines')
    .select('*')
    .eq('user_id', userId)
    .eq('app_package', bankAppId)
    .maybeSingle();

  if (baseline) {
    const b = baseline as ValidationBaseline;

    if (vendor.length < b.vendor_length_min) {
      confidence -= 10;
      reasons.push(`Vendor shorter than baseline min (${b.vendor_length_min})`);
    }
    if (vendor.length > b.vendor_length_max) {
      confidence -= 10;
      reasons.push(`Vendor longer than baseline max (${b.vendor_length_max})`);
    }
    if (amount < b.amount_range_min) {
      confidence -= 10;
      reasons.push(`Amount below baseline min ($${b.amount_range_min})`);
    }
    if (amount > b.amount_range_max) {
      confidence -= 10;
      reasons.push(`Amount above baseline max ($${b.amount_range_max})`);
    }

    // Check forbidden patterns from baseline
    if (b.vendor_forbidden_patterns) {
      try {
        const forbidden = b.vendor_forbidden_patterns.split(',').map(p => p.trim()).filter(Boolean);
        for (const pat of forbidden) {
          if (new RegExp(pat, 'i').test(vendor)) {
            confidence -= 20;
            reasons.push(`Vendor matches forbidden baseline pattern: ${pat}`);
            break;
          }
        }
      } catch {
        // ignore invalid patterns in baseline
      }
    }
  }

  confidence = Math.max(0, Math.min(100, confidence));

  // Determine confidence threshold
  const threshold = (baseline as ValidationBaseline | null)?.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const needsReview = confidence < threshold || reasons.length > 0;

  return { confidence, reasons, needsReview };
}

// ─── Step 4: Gemini Flash Invocation ────────────────────────────

/**
 * Call Gemini Flash to generate regex patterns for a bank notification.
 * Only called when:
 *   - No regex exists for the bank
 *   - Regex fails validation
 *   - Confidence < threshold
 */
async function generateRuleWithGemini(
  bankName: string,
  rawNotification: string,
): Promise<{
  amount_regex: string;
  vendor_regex: string;
  category_name: string;
  recurrence: string;
}> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const prompt = `
You are helping parse bank transaction notification text.

Here is a sample notification from ${bankName}:
"${rawNotification}"

Return a JSON object with these exact keys:
- "amount_regex": a JavaScript regular expression (without surrounding slashes) that matches this kind of notification and captures the numeric amount in the FIRST capturing group.
- "vendor_regex": a JavaScript regular expression (without surrounding slashes) that matches this kind of notification and captures the vendor/merchant name in the FIRST capturing group.
- "category_name": a short category name for this transaction, e.g. "Groceries", "Transport", "Utilities", "Leisure", "Housing", "Other".
- "recurrence": the likely recurrence pattern: "One-time", "Biweekly", or "Monthly".

Rules:
- Use simple, robust regex patterns.
- Make sure the first capturing group (...) is the numeric amount for amount_regex, and vendor name for vendor_regex.
- Escape special characters that appear in the notification text.
- Return ONLY valid JSON. No comments, no code blocks, no explanations.
`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' +
      GEMINI_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    console.error('[Gemini] Error:', text);
    throw new Error('Gemini API error');
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Strip code fences if present
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('[Gemini] Failed to parse response:', text);
    throw new Error('Invalid JSON from Gemini');
  }

  // Validate Gemini output
  if (!parsed.amount_regex || !parsed.vendor_regex) {
    throw new Error('Gemini response missing required regex fields');
  }

  // Validate regex is syntactically valid
  try {
    new RegExp(parsed.amount_regex);
    new RegExp(parsed.vendor_regex);
  } catch {
    throw new Error('Gemini returned invalid regex syntax');
  }

  return {
    amount_regex: parsed.amount_regex,
    vendor_regex: parsed.vendor_regex,
    category_name: parsed.category_name || 'Other',
    recurrence: parsed.recurrence || 'One-time',
  };
}

/**
 * Get or create a notification rule for a bank.
 * Calls Gemini only if no existing rule or if regex fails.
 */
async function getOrCreateRule(
  userId: string,
  bankAppId: string,
  bankName: string,
  rawNotification: string,
  regexFailed: boolean,
): Promise<NotificationRuleRow | null> {
  // Try to get existing active rule
  let rule = await getActiveRule(userId, bankAppId);

  // If rule exists and regex didn't fail, use it
  if (rule && !regexFailed) {
    return rule;
  }

  // Need Gemini: no rule exists, or regex failed
  if (!GEMINI_API_KEY) {
    console.warn('[getOrCreateRule] No GEMINI_API_KEY, cannot generate rule');
    return rule; // Return existing (possibly failing) rule, or null
  }

  try {
    const geminiResult = await generateRuleWithGemini(bankName, rawNotification);

    // Map category name to existing categories table
    let defaultCategoryId: string | null = null;
    if (geminiResult.category_name) {
      const { data: cat } = await supabase
        .from('categories')
        .select('id, name')
        .ilike('name', geminiResult.category_name)
        .maybeSingle();
      if (cat) {
        defaultCategoryId = cat.id;
      }
    }

    if (rule) {
      // Update existing rule with new regex (don't increment flagged_count;
      // that tracks user-reported flags, not automated regeneration)
      const { data: updated, error } = await supabase
        .from('notification_rules')
        .update({
          amount_regex: geminiResult.amount_regex,
          vendor_regex: geminiResult.vendor_regex,
          default_category_id: defaultCategoryId,
        })
        .eq('id', rule.id)
        .select()
        .single();

      if (error) {
        console.error('[getOrCreateRule] Error updating rule:', error);
        return rule;
      }
      return updated as NotificationRuleRow;
    } else {
      // Insert new rule
      const { data: inserted, error } = await supabase
        .from('notification_rules')
        .insert({
          user_id: userId,
          bank_app_id: bankAppId,
          bank_name: bankName,
          amount_regex: geminiResult.amount_regex,
          vendor_regex: geminiResult.vendor_regex,
          default_category_id: defaultCategoryId,
        })
        .select()
        .single();

      if (error) {
        console.error('[getOrCreateRule] Error inserting rule:', error);
        return null;
      }
      return inserted as NotificationRuleRow;
    }
  } catch (err) {
    console.error('[getOrCreateRule] Gemini invocation failed:', err);
    return rule;
  }
}

// ─── Step 5: Ignore Rule Check ──────────────────────────────────

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
  // Query ignore rules for this user and vendor
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
    // Check expiration
    if (rule.expires_at && new Date(rule.expires_at) < now) {
      continue; // Rule expired
    }

    // Check bank scope
    if (rule.bank_app_id && rule.bank_app_id !== bankAppId) {
      continue; // Different bank
    }

    // Check amount match (if specified)
    if (rule.amount != null && amount != null) {
      if (Math.abs(rule.amount - amount) > AMOUNT_TOLERANCE) {
        continue; // Amount doesn't match
      }
    }

    // All conditions matched
    return true;
  }

  return false;
}

// ─── Step 6: Pending Transaction Insert ─────────────────────────

/**
 * Insert a parsed notification into pending_transactions.
 */
async function insertPendingTransaction(
  userId: string,
  input: NotificationInput,
  vendor: string,
  amount: number,
  confidence: number,
  validationReasons: string[],
  needsReview: boolean,
  ruleId?: string,
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
    confidence,
    validation_reasons: validationReasons.length > 0 ? validationReasons.join('; ') : 'OK',
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

// ─── Step 7: Auto-Accept Logic ──────────────────────────────────

/**
 * Check if a pending transaction can be auto-accepted.
 * Auto-accept is allowed only if:
 *   - Confidence >= threshold
 *   - No validation flags
 *   - No likely conflict with existing transactions
 */
async function tryAutoAccept(
  userId: string,
  pending: PendingTransaction,
  defaultCategoryId: string | null,
  confidenceThreshold: number,
): Promise<{ accepted: boolean; transactionId?: string; categoryId?: string }> {
  // Must meet confidence threshold
  if (pending.confidence < confidenceThreshold) {
    return { accepted: false };
  }

  // Must have no validation issues
  if (pending.needs_review) {
    return { accepted: false };
  }

  // Check for potential conflicts with existing transactions
  // (same vendor + similar amount + same day)
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabase
    .from('transactions')
    .select('id, amount, vendor')
    .eq('user_id', userId)
    .eq('vendor', pending.extracted_vendor)
    .eq('date', today);

  if (existing && existing.length > 0) {
    // Check for a transaction with the same amount already today
    const hasDuplicate = existing.some(
      (tx) => Math.abs(tx.amount - pending.extracted_amount) < AMOUNT_TOLERANCE,
    );
    if (hasDuplicate) {
      // Mark as needs_review due to potential duplicate
      await supabase
        .from('pending_transactions')
        .update({
          needs_review: true,
          validation_reasons: (pending.validation_reasons || 'OK') + '; Potential duplicate of existing transaction',
        })
        .eq('id', pending.id);
      return { accepted: false };
    }
  }

  // Look up category: user vendor override > rule default > 'Other'
  let categoryId = defaultCategoryId;

  const { data: override } = await supabase
    .from('vendor_overrides')
    .select('category_id')
    .eq('user_id', userId)
    .ilike('vendor_name', pending.extracted_vendor)
    .maybeSingle();

  if (override) {
    categoryId = override.category_id;
  }

  // If still no category, use 'Other'
  if (!categoryId) {
    const { data: otherCat } = await supabase
      .from('categories')
      .select('id')
      .eq('name', 'Other')
      .maybeSingle();
    categoryId = otherCat?.id || null;
  }

  if (!categoryId) {
    // Can't auto-accept without a category
    return { accepted: false };
  }

  // Insert into transactions
  const transactionId = crypto.randomUUID();
  const { error: txError } = await supabase
    .from('transactions')
    .insert({
      id: transactionId,
      user_id: userId,
      vendor: pending.extracted_vendor,
      amount: pending.extracted_amount,
      date: new Date().toISOString().slice(0, 10),
      category_id: categoryId,
      recurrence: 'One-time',
      label: 'Auto-Added',
      is_projected: false,
    });

  if (txError) {
    console.error('[autoAccept] Error inserting transaction:', txError);
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
 * Process an incoming bank notification through the full pipeline.
 *
 * Steps:
 *   1. Fingerprint deduplication
 *   2. Regex parsing
 *   3. Validation & confidence scoring
 *   4. Gemini Flash (if needed)
 *   5. Ignore rule check
 *   6. Pending transaction insert
 *   7. Auto-accept logic
 */
export async function processNotification(
  userId: string,
  input: NotificationInput,
): Promise<ProcessingResult> {
  const timestamp = input.notificationTimestamp || Date.now();

  // ── Step 1: Fingerprint Deduplication ──
  // Quick amount extraction for fingerprinting (best effort, pre-regex)
  let quickAmount: number | null = null;
  const quickAmountMatch = input.rawNotification.match(/\$?([\d,]+\.?\d{0,2})/);
  if (quickAmountMatch) {
    quickAmount = parseFloat(quickAmountMatch[1].replace(',', ''));
  }

  const isDuplicate = await checkAndInsertFingerprint(
    userId,
    input.bankAppId,
    input.rawNotification,
    quickAmount,
    timestamp,
  );

  if (isDuplicate) {
    console.log('[processNotification] Duplicate fingerprint, skipping');
    return { processed: false, skipReason: 'duplicate' };
  }

  // ── Step 2: Regex Parsing ──
  let rule = await getActiveRule(userId, input.bankAppId);
  let parsed: { vendor: string; amount: number } | null = null;
  let regexFailed = false;

  if (rule) {
    parsed = applyRuleToNotification(
      rule.amount_regex,
      rule.vendor_regex,
      input.rawNotification,
    );
    if (!parsed) {
      regexFailed = true;
    }
  }

  // ── Step 3: Validation & Confidence Scoring ──
  let validation = await validateExtraction(
    userId,
    input.bankAppId,
    parsed?.vendor ?? null,
    parsed?.amount ?? null,
    !regexFailed && parsed != null,
  );

  // ── Step 4: Gemini Flash (if needed) ──
  // Get the confidence threshold from baselines
  const { data: baseline } = await supabase
    .from('validation_baselines')
    .select('confidence_threshold')
    .eq('user_id', userId)
    .eq('app_package', input.bankAppId)
    .maybeSingle();

  const confidenceThreshold = (baseline as { confidence_threshold: number } | null)?.confidence_threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  const needsGemini = !rule || regexFailed || validation.confidence < confidenceThreshold;

  if (needsGemini) {
    // Pass true for regexFailed when confidence is below threshold,
    // so getOrCreateRule calls Gemini to regenerate patterns
    const shouldRegenerate = regexFailed || validation.confidence < confidenceThreshold;
    const updatedRule = await getOrCreateRule(
      userId,
      input.bankAppId,
      input.bankName,
      input.rawNotification,
      shouldRegenerate,
    );

    if (updatedRule && updatedRule !== rule) {
      rule = updatedRule;
      // Re-apply regex with new/updated rule
      parsed = applyRuleToNotification(
        rule.amount_regex,
        rule.vendor_regex,
        input.rawNotification,
      );
      // Re-validate
      validation = await validateExtraction(
        userId,
        input.bankAppId,
        parsed?.vendor ?? null,
        parsed?.amount ?? null,
        parsed != null,
      );
    }
  }

  // Final vendor/amount (use fallbacks if regex still failed)
  const finalVendor = parsed?.vendor || input.fallbackVendor || 'Unknown Merchant';
  const finalAmount = parsed?.amount ?? input.fallbackAmount ?? 0;

  // If regex failed but we have usable fallback values, re-validate with those
  // so the user sees reasonable confidence instead of "Regex extraction failed"
  if (!parsed && (input.fallbackVendor || input.fallbackAmount != null)) {
    validation = await validateExtraction(
      userId,
      input.bankAppId,
      finalVendor,
      finalAmount,
      false, // regex didn't work, but we have fallback data
    );
    // If fallback values are reasonable, improve confidence and adjust reasons
    if (finalVendor !== 'Unknown Merchant' && finalAmount > 0) {
      validation.reasons = validation.reasons.filter(r => r !== 'Regex extraction failed');
      validation.reasons.push('Used fallback extraction (regex unavailable)');
      // Give moderate confidence for fallback values
      validation.confidence = Math.max(validation.confidence, 50);
      validation.needsReview = true; // Always review fallback-based transactions
    }
  }

  // ── Step 5: Ignore Rule Check ──
  const ignored = await shouldIgnore(userId, finalVendor, finalAmount, input.bankAppId);

  if (ignored) {
    console.log('[processNotification] Notification ignored by user rule');
    return { processed: false, skipReason: 'ignored' };
  }

  // ── Step 6: Pending Transaction Insert ──
  const pending = await insertPendingTransaction(
    userId,
    input,
    finalVendor,
    finalAmount,
    validation.confidence,
    validation.reasons,
    validation.needsReview,
    rule?.id,
  );

  if (!pending) {
    return { processed: true };
  }

  // ── Step 7: Auto-Accept Logic ──
  const autoResult = await tryAutoAccept(
    userId,
    pending,
    rule?.default_category_id ?? null,
    confidenceThreshold,
  );

  return {
    processed: true,
    pendingTransaction: pending,
    autoAccepted: autoResult.accepted,
    transactionId: autoResult.transactionId,
    categoryId: autoResult.categoryId,
  };
}

// ─── Flag & Regenerate (user-reported incorrect parse) ──────────

/**
 * When the user marks a transaction as incorrectly parsed:
 * 1) Enforce rate limits via flag_reports (max 1/24h, max 5/7d)
 * 2) Insert a row into flag_reports
 * 3) Call Gemini again to regenerate regex for the bank
 * 4) Update notification_rules with new regex + flagged_count
 */
export async function flagAndRegenerateRule(options: {
  userId: string;
  notificationRuleId: string;
  rawNotification: string;
  expectedVendor?: string;
  expectedAmount?: number;
}): Promise<void> {
  const { userId, notificationRuleId, rawNotification, expectedVendor, expectedAmount } = options;

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1) Rate limiting: 1 flag per 24 hours
  const { count: lastDayCount, error: lastDayError } = await supabase
    .from('flag_reports')
    .select('*', { head: true, count: 'exact' })
    .eq('user_id', userId)
    .gte('created_at', oneDayAgo);

  if (lastDayError) {
    console.error('[flagAndRegenerate] 24h rate limit error:', lastDayError);
    throw lastDayError;
  }

  if ((lastDayCount ?? 0) >= 1) {
    throw new Error('You can only flag one transaction every 24 hours.');
  }

  // 2) Rate limiting: max 5 flags per week
  const { count: lastWeekCount, error: lastWeekError } = await supabase
    .from('flag_reports')
    .select('*', { head: true, count: 'exact' })
    .eq('user_id', userId)
    .gte('created_at', oneWeekAgo);

  if (lastWeekError) {
    console.error('[flagAndRegenerate] weekly rate limit error:', lastWeekError);
    throw lastWeekError;
  }

  if ((lastWeekCount ?? 0) >= 5) {
    throw new Error('You can only flag up to 5 transactions per week.');
  }

  // 3) Insert into flag_reports
  const { error: flagError } = await supabase
    .from('flag_reports')
    .insert({
      user_id: userId,
      notification_rule_id: notificationRuleId,
      raw_notification: rawNotification,
      expected_vendor: expectedVendor,
      expected_amount: expectedAmount,
    });

  if (flagError) {
    console.error('[flagAndRegenerate] Error inserting flag_reports:', flagError);
    throw flagError;
  }

  // 4) Fetch the existing rule so we know bank_name and current flagged_count
  const { data: rule, error: ruleError } = await supabase
    .from('notification_rules')
    .select('*')
    .eq('id', notificationRuleId)
    .maybeSingle();

  if (ruleError || !rule) {
    console.error('[flagAndRegenerate] Error fetching notification_rule:', ruleError);
    throw ruleError ?? new Error('Notification rule not found');
  }

  // 5) Call Gemini to regenerate regex
  const geminiResult = await generateRuleWithGemini(rule.bank_name, rawNotification);

  // Map new category_name to categories table
  let newDefaultCategoryId: string | null = rule.default_category_id;
  if (geminiResult.category_name) {
    const { data: cat } = await supabase
      .from('categories')
      .select('id, name')
      .ilike('name', geminiResult.category_name)
      .maybeSingle();
    if (cat) {
      newDefaultCategoryId = cat.id;
    }
  }

  // 6) Update notification_rules with new regex + counters
  const { error: updateError } = await supabase
    .from('notification_rules')
    .update({
      amount_regex: geminiResult.amount_regex,
      vendor_regex: geminiResult.vendor_regex,
      default_category_id: newDefaultCategoryId,
      flagged_count: (rule.flagged_count ?? 0) + 1,
      last_flagged_at: new Date().toISOString(),
    })
    .eq('id', notificationRuleId);

  if (updateError) {
    console.error('[flagAndRegenerate] Error updating notification_rule:', updateError);
    throw updateError;
  }
}
