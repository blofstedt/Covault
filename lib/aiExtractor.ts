// lib/aiExtractor.ts
//
// Client-side AI-powered notification extraction using Transformers.js.
// Runs a text-generation model (Xenova/flan-t5-small) entirely on-device
// via ONNX Runtime / WebAssembly — no cloud API calls.
//
// Extracts vendor name, amount, and determines if a notification
// is an actual transaction (purchase/charge/payment) or not.
// Also classifies into a budget category.

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
}

// ═════════════════════════════════════════════════════════════════
// 1. AI MODEL — singleton lazy-loaded Flan-T5 pipeline
// ═════════════════════════════════════════════════════════════════

const MODEL_ID = 'Xenova/flan-t5-small';

let generatorPromise: Promise<Text2TextGenerationPipeline> | null = null;

/**
 * Get or initialize the text2text-generation pipeline.
 * The model is downloaded once and cached by the browser / ONNX runtime.
 */
function getGenerator(): Promise<Text2TextGenerationPipeline> {
  if (!generatorPromise) {
    console.log('[aiExtractor] Loading AI model:', MODEL_ID);
    generatorPromise = pipeline('text2text-generation', MODEL_ID, {
      // Use WASM backend for broadest compatibility (WebView + browser)
      device: 'wasm',
    }).then(gen => {
      console.log('[aiExtractor] AI model loaded successfully');
      return gen;
    }).catch(err => {
      console.error('[aiExtractor] Failed to load AI model:', err);
      generatorPromise = null; // allow retry
      throw err;
    });
  }
  return generatorPromise;
}

/**
 * Run an AI prompt through the Flan-T5 model.
 * Returns the generated text string.
 */
async function aiGenerate(prompt: string, maxTokens = 64): Promise<string> {
  const generator = await getGenerator();
  const output = await generator(prompt, {
    max_new_tokens: maxTokens,
    temperature: 0,
  });
  // output is an array of { generated_text: string }
  const result = Array.isArray(output) ? output[0] : output;
  return (result as any)?.generated_text?.trim() || '';
}

// ═════════════════════════════════════════════════════════════════
// 2. VENDOR NAME CORRECTIONS (abbreviations → proper names)
// ═════════════════════════════════════════════════════════════════

const VENDOR_CORRECTIONS: Record<string, string> = {
  'amzn': 'Amazon', 'amzn mktp': 'Amazon', 'amzn mktplace': 'Amazon',
  'amazon.ca': 'Amazon', 'amazon.com': 'Amazon', 'amzn digital': 'Amazon',
  'amazon prime': 'Amazon Prime', 'prime video': 'Amazon Prime',
  'wm supercenter': 'Walmart', 'wal-mart': 'Walmart', 'wal mart': 'Walmart',
  'walmrt': 'Walmart', 'walmart supercenter': 'Walmart',
  'mcdonald\'s': 'McDonald\'s', 'mcdonalds': 'McDonald\'s', 'mcdnlds': 'McDonald\'s',
  'mcd\'s': 'McDonald\'s', 'mcd': 'McDonald\'s',
  'starbux': 'Starbucks', 'sbux': 'Starbucks', 'starbuck': 'Starbucks',
  'tim hortons': 'Tim Hortons', 'tim horton\'s': 'Tim Hortons', 'tims': 'Tim Hortons',
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
  'wendys': 'Wendy\'s', 'wendy\'s': 'Wendy\'s',
  'bk': 'Burger King', 'burger king': 'Burger King',
  'kfc': 'KFC',
  'popeyes': 'Popeyes', 'popeye\'s': 'Popeyes',
  'tacobell': 'Taco Bell', 'taco bell': 'Taco Bell',
  'petsmart': 'PetSmart',
  'bestbuy': 'Best Buy', 'best buy': 'Best Buy',
  'homedepot': 'Home Depot', 'home depot': 'Home Depot',
  'ikea': 'IKEA',
  'goodlife fitness': 'Goodlife Fitness',
  'goodlife': 'Goodlife Fitness',
  'no frills': 'No Frills', 'nofrills': 'No Frills',
  'freshco': 'FreshCo',
  'sobeys': 'Sobeys', 'sobey\'s': 'Sobeys',
  'metro': 'Metro',
  'safeway': 'Safeway',
  'save on foods': 'Save-On-Foods', 'save-on-foods': 'Save-On-Foods',
};

