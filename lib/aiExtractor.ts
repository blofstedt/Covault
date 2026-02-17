// lib/aiExtractor.ts
//
// Fully local, client-side notification extraction.
// No cloud API calls — everything runs on-device.
//
// Extracts vendor name, amount, and determines if a notification
// is an actual transaction (purchase/charge/payment) or not.

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

// ─── Non-transaction keywords ────────────────────────────────────

/** Notifications containing these patterns are NOT transactions. */
const REJECT_PATTERNS: RegExp[] = [
  /\bverification\s*code\b/i,
  /\bone[- ]?time\s*(?:pass|code|pin|password)\b/i,
  /\bOTP\b/,
  /\b(?:sign|log)(?:ed)?\s*in\b/i,
  /\bpassword\s*(?:changed|reset|updated)\b/i,
  /\b(?:card|account)\s*(?:activated|locked|blocked|suspended)\b/i,
  /\breward\s*points?\b/i,
  /\bcashback\s*(?:earned|credited)\b/i,
  /\bstatement\s*(?:is\s*)?(?:ready|available)\b/i,
  /\bpayment\s*(?:is\s*)?(?:due|overdue)\b/i,
  /\bminimum\s*payment\b/i,
  /\bcredit\s*(?:score|limit)\b/i,
  /\baccount\s*balance\s*(?:is|:)/i,
  /\bavailable\s*balance\b/i,
  /\btransfer(?:red)?\s*(?:from|between)\s*(?:your|my)\b/i,
  /\bdirect\s*deposit\b/i,
  /\bpayroll\b/i,
  /\bpromotion(?:al)?\b/i,
  /\boffer\s*(?:expires?|ends?)\b/i,
  /\bearn\s*\d/i,
  /\bsecurity\s*alert\b/i,
];

/** Transaction-positive keywords (notification is likely a real charge). */
const TRANSACTION_KEYWORDS: RegExp[] = [
  /\bpurchase\b/i,
  /\btransaction\b/i,
  /\bcharged?\b/i,
  /\bspent\b/i,
  /\bpaid\b/i,
  /\bpayment\b/i,
  /\brecurring\b/i,
  /\bwithdra?w(?:al|n)?\b/i,
  /\bauthori[sz](?:ed|ation)\b/i,
  /\bpending\b/i,
  /\bcompleted\b/i,
  /\bdebit(?:ed)?\b/i,
  /\bcost\b/i,
];

// ─── Amount extraction patterns ──────────────────────────────────

const AMOUNT_PATTERNS: RegExp[] = [
  /\$([\d,]+\.\d{2})/,                                           // $123.45
  /\$([\d,]+)/,                                                   // $123
  /(?:USD|CAD|GBP|EUR)\s*([\d,]+\.\d{2})/i,                      // USD 123.45
  /([\d,]+\.\d{2})\s*(?:USD|CAD|GBP|EUR|dollars?)/i,             // 123.45 USD
  /(?:for|of|amount[:\s]*)\s*\$?([\d,]+\.\d{2})/i,               // for $123.45 / amount: 123.45
];

// ─── Vendor extraction patterns ──────────────────────────────────
//
// Banking notifications come in many formats. The patterns below are
// ordered from most specific to most general. The first match wins.

