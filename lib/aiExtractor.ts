// lib/aiExtractor.ts
//
// Client-side AI-powered notification extraction using Transformers.js.
// Runs a text-generation model (Xenova/flan-t5-small) entirely on-device
// via ONNX Runtime / WebAssembly — no cloud API calls.
//
// Extracts vendor name, amount, and determines if a notification
// is an actual transaction (purchase/charge/payment) or not.
// Also classifies into a budget category.
//
// NEW (2026-07): Single-prompt extraction, confidence scoring,
// semantic vendor matching, recurring detection, refund pairing,
// rejection explanations, and smart match-pattern suggestions.

import { log } from './log';
import type { Text2TextGenerationPipeline } from '@huggingface/transformers';
import { formatVendorName } from './formatVendorName';
import { BANK_NAME_PREFIXES, isCommonNounOnly } from './deviceTransactionParser';

// ─── Types ───────────────────────────────────────────────────────

export interface AIExtractionResult {
  /** Whether the notification represents a real transaction */
  isTransaction: boolean;
  /** Cleaned vendor name (e.g., "Subway" from "Subway#327") */
  vendor: string | null;
  /** Dollar amount extracted */
  amount: number | null;
  /** AI-suggested budget category name */
  suggestedCategory: string | null;
  /** Reason for rejection if not a transaction */
  rejectionReason: string | null;
  /** AI confidence in this extraction: 0.0–1.0 */
  confidence: number;
  /** Human-readable confidence label */
  confidenceLabel: 'high' | 'medium' | 'low';
  /** Why the confidence is what it is */
  confidenceReasons: string[];
}

// ═════════════════════════════════════════════════════════════════
// 1. AI MODEL — singleton lazy-loaded Flan-T5 pipeline
// ═════════════════════════════════════════════════════════════════

const MODEL_ID = 'Xenova/flan-t5-small';

let generatorPromise: Promise<Text2TextGenerationPipeline> | null = null;

// The transformers runtime (plus ONNX Runtime Web) is ~2.2MB of the bundle —
// more than the rest of the app combined. Importing it here rather than at
// module scope keeps it out of the entry chunk, so it is fetched the first
// time the model is actually needed instead of on every cold start. The
// regex parser in deviceTransactionParser handles the common case and this
// is only its fallback, so nothing waits on it at boot.
function getGenerator(): Promise<Text2TextGenerationPipeline> {
  if (!generatorPromise) {
    log.debug('[aiExtractor] Loading AI model:', MODEL_ID);
    generatorPromise = import('@huggingface/transformers').then(({ pipeline }) => {
      // `pipeline` is cast before the call: resolving its full task overload
      // union without a contextual return type overflows the checker (TS2590).
      // The result is re-typed on the way out, so callers are unaffected.
      const loadPipeline = pipeline as (
        task: string,
        model: string,
        options: { device: string },
      ) => Promise<Text2TextGenerationPipeline>;
      return loadPipeline('text2text-generation', MODEL_ID, { device: 'wasm' });
    }).then(gen => {
      log.debug('[aiExtractor] AI model loaded successfully');
      return gen;
    }).catch(err => {
      log.error('[aiExtractor] Failed to load AI model:', err);
      generatorPromise = null;
      throw err;
    });
  }
  return generatorPromise;
}

export function preloadAIModel(): Promise<void> {
  return getGenerator().then(() => {}).catch(() => {});
}

async function aiGenerate(prompt: string, maxTokens = 64): Promise<string> {
  const generator = await getGenerator();
  const output = await generator(prompt, {
    max_new_tokens: maxTokens,
    temperature: 0,
  });
  const result = Array.isArray(output) ? output[0] : output;
  return (result as any)?.generated_text?.trim() || '';
}

// ═════════════════════════════════════════════════════════════════
// 2. SINGLE-PROMPT STRUCTURED EXTRACTION
// ═════════════════════════════════════════════════════════════════

const DEFAULT_CATEGORIES = ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other'];

/** One confirmed vendor -> category decision the user has already made. */
export interface LearnedVendorExample {
  vendor: string;
  category: string;
}

/** How many learned examples to put in the prompt. */
const MAX_LEARNED_EXAMPLES = 5;

function exampleTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 3);
}