/**
 * Polish a vendor name:
 *   1. Strip store/location numbers, POS prefixes, trailing junk
 *   2. Look up known corrections (typos, abbreviations)
 *   3. Title-case the result
 */
function polishVendor(raw: string): string {
  let v = raw.trim();

  // Strip common POS prefixes: "SQ *Cafe Lola" → "Cafe Lola"
  v = v.replace(/^(?:SQ\s*\*|TST\s*\*|PP\s*\*|GOOGLE\s*\*|PAYPAL\s*\*)\s*/i, '');

  // Strip known bank name prefixes that may have leaked into the vendor name
  const vLower = v.toLowerCase();
  for (const prefix of BANK_NAME_PREFIXES) {
    if (vLower.startsWith(prefix + ' ') && v.length > prefix.length + 3) {
      v = v.slice(prefix.length + 1).trim();
      break;
    }
  }

  // Strip parenthetical suffixes like "(TX. INCL.)" or "(ONLINE)"
  v = v.replace(/\s*\([^)]*\)\s*/g, ' ');

  // Strip common transaction metadata patterns
  v = v.replace(/\bref\s*#?\s*\d+/gi, '');
  v = v.replace(/\btxn\s*#?\s*\d+/gi, '');
  v = v.replace(/\btransaction\s*#?\s*\d+/gi, '');

  // Strip store / location / terminal numbers
  v = v.replace(/[#]\s*\d+/g, '');
  v = v.replace(/\s+(?:STORE|STR|LOC|LOCATION|TERMINAL|TML|UNIT|KIOSK)\s*#?\s*\d*$/i, '');
  v = v.replace(/\s+\d{4,}$/g, '');
  v = v.replace(/\s+\d{3}$/g, '');
  v = v.replace(/\s*-\s*\d+$/g, '');

  // Strip "www." prefix and ".com"/".ca"/".co" etc. suffixes from web-style vendor names
  v = v.replace(/^www\.\s*/i, '');
  v = v.replace(/\.(?:com|ca|co|net|org|io)\b/gi, '');

  // Strip city/province/state suffixes
  v = v.replace(/\s+[A-Z]{2}\s*$/i, '');
  v = v.replace(/\s+(?:CA|US|UK|ON|QC|BC|AB|SK|MB|NB|NS|PE|NL|NT|NU|YT)\s*$/i, '');

  // Strip trailing punctuation
  v = v.replace(/[.,;:!*]+$/, '');

  // Collapse whitespace
  v = v.replace(/\s+/g, ' ').trim();

  // Look up correction table (case-insensitive)
  const lower = v.toLowerCase();
  if (VENDOR_CORRECTIONS[lower]) {
    return VENDOR_CORRECTIONS[lower];
  }

  // Try partial prefix match: "AMZN MKTP CA" → check "amzn mktp" → "Amazon"
  for (const [key, corrected] of Object.entries(VENDOR_CORRECTIONS)) {
    if (lower.startsWith(key)) {
      return corrected;
    }
  }

  // Title-case
  return formatVendorName(v);
}

// ═════════════════════════════════════════════════════════════════
// 3. AMOUNT EXTRACTION (simple parsing — amounts are unambiguous)
// ═════════════════════════════════════════════════════════════════

/**
 * Extract a dollar amount from notification text.
 * Uses simple string parsing — dollar amounts like $14.99 are
 * unambiguous and don't need AI interpretation.
 */
function extractAmount(text: string): number | null {
  // Try $X,XXX.XX or $X.XX format first
  const dollarMatch = text.match(/\$([\d,]+\.\d{2})\b/) || text.match(/\$([\d,]+)\b/);
  if (dollarMatch?.[1]) {
    const parsed = parseFloat(dollarMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // Try currency-prefixed: CAD 123.45
  const currPrefixMatch = text.match(/(?:USD|CAD|GBP|EUR|AUD)\s*([\d,]+\.\d{2})/i);
  if (currPrefixMatch?.[1]) {
    const parsed = parseFloat(currPrefixMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // Try currency-suffixed: 123.45 CAD
  const currSuffixMatch = text.match(/([\d,]+\.\d{2})\s*(?:USD|CAD|GBP|EUR|AUD|dollars?)/i);
  if (currSuffixMatch?.[1]) {
    const parsed = parseFloat(currSuffixMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  return null;
}

// ═════════════════════════════════════════════════════════════════
// 4. RULE-BASED VENDOR EXTRACTION (pre-AI fallback)
// ═════════════════════════════════════════════════════════════════

/** Non-transaction indicator patterns */
const NON_TRANSACTION_PATTERNS = [
  /verification\s+code/i,
  /\botp\b/i,
  /account\s+balance/i,
  /\bsign\s+in\b/i,
  /\blogged\s+in\b/i,
  /reward\s+points/i,
  /\bcashback\b/i,
  /payment\s+is\s+due/i,
  /\bis\s+due\b/i,
  /direct\s+deposit/i,
  /\bpayroll\b/i,
  /\btransfer\b.*\b(?:between|from\s+your)\b/i,
  /has\s+been\s+delivered/i,
  /\bpromotion(?:al)?\b/i,
  /\bcredit\s+score\b/i,
  /\bpassword\b/i,
  /\bsecurity\s+alert\b/i,
];

/**
 * Known bank name prefixes that commonly appear at the start of notifications.
 * These are stripped before vendor extraction so "BMO You spent $45 at Shell"
 * doesn't include "BMO" as part of the vendor.
 */
const BANK_NAME_PREFIXES = [
  'bmo', 'scotiabank', 'td', 'td bank', 'rbc', 'cibc',
  'wealthsimple', 'tangerine', 'simplii', 'national bank',
  'desjardins', 'chase', 'wells fargo', 'bank of america',
  'amex', 'american express', 'capital one', 'discover',
  'citi', 'citibank', 'hsbc', 'barclays', 'usaa',
];

/**
 * Attempt to extract the vendor name from notification text using
 * regex patterns. This runs BEFORE the AI model to handle common
 * notification formats deterministically (faster and more accurate
 * than the small on-device model for structured text).
 *
 * Returns the raw vendor string (before polishing), or null if no
 * pattern matched.
 */
function ruleBasedVendorExtraction(text: string): { vendor: string | null; isTransaction: boolean; rejectionReason: string | null } {
  // Check for non-transaction patterns first
  for (const pattern of NON_TRANSACTION_PATTERNS) {
    if (pattern.test(text)) {
      return { vendor: null, isTransaction: false, rejectionReason: 'Not a cost-related notification' };
    }
  }

  // Strip known bank name prefixes from the beginning
  let stripped = text.trim();
  const strippedLower = stripped.toLowerCase();
  for (const prefix of BANK_NAME_PREFIXES) {
    if (strippedLower.startsWith(prefix + ' ')) {
      stripped = stripped.slice(prefix.length).trim();
      break;
    }
  }

  // ── Preposition-based extraction ──
  // "at VENDOR" (most common: "Purchase of $X at Subway")
  const atMatch = stripped.match(/\bat\s+(.+?)(?:\s+(?:on\s+your|for\s+|using\s+|via\s+|ending\s+|with\s+your)\b|\s*\.?\s*$)/i);
  if (atMatch?.[1]) {
    const v = atMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  // "from VENDOR" (e.g., "A monthly charge of $9.99 from Apple iCloud")
  const fromMatch = stripped.match(/\bfrom\s+(.+?)(?:\s+(?:was\s+|for\s+|on\s+your|using\s+|has\s+been)\b|\s*\.?\s*$)/i);
  if (fromMatch?.[1]) {
    const v = fromMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  // "paid to VENDOR" (e.g., "A recurring fee of $1,850.00 was paid to Parkview")
  const paidToMatch = stripped.match(/\bpaid\s+to\s+(.+?)(?:\s*\.?\s*$)/i);
  if (paidToMatch?.[1]) {
    const v = paidToMatch[1].trim();
    if (v.length >= 2) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  // "to VENDOR" when preceded by $ amount (e.g., "$50.00 to Netflix")
  const dollarToMatch = stripped.match(/\$[\d,]+\.?\d*\s+to\s+(.+?)(?:\s+(?:for\s+|on\s+|was\s+)\b|\s*\.?\s*$)/i);
  if (dollarToMatch?.[1]) {
    const v = dollarToMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  // "$X from VENDOR" (e.g., "$23.45 from Uber Eats")
  const dollarFromMatch = stripped.match(/\$[\d,]+\.?\d*\s+from\s+(.+?)(?:\s+(?:for\s+|on\s+|was\s+)\b|\s*\.?\s*$)/i);
  if (dollarFromMatch?.[1]) {
    const v = dollarFromMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  // "with VENDOR" when NOT "with your" (e.g., "A recurring transaction of $16.99 with Amazon Prime")
  const withMatch = stripped.match(/\bwith\s+(.+?)(?:\s+(?:was\s+|on\s+your|has\s+been|for\s+)\b|\s*\.?\s*$)/i);
  if (withMatch?.[1]) {
    const v = withMatch[1].trim();
    if (v.length >= 2 && !/^your\s/i.test(v)) return { vendor: v, isTransaction: true, rejectionReason: null };
  }

  // ── Title-based extraction ──
  // Vendor name appears as the first word(s) before a common phrase like
  // "You made", "Your subscription", etc.
  // e.g., "FIZZ (TX. INCL.) You made a recurring payment..."
  // e.g., "NETFLIX You made a recurring payment..."
  // e.g., "Spotify Your subscription payment..."
  const titleMatch = stripped.match(/^([A-Z][A-Za-z0-9 .&'+*()-]*?)(?:\s+(?:\(.*?\)\s+)?(?:You|Your|A |An |The |We |This |Payment|Charged))/i);
  if (titleMatch?.[1]) {
    let title = titleMatch[1].replace(/\s*\(.*?\)\s*/g, '').trim();
    if (title.length >= 2) return { vendor: title, isTransaction: true, rejectionReason: null };
  }

  // No pattern matched — fall through to AI
  return { vendor: null, isTransaction: true, rejectionReason: null };
}

// ═════════════════════════════════════════════════════════════════
// 5. AI-POWERED EXTRACTION
// ═════════════════════════════════════════════════════════════════

/**
 * Use the AI model to extract vendor name and classify the notification.
 * Returns { vendor, category, isTransaction }.
 */
async function aiExtractVendorAndCategory(
  text: string,
  availableCategories: string[],
): Promise<{ vendor: string | null; category: string | null; isTransaction: boolean; rejectionReason: string | null }> {
  const categories = availableCategories.length > 0
    ? availableCategories.join(', ')
    : 'Housing, Groceries, Transport, Utilities, Leisure, Services, Other';

  // ── Step 0: Try rule-based extraction first ──
  const ruleResult = ruleBasedVendorExtraction(text);
  if (!ruleResult.isTransaction) {
    return { vendor: null, category: null, isTransaction: false, rejectionReason: ruleResult.rejectionReason };
  }

  let vendor: string | null = null;

  if (ruleResult.vendor) {
    // Rule-based extraction found a vendor — polish it
    vendor = polishVendor(ruleResult.vendor);
    console.log(`[aiExtractor] Rule-based vendor extraction: "${ruleResult.vendor}" → "${vendor}"`);
  } else {
    // ── Step 1: Ask AI to extract the vendor ──
    const vendorPrompt =
      `Extract the vendor or merchant name from this bank notification. ` +
      `If this is not a real purchase or payment (e.g. it is a login alert, ` +
      `verification code, balance notification, reward points, or promotional message), ` +
      `respond with "NONE". Otherwise respond with just the vendor name, ` +
      `not the bank name.\n\n` +
      `Notification: "${text}"\n\nVendor:`;

    let vendorResponse: string;
    try {
      vendorResponse = await aiGenerate(vendorPrompt, 32);
    } catch {
      // Model failed to load — return null to trigger fallback
      return { vendor: null, category: null, isTransaction: false, rejectionReason: 'AI model not available' };
    }

    // Check if AI says this is not a transaction
    const vendorUpper = vendorResponse.toUpperCase().trim();
    if (vendorUpper === 'NONE' || vendorUpper === 'N/A' || vendorUpper === '' || vendorUpper === 'NO') {
      return { vendor: null, category: null, isTransaction: false, rejectionReason: 'AI determined this is not a transaction' };
    }

    // Polish the vendor name
    vendor = polishVendor(vendorResponse);
  }

  if (!vendor || vendor.length < 2) {
    return { vendor: null, category: null, isTransaction: false, rejectionReason: 'No vendor name found in notification' };
  }

  // ── Step 2: Ask AI to classify the category ──
  const categoryPrompt =
    `Classify this transaction into one of these budget categories: ${categories}.\n\n` +
    `Vendor: ${vendor}\n` +
    `Notification: "${text}"\n\n` +
    `Category:`;

  let categoryResponse: string;
  try {
    categoryResponse = await aiGenerate(categoryPrompt, 16);
  } catch {
    categoryResponse = '';
  }

  // Match AI response to an available category
  const categoryLower = categoryResponse.toLowerCase().trim();
  const allCategories = availableCategories.length > 0
    ? availableCategories
    : ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other'];

  let category: string | null = null;
  for (const cat of allCategories) {
    if (categoryLower.includes(cat.toLowerCase())) {
      category = cat;
      break;
    }
  }

  return { vendor, category, isTransaction: true, rejectionReason: null };
}

// ═════════════════════════════════════════════════════════════════
// 6. MAIN EXTRACTION ENTRY POINT
// ═════════════════════════════════════════════════════════════════

/**
 * Extract transaction details from a bank notification using a
 * client-side AI model (Flan-T5 via Transformers.js / ONNX Runtime).
 *
 * Pipeline:
 *   1. Extract dollar amount (simple parsing)
 *   2. Use AI model to extract vendor name and classify
 *   3. Polish vendor name (abbreviation correction, title-casing)
 *   4. Use AI model to guess budget category
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
    };
  }

  // ── 1. Extract amount (simple parsing — amounts are unambiguous) ──
  const amount = extractAmount(text);

  if (amount === null) {
    return {
      isTransaction: false, vendor: null, amount: null,
      suggestedCategory: null,
      rejectionReason: 'No dollar amount found in notification',
    };
  }

  // ── 2. Use AI to extract vendor and classify ──
  const aiResult = await aiExtractVendorAndCategory(text, availableCategories);

  if (!aiResult.isTransaction || !aiResult.vendor) {
    return {
      isTransaction: false,
      vendor: aiResult.vendor,
      amount,
      suggestedCategory: null,
      rejectionReason: aiResult.rejectionReason || 'No vendor name found in notification',
    };
  }

  return {
    isTransaction: true,
    vendor: aiResult.vendor,
    amount,
    suggestedCategory: aiResult.category,
    rejectionReason: null,
  };
}