const VENDOR_PATTERNS: RegExp[] = [
  // "at VENDOR for $X" / "at VENDOR on date" / "at VENDOR."
  /(?:at|@)\s+([A-Za-z][A-Za-z0-9\s&'./()-]{1,50}?)\s+(?:for|on|using|\$|USD|CAD)/i,
  // "to VENDOR for $X"
  /(?:to|from)\s+([A-Za-z][A-Za-z0-9\s&'./()-]{1,50}?)\s+(?:for|on|using|\$|USD|CAD)/i,
  // "purchase at/from VENDOR"
  /(?:purchase|transaction|payment|charge)\s+(?:at|from|to)\s+([A-Za-z][A-Za-z0-9\s&'./()-]{1,50})/i,
  // "VENDOR $X" (vendor followed by dollar amount)
  /^([A-Z][A-Za-z0-9\s&'./-]+?)\s+\$[\d,]+\.?\d{0,2}/,
  // "VENDOR: You made..." (title-style, vendor before colon)
  /^([A-Z][A-Za-z0-9\s&'./-]+?):\s/,
  // "merchant: VENDOR" / "vendor: VENDOR"
  /(?:merchant|vendor|store)[:\s]+([A-Za-z][A-Za-z0-9\s&'./()-]{1,50})/i,
];

// ─── Extraction ──────────────────────────────────────────────────

/**
 * Extract transaction details from a bank notification using local
 * pattern matching. Runs entirely on-device with no network calls.
 *
 * The function:
 *   1. Determines if the notification is a real transaction vs noise
 *   2. Extracts the dollar amount
 *   3. Extracts the vendor/merchant name
 *
 * The notification text is expected to be the concatenation of the
 * Android notification title + " " + body, e.g.:
 *   "FIZZ (TX. INCL.) You made a recurring payment for $26.20 with your credit card."
 */
export async function extractWithAI(
  notificationText: string,
  availableCategories: string[],
): Promise<AIExtractionResult> {
  return localExtraction(notificationText);
}

function localExtraction(notificationText: string): AIExtractionResult {
  const text = notificationText.trim();

  // ── 1. Extract amount ──
  let amount: number | null = null;
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed > 0) {
        amount = parsed;
        break;
      }
    }
  }

  // No dollar amount → not a transaction notification we can use
  if (amount === null) {
    return {
      isTransaction: false,
      vendor: null,
      amount: null,
      suggestedCategory: null,
      rejectionReason: 'No dollar amount found in notification',
    };
  }

  // ── 2. Reject non-transactions ──
  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(text)) {
      return {
        isTransaction: false,
        vendor: null,
        amount,
        suggestedCategory: null,
        rejectionReason: 'Non-transaction notification',
      };
    }
  }

  // ── 3. Check for transaction keywords ──
  const hasTransactionKeyword = TRANSACTION_KEYWORDS.some(p => p.test(text));

  // ── 4. Extract vendor ──
  let vendor = extractVendor(text);

  // ── 5. If no vendor found from body patterns, use the notification title ──
  // Banking notifications often put the vendor in the title:
  //   Title: "FIZZ (TX. INCL.)"  Body: "You made a recurring payment for $26.20..."
  //   Title: "DISNEY PLUS"       Body: "You made a recurring payment for $17.84..."
  //   Title: "Wealthsimple"      Body: "Purchase of $12.34 at Subway"
  //
  // The fullText is "TITLE BODY", so the title is the part BEFORE the body's
  // common opening patterns.
  if (!vendor) {
    vendor = extractVendorFromTitle(text);
  }

  // ── 6. Determine if this is a transaction ──
  // A notification with a dollar amount AND either a transaction keyword or
  // a recognized vendor is almost certainly a transaction.
  const isTransaction = amount > 0 && (hasTransactionKeyword || vendor !== null);

  if (!isTransaction) {
    return {
      isTransaction: false,
      vendor,
      amount,
      suggestedCategory: null,
      rejectionReason: 'No transaction keywords found',
    };
  }

  return {
    isTransaction: true,
    vendor: vendor ? formatVendorName(cleanVendorName(vendor)) : null,
    amount,
    suggestedCategory: guessCategory(vendor, text),
    rejectionReason: null,
  };
}

// ─── Vendor extraction helpers ───────────────────────────────────

/**
 * Try to extract vendor from the notification body using known patterns.
 */
function extractVendor(text: string): string | null {
  for (const pattern of VENDOR_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      // Reject if the "vendor" is just a common word / false positive
      if (isValidVendor(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Extract vendor from the notification title.
 *
 * Android notification fullText = "TITLE BODY". We detect where the body
 * starts by looking for common body-opening patterns, and take everything
 * before that as the title/vendor.
 */
function extractVendorFromTitle(fullText: string): string | null {
  // Common body-start patterns (what comes after the title)
  const bodyStarts = [
    /\s+You\s+(?:made|have|just)\s/i,
    /\s+(?:A\s+)?(?:purchase|transaction|payment|charge|recurring)\s/i,
    /\s+(?:Your\s+(?:card|account|credit|debit))\s/i,
    /\s+(?:Charged?|Spent|Paid|Authorized|Pending)\s/i,
    /\s+\$[\d,]+/,
  ];

  for (const pattern of bodyStarts) {
    const idx = fullText.search(pattern);
    if (idx > 0) {
      const titlePart = fullText.substring(0, idx).trim();
      const cleaned = titlePart
        // Remove parenthetical suffixes: "FIZZ (TX. INCL.)" → "FIZZ"
        .replace(/\s*\([^)]*\)\s*$/, '')
        // Remove trailing colon: "BMO:" → "BMO"
        .replace(/:\s*$/, '')
        .trim();

      if (cleaned.length >= 2 && isValidVendor(cleaned)) {
        return cleaned;
      }
    }
  }

  return null;
}

/**
 * Check if a candidate vendor name is valid (not a common false positive).
 */
function isValidVendor(name: string): boolean {
  const lower = name.toLowerCase().trim();
  // Reject very short strings, pure numbers, or common false-positive words
  if (lower.length < 2) return false;
  if (/^\d+$/.test(lower)) return false;

  const falsePositives = new Set([
    'you', 'your', 'the', 'for', 'and', 'with', 'from', 'this',
    'that', 'has', 'have', 'been', 'was', 'were', 'are', 'will',
    'unknown', 'unknown merchant', 'merchant', 'card', 'account',
    'credit', 'debit', 'bank', 'alert', 'notification',
  ]);
  return !falsePositives.has(lower);
}

/**
 * Clean a vendor name by removing store numbers, extra punctuation, etc.
 */
function cleanVendorName(raw: string): string {
  let cleaned = raw
    // Remove store/location numbers: "Subway#327" → "Subway"
    .replace(/[#]\d+/g, '')
    // Remove trailing numbers after space: "WALMART 1234" → "WALMART"
    .replace(/\s+\d{3,}$/g, '')
    // Remove "STORE" suffix
    .replace(/\s+STORE$/i, '')
    // Remove trailing punctuation
    .replace(/[.,;:!]+$/, '')
    // Remove excess whitespace
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

// ─── Local category guesser ──────────────────────────────────────
//
// Maps vendor names and notification context to budget categories
// entirely on-device. No cloud calls needed.

/** Vendor keyword → category mapping (checked against lowercased vendor name). */
const VENDOR_CATEGORY_MAP: Array<{ keywords: string[]; category: string }> = [
  // Groceries
  { keywords: [
    'walmart', 'costco', 'whole foods', 'trader joe', 'safeway', 'kroger',
    'publix', 'aldi', 'lidl', 'target', 'grocery', 'supermarket', 'market',
    'loblaws', 'metro', 'sobeys', 'no frills', 'food basics', 'freshco',
    'iga', 'provigo', 'maxi', 'save-on', 'superstore', 'real canadian',
    'farm boy', 'longos', 'foodland',
  ], category: 'Groceries' },

  // Transport
  { keywords: [
    'gas', 'fuel', 'shell', 'esso', 'petro', 'chevron', 'bp', 'exxon',
    'uber', 'lyft', 'taxi', 'cab', 'parking', 'transit', 'metro', 'bus',
    'train', 'subway', 'airline', 'air canada', 'westjet', 'flair',
    'porter', 'united', 'american airlines', 'delta', 'southwest',
    'presto', 'opus', 'stm',
  ], category: 'Transport' },

  // Utilities
  { keywords: [
    'hydro', 'electric', 'power', 'energy', 'water', 'gas bill',
    'internet', 'bell', 'rogers', 'telus', 'fido', 'koodo', 'virgin',
    'freedom mobile', 'shaw', 'videotron', 'fizz', 'chatr',
    'comcast', 'xfinity', 'spectrum', 'at&t', 'verizon', 't-mobile',
    'phone bill', 'cell bill', 'mobile bill', 'utility', 'utilities',
    'enbridge', 'fortis',
  ], category: 'Utilities' },

  // Housing
  { keywords: [
    'rent', 'mortgage', 'landlord', 'property', 'condo', 'strata',
    'home insurance', 'tenant', 'lease',
  ], category: 'Housing' },

  // Leisure / Entertainment
  { keywords: [
    'netflix', 'spotify', 'disney', 'disney plus', 'apple music', 'youtube',
    'hulu', 'amazon prime', 'crave', 'hbo', 'paramount', 'peacock',
    'starbucks', 'tim horton', 'tims', 'coffee', 'cafe', 'bar',
    'restaurant', 'mcdonald', 'burger', 'pizza', 'subway', 'wendy',
    'chipotle', 'popeyes', 'kfc', 'taco bell', 'chick-fil-a',
    'doordash', 'uber eats', 'skip the dishes', 'grubhub', 'instacart',
    'cinema', 'movie', 'theatre', 'theater', 'concert', 'ticket',
    'gym', 'fitness', 'yoga', 'sport', 'golf', 'bowling',
    'steam', 'playstation', 'xbox', 'nintendo', 'gaming', 'twitch',
    'amazon', 'ebay', 'etsy', 'shopping', 'mall', 'store',
    'clothing', 'fashion', 'nike', 'adidas', 'zara', 'h&m',
    'apple', 'google play', 'app store',
    'book', 'audible', 'kindle',
    'wine', 'beer', 'liquor', 'lcbo', 'saq',
    'a&w', 'harveys', 'swiss chalet', 'boston pizza', 'earls',
    'cactus club', 'joeys', 'the keg', 'milestone',
  ], category: 'Leisure' },

  // Services
  { keywords: [
    'barber', 'salon', 'hair', 'spa', 'massage', 'dental', 'dentist',
    'doctor', 'clinic', 'pharmacy', 'drug mart', 'shoppers',
    'insurance', 'legal', 'lawyer', 'accountant', 'tax',
    'cleaning', 'laundry', 'dry clean', 'repair', 'mechanic',
    'vet', 'veterinary', 'pet', 'daycare', 'tutor',
    'subscription', 'membership', 'recurring payment',
  ], category: 'Services' },
];

/**
 * Guess a budget category for a vendor using local keyword matching.
 * Returns the category name string or null if no confident match.
 */
function guessCategory(vendor: string | null, notificationText: string): string | null {
  const searchText = [
    (vendor || '').toLowerCase(),
    notificationText.toLowerCase(),
  ].join(' ');

  for (const { keywords, category } of VENDOR_CATEGORY_MAP) {
    for (const kw of keywords) {
      if (searchText.includes(kw)) {
        return category;
      }
    }
  }

  return null;
}