/**
 * Pick the learned examples most likely to help with THIS notification.
 *
 * The model is flan-t5-small — a small context window and 64 new tokens — so
 * the corpus cannot simply be dumped in. Examples sharing a token with the
 * incoming text are far more useful ("COSTCO GAS -> Transport" when the
 * notification says COSTCO), so those rank first; the rest fill the remaining
 * slots most-recent-first, which keeps the model anchored to how this
 * particular user categorizes things.
 */
export function selectLearnedExamples(
  notificationText: string,
  learned: LearnedVendorExample[],
  limit: number = MAX_LEARNED_EXAMPLES,
): LearnedVendorExample[] {
  if (!learned.length || limit <= 0) return [];
  const textTokens = new Set(exampleTokens(notificationText));

  const scored = learned
    .filter((e) => e && e.vendor && e.category)
    .map((e, i) => {
      const overlap = exampleTokens(e.vendor).some((t) => textTokens.has(t)) ? 1 : 0;
      return { e, overlap, i };
    });

  // Stable: relevant first, then original order (callers pass most-recent-first).
  scored.sort((a, b) => b.overlap - a.overlap || a.i - b.i);

  const seen = new Set<string>();
  const out: LearnedVendorExample[] = [];
  for (const { e } of scored) {
    const key = e.vendor.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Extract vendor, category, and transaction status in a SINGLE prompt.
 * Returns structured data with confidence scoring.
 */
export async function extractWithAI(
  notificationText: string,
  availableCategories: string[],
  /**
   * Vendor -> category decisions the user has already confirmed. Passed into
   * the prompt as few-shot examples so the model follows this user's habits
   * rather than a generic prior. This is how capture improves over time: the
   * on-device model cannot be fine-tuned, but it can be shown precedent.
   */
  learnedExamples: LearnedVendorExample[] = [],
): Promise<AIExtractionResult> {
  const text = notificationText.trim();
  if (!text) {
    return {
      isTransaction: false, vendor: null, amount: null,
      suggestedCategory: null, rejectionReason: 'Empty notification',
      confidence: 0, confidenceLabel: 'low', confidenceReasons: ['Empty input'],
    };
  }

  // ── 1. Extract amount (simple parsing — amounts are unambiguous) ──
  const amount = extractAmount(text);
  if (amount === null) {
    return {
      isTransaction: false, vendor: null, amount: null,
      suggestedCategory: null, rejectionReason: 'No dollar amount found',
      confidence: 0, confidenceLabel: 'low', confidenceReasons: ['No amount detected'],
    };
  }

  // ── 2. Try rule-based vendor extraction first (fast, deterministic) ──
  const ruleResult = ruleBasedVendorExtraction(text);
  if (!ruleResult.isTransaction) {
    return {
      isTransaction: false, vendor: null, amount,
      suggestedCategory: null, rejectionReason: ruleResult.rejectionReason,
      confidence: 0.95, confidenceLabel: 'high',
      confidenceReasons: ['Rule-based rejection: ' + ruleResult.rejectionReason],
    };
  }

  // ── 3. Single AI prompt for vendor + category + confidence ──
  const categories = availableCategories.length > 0 ? availableCategories : DEFAULT_CATEGORIES;
  const hasRuleVendor = !!ruleResult.vendor;
  const vendorHint = hasRuleVendor ? `Rule-based vendor: "${ruleResult.vendor}". ` : '';

  // Few-shot block: this user's own past corrections, most relevant first.
  const examples = selectLearnedExamples(text, learnedExamples);
  const exampleBlock = examples.length
    ? `How this user categorizes merchants:\n` +
      examples.map((e) => `${e.vendor} -> ${e.category}`).join('\n') +
      `\n\n`
    : '';

  const prompt =
    exampleBlock +
    `${vendorHint}Analyze this bank notification and reply in this exact format (one per line):\n` +
    `Vendor: <merchant name, or NONE if not a purchase/payment>\n` +
    `Category: <best from: ${categories.join(', ')}>\n` +
    `IsTransaction: <yes or no>\n` +
    `Confidence: <high, medium, or low>\n` +
    `Reason: <one sentence why>\n\n` +
    `Notification: "${text.slice(0, 400)}"`;

  let aiResponse: string;
  try {
    aiResponse = await aiGenerate(prompt, 64);
  } catch (err) {
    // AI failed — fall back to rule-based result
    if (hasRuleVendor) {
      return {
        isTransaction: true,
        vendor: polishVendor(ruleResult.vendor!),
        amount,
        suggestedCategory: null,
        rejectionReason: null,
        confidence: 0.7, confidenceLabel: 'medium',
        confidenceReasons: ['AI model unavailable, used rule-based extraction'],
      };
    }
    return {
      isTransaction: false, vendor: null, amount,
      suggestedCategory: null, rejectionReason: 'AI model not available',
      confidence: 0, confidenceLabel: 'low', confidenceReasons: ['AI model failed to load'],
    };
  }

  // ── 4. Parse structured response ──
  const parsed = parseStructuredResponse(aiResponse, categories);

  // If AI says not a transaction, trust it
  if (!parsed.isTransaction) {
    return {
      isTransaction: false,
      vendor: parsed.vendor,
      amount,
      suggestedCategory: null,
      rejectionReason: parsed.reason || 'AI determined this is not a transaction',
      confidence: parsed.confidence,
      confidenceLabel: parsed.confidenceLabel,
      confidenceReasons: [parsed.reason || 'AI rejection'],
    };
  }

  // Use rule-based vendor if AI didn't find one, otherwise use AI's.
  //
  // The AI's answer is NOT trusted verbatim. parseAIResponse only rejects the
  // literal strings NONE/N/A/NO/UNKNOWN, so a common-noun answer would reach
  // the DB unchallenged. `isCommonNounOnly` is the same gate the rule parser
  // already applies to its own output; the AI path simply never had it.
  //
  // CORRECTION: this guard was originally added believing it explained a real
  // capture that read "$16.54 at a purchase" — supposedly the model echoing its
  // own prompt ("Vendor: <merchant name, or NONE if not a purchase/payment>").
  // That was wrong. "a purchase" is a hardcoded fallback in
  // android-custom/NotificationListener.java's notifyCaptured(), used whenever
  // the NATIVE extractor finds no vendor. The AI was never involved.
  //
  // The guard is kept because it is correct on its own terms — a common-noun
  // vendor is worse than no vendor, since it reaches the DB and the cross-app
  // duplicate check compares vendor names to decide what to collapse — but it
  // is not the fix for that symptom, and should not be credited with it.
  let aiVendor = parsed.vendor;
  if (aiVendor && isCommonNounOnly(aiVendor)) {
    log.warn(`[aiExtractor] Discarding common-noun AI vendor: "${aiVendor}"`);
    aiVendor = null;
  }

  let finalVendor = aiVendor;
  if (!finalVendor && hasRuleVendor) {
    finalVendor = polishVendor(ruleResult.vendor!);
  } else if (finalVendor) {
    finalVendor = polishVendor(finalVendor);
  }

  // The rule vendor is a fallback, not a free pass — check it too.
  if (finalVendor && isCommonNounOnly(finalVendor)) {
    finalVendor = null;
  }

  if (!finalVendor || finalVendor.length < 2) {
    return {
      isTransaction: false, vendor: null, amount,
      suggestedCategory: null, rejectionReason: 'No vendor name found',
      confidence: 0.3, confidenceLabel: 'low',
      confidenceReasons: ['AI and rules both failed to extract vendor'],
    };
  }

  // Boost confidence if rule-based vendor matches AI vendor
  const reasons: string[] = [];
  let confidence = parsed.confidence;
  if (hasRuleVendor && ruleResult.vendor && finalVendor.toLowerCase().includes(ruleResult.vendor.toLowerCase().slice(0, 4))) {
    confidence = Math.min(1.0, confidence + 0.15);
    reasons.push('Rule-based and AI vendor agree');
  }
  reasons.push(parsed.reason || 'AI extraction');

  return {
    isTransaction: true,
    vendor: finalVendor,
    amount,
    suggestedCategory: parsed.suggestedCategory,
    rejectionReason: null,
    confidence,
    confidenceLabel: parsed.confidenceLabel,
    confidenceReasons: reasons,
  };
}

// ── Response parser ──
function parseStructuredResponse(
  text: string,
  availableCategories: string[],
): {
  vendor: string | null;
  suggestedCategory: string | null;
  isTransaction: boolean;
  confidence: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  reason: string | null;
} {
  const vendorMatch = text.match(/Vendor:\s*(.+)/i);
  const categoryMatch = text.match(/Category:\s*(.+)/i);
  const isTxMatch = text.match(/IsTransaction:\s*(yes|no)/i);
  const confMatch = text.match(/Confidence:\s*(high|medium|low)/i);
  const reasonMatch = text.match(/Reason:\s*(.+)/i);

  const vendorRaw = vendorMatch?.[1]?.trim();
  const vendor = vendorRaw && !/^(NONE|N\/A|NO|UNKNOWN)$/i.test(vendorRaw)
    ? vendorRaw
    : null;

  const isTransaction = isTxMatch?.[1]?.toLowerCase() === 'yes';

  const confLabel = (confMatch?.[1]?.toLowerCase() || 'low') as 'high' | 'medium' | 'low';
  const confidenceMap = { high: 0.9, medium: 0.7, low: 0.5 };
  const confidence = confidenceMap[confLabel] || 0.5;

  // Match category against whitelist
  let suggestedCategory: string | null = null;
  const catRaw = categoryMatch?.[1]?.trim();
  if (catRaw) {
    const catLower = catRaw.toLowerCase();
    for (const cat of availableCategories) {
      if (catLower.includes(cat.toLowerCase())) {
        suggestedCategory = cat;
        break;
      }
    }
  }

  return {
    vendor,
    suggestedCategory,
    isTransaction,
    confidence,
    confidenceLabel: confLabel,
    reason: reasonMatch?.[1]?.trim() || null,
  };
}

// ═════════════════════════════════════════════════════════════════
// 4. SMART RECURRING DETECTION
// ═════════════════════════════════════════════════════════════════

export async function aiDetectRecurring(
  vendor: string,
  history: { date: string; amount: number }[],
  newAmount: number,
): Promise<'One-time' | 'Biweekly' | 'Monthly'> {
  if (history.length < 2) return 'One-time';

  // Heuristic: if all amounts are identical, likely recurring
  const uniqueAmounts = new Set(history.map(h => h.amount.toFixed(2)));
  if (uniqueAmounts.size === 1 && Math.abs(history[0].amount - newAmount) < 0.01) {
    // Check date spacing
    const dates = history.map(h => new Date(h.date).getTime()).sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push((dates[i] - dates[i - 1]) / (24 * 60 * 60 * 1000));
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap >= 12 && avgGap <= 35) return 'Monthly';
    if (avgGap >= 10 && avgGap <= 18) return 'Biweekly';
  }

  // AI fallback for ambiguous patterns
  const recent = history.slice(-6);
  const prompt =
    `This user has transactions from ${vendor}:\n` +
    recent.map(h => `- ${h.date}: $${h.amount.toFixed(2)}`).join('\n') +
    `\nNew charge: $${newAmount.toFixed(2)}\n` +
    `Is this likely: One-time, Biweekly, or Monthly? Answer with one word.`;

  try {
    const result = await aiGenerate(prompt, 8);
    const r = result.toLowerCase();
    if (r.includes('month')) return 'Monthly';
    if (r.includes('biweek') || r.includes('bi-week')) return 'Biweekly';
  } catch {
    // fall through
  }
  return 'One-time';
}

// ═════════════════════════════════════════════════════════════════
// 5. AI REFUND PAIRING
// ═════════════════════════════════════════════════════════════════

export async function aiFindRefundMatch(
  refundVendor: string,
  refundAmount: number,
  expenses: { id: string; vendor: string; amount: number; date: string }[],
): Promise<string | null> {
  if (expenses.length === 0) return null;

  // Heuristic: exact amount match first
  const exactMatch = expenses.find(e => Math.abs(e.amount - refundAmount) < 0.01);
  if (exactMatch) {
    // Check if vendors are similar enough
    const rWords = refundVendor.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
    const eWords = exactMatch.vendor.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
    const overlap = rWords.filter(w => eWords.some(ew => ew.includes(w) || w.includes(ew)));
    if (overlap.length > 0) return exactMatch.id;
  }

  // AI fallback for vendor-name mismatches
  const topExpenses = expenses.slice(0, 10);
  const prompt =
    `Refund: "${refundVendor}" $${refundAmount.toFixed(2)}\n` +
    `Expenses:\n` +
    topExpenses.map((e, i) => `${i + 1}. ${e.vendor} $${e.amount.toFixed(2)} (${e.date})`).join('\n') +
    `\n\nWhich expense does this refund offset? Reply with the number, or NONE.`;

  try {
    const result = await aiGenerate(prompt, 8);
    const num = parseInt(result.match(/\d+/)?.[0] || '0');
    if (num >= 1 && num <= topExpenses.length) {
      return topExpenses[num - 1].id;
    }
  } catch {
    // fall through
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════
// LEGACY / INTERNAL HELPERS
// ═════════════════════════════════════════════════════════════════

/** Non-transaction indicator patterns */
const NON_TRANSACTION_PATTERNS = [
  /verification\s+code/i, /\botp\b/i, /account\s+balance/i,
  /\bsign\s+in\b/i, /\blogged\s+in\b/i, /reward\s+points/i,
  /\bcashback\b/i, /payment\s+is\s+due/i, /\bis\s+due\b/i,
  /direct\s+deposit/i, /\bpayroll\b/i,
  /\btransfer\b.*\b(?:between|from\s+your)\b/i,
  /has\s+been\s+delivered/i, /\bpromotion(?:al)?\b/i,
  /\bcredit\s+score\b/i, /\bpassword\b/i, /\bsecurity\s+alert\b/i,
  /\b(?:ETH|BTC|SOL|ADA|DOT|DOGE|XRP|MATIC|AVAX|LINK|LTC|BNB|SHIB)\b.*?\b(?:up|down|trading|price|market)/i,
  /\b(?:is\s+)?trading\s+at\b/i, /\bmarket\s+cap\b/i, /\bprice\s+alert\b/i,
  /\b(?:limited\s+time|act\s+now|don't\s+miss|exclusive\s+offer)\b/i,
  /\b(?:promo\s+code|coupon\s+code|discount\s+code)\b/i,
];

function ruleBasedVendorExtraction(text: string): { vendor: string | null; isTransaction: boolean; rejectionReason: string | null } {
  for (const pattern of NON_TRANSACTION_PATTERNS) {
    if (pattern.test(text)) {
      return { vendor: null, isTransaction: false, rejectionReason: 'Not a cost-related notification' };
    }
  }

  let stripped = text.trim();
  const strippedLower = stripped.toLowerCase();
  for (const prefix of BANK_NAME_PREFIXES) {
    if (strippedLower.startsWith(prefix + ' ')) {
      stripped = stripped.slice(prefix.length).trim();
      break;
    }
  }

  const atMatch = stripped.match(/\bat\s+(.+?)(?:\s+(?:on\s+your|for\s+|using\s+|via\s+|ending\s+|with\s+your)\b|\s*\.?\s*$)/i);
  if (atMatch?.[1]) {
    const v = atMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  const fromMatch = stripped.match(/\bfrom\s+(.+?)(?:\s+(?:was\s+|for\s+|on\s+your|using\s+|has\s+been)\b|\s*\.?\s*$)/i);
  if (fromMatch?.[1]) {
    const v = fromMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  const paidToMatch = stripped.match(/\bpaid\s+to\s+(.+?)(?:\s*\.?\s*$)/i);
  if (paidToMatch?.[1]) {
    const v = paidToMatch[1].trim();
    if (v.length >= 2) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  const dollarToMatch = stripped.match(/\$[\d,]+\.?\d*\s+to\s+(.+?)(?:\s+(?:for\s+|on\s+|was\s+)\b|\s*\.?\s*$)/i);
  if (dollarToMatch?.[1]) {
    const v = dollarToMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  const dollarFromMatch = stripped.match(/\$[\d,]+\.?\d*\s+from\s+(.+?)(?:\s+(?:for\s+|on\s+|was\s+)\b|\s*\.?\s*$)/i);
  if (dollarFromMatch?.[1]) {
    const v = dollarFromMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  const withMatch = stripped.match(/\bwith\s+(.+?)(?:\s+(?:was\s+|on\s+your|has\s+been|for\s+)\b|\s*\.?\s*$)/i);
  if (withMatch?.[1]) {
    const v = withMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  const titleMatch = stripped.match(/^([A-Z][A-Za-z0-9 .&'+*()-]*?)(?:\s+(?:\(.*?\)\s+)?(?:You|Your|A |An |The |We |This |Payment|Charged))/i);
  if (titleMatch?.[1]) {
    let title = titleMatch[1].replace(/\s*\(.*?\)\s*/g, '').trim();
    if (title.length >= 2) return { vendor: title, isTransaction: true, rejectionReason: null };
  }

  return { vendor: null, isTransaction: true, rejectionReason: null };
}

function extractAmount(text: string): number | null {
  const dollarMatch = text.match(/\$([\d,]+(?:\.\d{1,2})?)/) || text.match(/\$([\d,]+)/);
  if (dollarMatch?.[1]) {
    const parsed = parseFloat(dollarMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const currPrefixMatch = text.match(/(?:USD|CAD|GBP|EUR|AUD)\s*([\d,]+\.\d{2})/i);
  if (currPrefixMatch?.[1]) {
    const parsed = parseFloat(currPrefixMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  const currSuffixMatch = text.match(/([\d,]+\.\d{2})\s*(?:USD|CAD|GBP|EUR|AUD|dollars?)/i);
  if (currSuffixMatch?.[1]) {
    const parsed = parseFloat(currSuffixMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
}

const VENDOR_CORRECTIONS: Record<string, string> = {
  'amzn': 'Amazon', 'amzn mktp': 'Amazon', 'amzn mktplace': 'Amazon',
  'amazon.ca': 'Amazon', 'amazon.com': 'Amazon', 'amzn digital': 'Amazon',
  'amazon prime': 'Amazon Prime', 'prime video': 'Amazon Prime',
  'wm supercenter': 'Walmart', 'wal-mart': 'Walmart', 'wal mart': 'Walmart',
  'walmrt': 'Walmart', 'walmart supercenter': 'Walmart', 'walmart store': 'Walmart',
  "mcdonald's": "McDonald's", 'mcdonalds': "McDonald's", 'mcdnlds': "McDonald's",
  "mcd's": "McDonald's", 'mcd': "McDonald's",
  'starbux': 'Starbucks', 'sbux': 'Starbucks', 'starbuck': 'Starbucks',
  'tim hortons': 'Tim Hortons', "tim horton's": 'Tim Hortons', 'tims': 'Tim Hortons',
  'timhortons': 'Tim Hortons', 'tim horton': 'Tim Hortons',
  'chick fil a': 'Chick-fil-A', 'chickfila': 'Chick-fil-A', 'cfa': 'Chick-fil-A',
  'chick-fil-a': 'Chick-fil-A',
  'sprt chek': 'Sport Chek', 'sprt check': 'Sport Chek', 'sport check': 'Sport Chek',
  'cdn tire': 'Canadian Tire', 'can tire': 'Canadian Tire', 'canadian tire': 'Canadian Tire',
  'ct corp': 'Canadian Tire',
  'costco whse': 'Costco', 'costco wholesale': 'Costco',
  'dollarama': 'Dollarama',
  'shoppers drug mart': 'Shoppers Drug Mart', 'shoppers': 'Shoppers Drug Mart',
  'sdm': 'Shoppers Drug Mart', 'shoppers drug': 'Shoppers Drug Mart',
  'lndlrd': 'Landlord',
  'rcss': 'Real Canadian Superstore', 'real cdn superstore': 'Real Canadian Superstore',
  'superstore': 'Real Canadian Superstore',
  'loblaws': 'Loblaws', 'loblaw': 'Loblaws',
  'uber eats': 'Uber Eats', 'ubereats': 'Uber Eats',
  'skip the dishes': 'Skip The Dishes', 'skipthedishes': 'Skip The Dishes',
  'skip': 'Skip The Dishes',
  'doordash': 'DoorDash', 'door dash': 'DoorDash',
  'disney+': 'Disney Plus', 'disney plus': 'Disney Plus', 'disneyplus': 'Disney Plus',
  'netflix.com': 'Netflix', 'netflix': 'Netflix',
  'spotify.com': 'Spotify', 'spotify ab': 'Spotify', 'spotify': 'Spotify',
  'apple.com/bill': 'Apple', 'apple.com': 'Apple',
  'apple icloud': 'Apple', 'apple.com/bill one': 'Apple',
  'google *': 'Google', 'google play': 'Google Play',
  'google storage': 'Google', 'google one': 'Google',
  'paypal *': 'PayPal',
  'sq *': 'Square', 'sq*': 'Square',
  'tst*': 'Toast',
  'pp*': 'PayPal',
  'wholefds': 'Whole Foods', 'whole fds': 'Whole Foods', 'whole foods': 'Whole Foods',
  'petro-canada': 'Petro-Canada', 'petro canada': 'Petro-Canada',
  'petrocan': 'Petro-Canada',
  'circle k': 'Circle K', 'couche-tard': 'Couche-Tard', 'couche tard': 'Couche-Tard',
  'a & w': 'A&W', 'a&w': 'A&W',
  'wendys': "Wendy's", "wendy's": "Wendy's",
  'bk': 'Burger King', 'burger king': 'Burger King',
  'kfc': 'KFC',
  'popeyes': 'Popeyes', "popeye's": 'Popeyes',
  'tacobell': 'Taco Bell', 'taco bell': 'Taco Bell',
  'petsmart': 'PetSmart',
  'bestbuy': 'Best Buy', 'best buy': 'Best Buy',
  'homedepot': 'Home Depot', 'home depot': 'Home Depot',
  'ikea': 'IKEA',
  'goodlife fitness': 'Goodlife Fitness',
  'goodlife': 'Goodlife Fitness',
  'no frills': 'No Frills', 'nofrills': 'No Frills',
  'freshco': 'FreshCo',
  'sobeys': 'Sobeys', "sobey's": 'Sobeys',
  'metro': 'Metro',
  'safeway': 'Safeway',
  'save on foods': 'Save-On-Foods', 'save-on-foods': 'Save-On-Foods',
};

// Hoisted: Object.entries() rebuilt this ~90-pair array on every
// polishVendor() call, which runs once per captured notification.
const VENDOR_CORRECTION_ENTRIES = Object.entries(VENDOR_CORRECTIONS);

function polishVendor(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^(?:SQ\s*\*|TST\s*\*|PP\s*\*|GOOGLE\s*\*|PAYPAL\s*\*)\s*/i, '');

  const vLower = v.toLowerCase();
  for (const prefix of BANK_NAME_PREFIXES) {
    if (vLower.startsWith(prefix + ' ') && v.length > prefix.length + 3) {
      v = v.slice(prefix.length + 1).trim();
      break;
    }
  }

  v = v.replace(/\s*\([^)]*\)\s*/g, ' ');
  v = v.replace(/\bref\s*#?\s*\d+/gi, '');
  v = v.replace(/\btxn\s*#?\s*\d+/gi, '');
  v = v.replace(/\btransaction\s*#?\s*\d+/gi, '');
  v = v.replace(/[#]\s*\d+/g, '');
  v = v.replace(/\s+(?:STORE|STR|LOC|LOCATION|TERMINAL|TML|UNIT|KIOSK)\s*#?\s*\d*$/i, '');
  v = v.replace(/\s+\d{4,}$/g, '');
  v = v.replace(/\s+\d{3}$/g, '');
  v = v.replace(/\s*-\s*\d+$/g, '');
  v = v.replace(/^ww\.\s*/i, '');
  v = v.replace(/\.(?:com|ca|co|net|org|io)\b/gi, '');
  v = v.replace(/\s+[A-Z]{2}\s*$/i, '');
  v = v.replace(/\s+(?:CA|US|UK|ON|QC|BC|AB|SK|MB|NB|NS|PE|NL|NT|NU|YT)\s*$/i, '');
  v = v.replace(/[.,;:!*]+$/, '');
  v = v.replace(/\s+/g, ' ').trim();

  const lower = v.toLowerCase();
  if (VENDOR_CORRECTIONS[lower]) return VENDOR_CORRECTIONS[lower];
  for (const [key, corrected] of VENDOR_CORRECTION_ENTRIES) {
    if (lower.startsWith(key)) return corrected;
  }
  return formatVendorName(v);
}
