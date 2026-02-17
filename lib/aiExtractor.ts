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
 * Override function for testing — allows injecting a mock AI generator.
 * When set, aiGenerate uses this instead of the real model.
 */
let _aiGenerateOverride: ((prompt: string, maxTokens?: number) => Promise<string>) | null = null;

/**
 * Set a mock AI generator for testing. Pass null to restore real model.
 */
export function _setAIGenerateForTesting(fn: ((prompt: string, maxTokens?: number) => Promise<string>) | null): void {
  _aiGenerateOverride = fn;
}

/**
 * Run an AI prompt through the Flan-T5 model.
 * Returns the generated text string.
 */
async function aiGenerate(prompt: string, maxTokens = 64): Promise<string> {
  // Use test override if set
  if (_aiGenerateOverride) {
    return _aiGenerateOverride(prompt, maxTokens);
  }
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
  'amazon prime': 'Amazon Prime',
  'wm supercenter': 'Walmart', 'wal-mart': 'Walmart', 'wal mart': 'Walmart',
  'walmrt': 'Walmart',
  'mcdonald\'s': 'McDonald\'s', 'mcdonalds': 'McDonald\'s', 'mcdnlds': 'McDonald\'s',
  'mcd\'s': 'McDonald\'s',
  'starbux': 'Starbucks', 'sbux': 'Starbucks', 'starbuck': 'Starbucks',
  'tim hortons': 'Tim Hortons', 'tim horton\'s': 'Tim Hortons', 'tims': 'Tim Hortons',
  'timhortons': 'Tim Hortons',
  'chick fil a': 'Chick-fil-A', 'chickfila': 'Chick-fil-A', 'cfa': 'Chick-fil-A',
  'sprt chek': 'Sport Chek', 'sprt check': 'Sport Chek', 'sport check': 'Sport Chek',
  'cdn tire': 'Canadian Tire', 'can tire': 'Canadian Tire', 'canadian tire': 'Canadian Tire',
  'costco whse': 'Costco', 'costco wholesale': 'Costco',
  'dollarama': 'Dollarama',
  'shoppers drug mart': 'Shoppers Drug Mart', 'shoppers': 'Shoppers Drug Mart',
  'sdm': 'Shoppers Drug Mart',
  'lndlrd': 'Landlord',
  'rcss': 'Real Canadian Superstore', 'real cdn superstore': 'Real Canadian Superstore',
  'loblaws': 'Loblaws', 'loblaw': 'Loblaws',
  'uber eats': 'Uber Eats', 'ubereats': 'Uber Eats',
  'skip the dishes': 'Skip The Dishes', 'skipthedishes': 'Skip The Dishes',
  'doordash': 'DoorDash', 'door dash': 'DoorDash',
  'disney+': 'Disney Plus', 'disney plus': 'Disney Plus', 'disneyplus': 'Disney Plus',
  'netflix.com': 'Netflix',
  'spotify.com': 'Spotify', 'spotify ab': 'Spotify',
  'apple.com/bill': 'Apple', 'apple.com': 'Apple',
  'apple icloud': 'Apple',
  'google *': 'Google', 'google play': 'Google Play',
  'paypal *': 'PayPal',
  'sq *': 'Square', 'sq*': 'Square',
  'tst*': 'Toast',
  'pp*': 'PayPal',
  'wholefds': 'Whole Foods', 'whole fds': 'Whole Foods',
  'petro-canada': 'Petro-Canada', 'petro canada': 'Petro-Canada',
  'petrocan': 'Petro-Canada',
  'circle k': 'Circle K', 'couche-tard': 'Couche-Tard', 'couche tard': 'Couche-Tard',
  'a & w': 'A&W', 'a&w': 'A&W',
  'wendys': 'Wendy\'s', 'wendy\'s': 'Wendy\'s',
  'bk': 'Burger King', 'burger king': 'Burger King',
  'kfc': 'KFC',
  'popeyes': 'Popeyes',
  'tacobell': 'Taco Bell', 'taco bell': 'Taco Bell',
  'petsmart': 'PetSmart',
  'bestbuy': 'Best Buy', 'best buy': 'Best Buy',
  'homedepot': 'Home Depot', 'home depot': 'Home Depot',
  'ikea': 'IKEA',
  'goodlife fitness': 'Goodlife Fitness',
  'goodlife': 'Goodlife Fitness',
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

  // Strip store / location / terminal numbers
  v = v.replace(/[#]\s*\d+/g, '');
  v = v.replace(/\s+(?:STORE|STR|LOC|LOCATION|TERMINAL|TML|UNIT|KIOSK)\s*#?\s*\d*$/i, '');
  v = v.replace(/\s+\d{4,}$/g, '');
  v = v.replace(/\s+\d{3}$/g, '');
  v = v.replace(/\s*-\s*\d+$/g, '');

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
// 4. AI-POWERED EXTRACTION
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

  // ── Step 1: Ask AI if this is a transaction and extract vendor ──
  const vendorPrompt =
    `Extract the vendor or merchant name from this bank notification. ` +
    `If this is not a real purchase or payment (e.g. it is a login alert, ` +
    `verification code, balance notification, reward points, or promotional message), ` +
    `respond with "NONE". Otherwise respond with just the vendor name.\n\n` +
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
  const vendor = polishVendor(vendorResponse);
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
// 5. MAIN EXTRACTION ENTRY POINT
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
