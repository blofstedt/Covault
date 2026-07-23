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

import { pipeline, type Text2TextGenerationPipeline } from '@huggingface/transformers';
import { formatVendorName } from './formatVendorName';

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

export interface SemanticMatchResult {
  matched: boolean;
  properName: string | null;
  reason: string;
}

// ═════════════════════════════════════════════════════════════════
// 1. AI MODEL — singleton lazy-loaded Flan-T5 pipeline
// ═════════════════════════════════════════════════════════════════

const MODEL_ID = 'Xenova/flan-t5-small';

let generatorPromise: Promise<Text2TextGenerationPipeline> | null = null;

function getGenerator(): Promise<Text2TextGenerationPipeline> {
  if (!generatorPromise) {
    console.log('[aiExtractor] Loading AI model:', MODEL_ID);
    generatorPromise = pipeline('text2text-generation', MODEL_ID, {
      device: 'wasm',
    }).then(gen => {
      console.log('[aiExtractor] AI model loaded successfully');
      return gen;
    }).catch(err => {
      console.error('[aiExtractor] Failed to load AI model:', err);
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

/**
 * Extract vendor, category, and transaction status in a SINGLE prompt.
 * Returns structured data with confidence scoring.
 */
export async function extractWithAI(
  notificationText: string,
  availableCategories: string[],
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

  const prompt =
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

  // Use rule-based vendor if AI didn't find one, otherwise use AI's
  let finalVendor = parsed.vendor;
  if (!finalVendor && hasRuleVendor) {
    finalVendor = polishVendor(ruleResult.vendor!);
  } else if (finalVendor) {
    finalVendor = polishVendor(finalVendor);
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
// 3. SEMANTIC VENDOR MATCHING
// ═════════════════════════════════════════════════════════════════

/**
 * Ask the AI whether a raw vendor name refers to an existing merchant.
 * Returns the matched proper_name or null.
 */
export async function aiSemanticVendorMatch(
  rawVendor: string,
  existingRules: { proper_name: string; match_key?: string }[],
): Promise<SemanticMatchResult> {
  if (!rawVendor || existingRules.length === 0) {
    return { matched: false, properName: null, reason: 'No rules to match against' };
  }

  // Quick heuristic first: if any rule's match_key is a substring, use that
  const rawLower = rawVendor.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const rule of existingRules) {
    const mk = (rule.match_key || rule.proper_name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (rawLower.includes(mk) || mk.includes(rawLower)) {
      return { matched: true, properName: rule.proper_name, reason: 'Substring match' };
    }
  }

  // AI fallback for ambiguous cases
  const topRules = existingRules.slice(0, 15); // Keep prompt short
  const prompt =
    `Does "${rawVendor}" refer to the same merchant as any of these?\n` +
    topRules.map((r, i) => `${i + 1}. ${r.proper_name}`).join('\n') +
    `\n\nReply with the exact matching name, or NONE.`;

  try {
    const result = await aiGenerate(prompt, 16);
    const match = result.trim();
    if (/^(NONE|N\/A|NO|UNKNOWN)$/i.test(match)) {
      return { matched: false, properName: null, reason: 'AI: no match found' };
    }
    const found = existingRules.find(
      r => r.proper_name.toLowerCase() === match.toLowerCase(),
    );
    if (found) {
      return { matched: true, properName: found.proper_name, reason: 'AI semantic match' };
    }
    return { matched: false, properName: null, reason: 'AI response did not match whitelist' };
  } catch {
    return { matched: false, properName: null, reason: 'AI model unavailable' };
  }
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
// 6. NOTIFICATION QUALITY SCORING / REJECTION EXPLANATIONS
// ═════════════════════════════════════════════════════════════════

export async function aiExplainRejection(
  text: string,
  reason: string,
): Promise<string> {
  // Fast path for common rejections
  const lower = text.toLowerCase();
  if (reason.includes('balance')) return 'Balance alert';
  if (reason.includes('otp') || reason.includes('verification')) return 'Security code';
  if (reason.includes('login') || reason.includes('signed in')) return 'Login alert';
  if (lower.includes('crypto') || lower.includes('bitcoin') || lower.includes('eth ')) return 'Crypto/market alert';
  if (/\b(?:up|down)\s+\d+(?:\.\d+)?%/.test(text)) return 'Price movement alert';
  if (reason.includes('promo') || lower.includes('limited time') || lower.includes('offer')) return 'Promotional message';

  const prompt =
    `A bank notification was skipped because: "${reason}"\n` +
    `Text: "${text.slice(0, 200)}"\n` +
    `Explain in 5 words or less why this was skipped.`;

  try {
    const result = await aiGenerate(prompt, 16);
    return result.trim().slice(0, 40) || reason;
  } catch {
    return reason;
  }
}

// ═════════════════════════════════════════════════════════════════
// 7. AUTO-SUGGEST MATCH PATTERNS
// ═════════════════════════════════════════════════════════════════

export function suggestMatchPattern(rawVendor: string, properName: string): 'exact' | 'prefix' | 'contains' {
  const rawLower = rawVendor.toLowerCase();
  const properLower = properName.toLowerCase();
  const rawNorm = rawLower.replace(/[^a-z0-9]/g, '');
  const properNorm = properLower.replace(/[^a-z0-9]/g, '');

  // If raw has numbers/location codes that proper name doesn't
  if (/\d/.test(rawVendor) && !/\d/.test(properName)) {
    const firstWord = properLower.split(' ')[0];
    if (rawLower.startsWith(firstWord)) return 'prefix';
    if (rawNorm.includes(firstWord)) return 'contains';
  }

  // If raw is longer but starts with same word
  if (rawLower.startsWith(properLower.split(' ')[0]) && rawLower.length > properLower.length + 3) {
    return 'prefix';
  }

  // If raw contains proper name as substring
  if (rawNorm.includes(properNorm) && rawNorm !== properNorm) {
    return 'contains';
  }

  return 'exact';
}

// ═════════════════════════════════════════════════════════════════
// 8. BATCH CATEGORY CLASSIFICATION
// ═════════════════════════════════════════════════════════════════

export async function aiBatchClassify(
  notifications: { id: string; text: string }[],
  availableCategories: string[],
): Promise<Map<string, { vendor: string | null; category: string | null; isTransaction: boolean; confidence: number }>> {
  const results = new Map<string, { vendor: string | null; category: string | null; isTransaction: boolean; confidence: number }>();

  // Process in parallel with concurrency limit
  const concurrency = 3;
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, notifications.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= notifications.length) return;
      const n = notifications[i];
      try {
        const res = await extractWithAI(n.text, availableCategories);
        results.set(n.id, {
          vendor: res.vendor,
          category: res.suggestedCategory,
          isTransaction: res.isTransaction,
          confidence: res.confidence,
        });
      } catch {
        results.set(n.id, { vendor: null, category: null, isTransaction: false, confidence: 0 });
      }
    }
  });

  await Promise.all(workers);
  return results;
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

const BANK_NAME_PREFIXES = [
  'bmo', 'scotiabank', 'td', 'td bank', 'rbc', 'cibc',
  'wealthsimple', 'tangerine', 'simplii', 'national bank',
  'desjardins', 'chase', 'wells fargo', 'bank of america',
  'amex', 'american express', 'capital one', 'discover',
  'citi', 'citibank', 'hsbc', 'barclays', 'usaa',
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
  for (const [key, corrected] of Object.entries(VENDOR_CORRECTIONS)) {
    if (lower.startsWith(key)) return corrected;
  }
  return formatVendorName(v);
}
