// lib/aiExtractor.ts
//
// Fully local, client-side notification extraction.
// No cloud API calls — everything runs on-device.
//
// Extracts vendor name, amount, and determines if a notification
// is an actual transaction (purchase/charge/payment) or not.
// Also guesses a budget category when no vendor_override exists.

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
// 1. NON-TRANSACTION REJECTION
// ═════════════════════════════════════════════════════════════════

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
  /\bbought\b/i,
  /\bpay\b/i,
  /\bbilled?\b/i,
  /\binvoice\b/i,
  /\brefund\b/i,
];

// ═════════════════════════════════════════════════════════════════
// 2. AMOUNT EXTRACTION
// ═════════════════════════════════════════════════════════════════

const AMOUNT_PATTERNS: RegExp[] = [
  /\$([\d,]+\.\d{2})\b/,                                         // $123.45
  /\$([\d,]+)\b/,                                                 // $123
  /(?:USD|CAD|GBP|EUR|AUD)\s*([\d,]+\.\d{2})/i,                  // CAD 123.45
  /([\d,]+\.\d{2})\s*(?:USD|CAD|GBP|EUR|AUD|dollars?)/i,         // 123.45 CAD
];

// ═════════════════════════════════════════════════════════════════
// 3. VENDOR EXTRACTION — multi-strategy approach
// ═════════════════════════════════════════════════════════════════

//
// Strategy A: Explicit preposition patterns
//   "at VENDOR", "to VENDOR", "from VENDOR", "@VENDOR"
//   These are the highest confidence — the notification explicitly names
//   the merchant after a preposition.
//
// Strategy B: Structured label patterns
//   "merchant: VENDOR", "vendor: VENDOR", "payee: VENDOR"
//
// Strategy C: Notification title extraction
//   Many notifications put the vendor or service name as the title:
//     "FIZZ (TX. INCL.) You made a recurring payment..."
//     "DISNEY PLUS You made a recurring payment..."
//     "Uber Eats Your order of $23.45..."
//   We split at where the "body" starts and use the title part.
//
// Strategy D: Dollar-adjacent extraction
//   "VENDOR $12.34" or "$12.34 at VENDOR" — pick the text near the amount.
//

/**
 * Characters allowed in a vendor name match.
 * Covers multi-word names, apostrophes, ampersands, dots, hyphens, etc.
 * Examples: "Tim Horton's", "A&W", "H&M", "Chick-fil-A", "St. Hubert"
 */
const V = "[A-Za-z0-9][A-Za-z0-9\\s&'.,#!*+/()-]*[A-Za-z0-9).]";

/** Stoppers: text that ends a vendor capture (prepositions, amounts, dates, etc.) */
const STOP =
  '(?=\\s+(?:for|on|using|with|via|ending|card|credit|debit|account|visa|mastercard|amex|interac)\\b|\\s*\\$|\\s*(?:USD|CAD)|\\s*\\d{1,2}[/.-]\\d{1,2})';

// Strategy A — preposition-based (highest confidence)
const PREP_PATTERNS: RegExp[] = [
  new RegExp(`(?:^|\\s)(?:at|@)\\s+(${V})${STOP}`, 'i'),
  new RegExp(`(?:^|\\s)(?:at|@)\\s+(${V})\\s*\\.?\\s*$`, 'i'),
  new RegExp(`(?:^|\\s)(?:to|from)\\s+(${V})${STOP}`, 'i'),
  new RegExp(`(?:^|\\s)(?:to|from)\\s+(${V})\\s*\\.?\\s*$`, 'i'),
];

// Strategy B — structured label patterns
const LABEL_PATTERNS: RegExp[] = [
  /(?:merchant|vendor|payee|retailer|store)\s*:\s*([A-Za-z][A-Za-z0-9\s&'.#()*/-]{1,60})/i,
  /(?:purchase|transaction|payment|charge)\s+(?:at|from|to)\s+([A-Za-z][A-Za-z0-9\s&'.#()*/-]{1,60})/i,
];

// Strategy D — dollar-adjacent
const DOLLAR_ADJ_PATTERNS: RegExp[] = [
  // "VENDOR $12.34" (text before dollar sign)
  /([A-Z][A-Za-z0-9\s&'./-]{1,50}?)\s+\$[\d,]+\.?\d{0,2}/,
  // "$12.34 at/from/to VENDOR"
  /\$[\d,]+\.?\d{0,2}\s+(?:at|from|to|@)\s+([A-Za-z][A-Za-z0-9\s&'.#()*/-]{1,60})/i,
];

// ═════════════════════════════════════════════════════════════════
// 4. VENDOR NAME POLISHING
// ═════════════════════════════════════════════════════════════════

/**
 * Known vendor name corrections.
 * Maps mangled/abbreviated vendor names to their proper form.
 * Uses lowercased keys for case-insensitive matching.
 */
const VENDOR_CORRECTIONS: Record<string, string> = {
  // Common abbreviations & typos
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
  //   "Subway#327" → "Subway"
  //   "WALMART SUPERCENTER #1234" → "WALMART SUPERCENTER"
  //   "SHELL 004821" → "SHELL"
  v = v.replace(/[#]\s*\d+/g, '');
  v = v.replace(/\s+(?:STORE|STR|LOC|LOCATION|TERMINAL|TML|UNIT|KIOSK)\s*#?\s*\d*$/i, '');
  v = v.replace(/\s+\d{4,}$/g, '');       // trailing 4+ digit numbers
  v = v.replace(/\s+\d{3}$/g, '');         // trailing 3 digit store numbers
  v = v.replace(/\s*-\s*\d+$/g, '');       // trailing "-123"

  // Strip city/province/state suffixes: "COSTCO WHOLESALE GATINEAU QC" → "COSTCO WHOLESALE"
  v = v.replace(/\s+[A-Z]{2}\s*$/i, '');   // trailing 2-letter province/state
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
// 5. LOCAL CATEGORY GUESSER
// ═════════════════════════════════════════════════════════════════

/**
 * Category rules: each entry has keyword patterns matched against the
 * lowercased vendor name AND the full notification text.
 */
const CATEGORY_RULES: Array<{ patterns: RegExp[]; category: string }> = [
  // ── Groceries ──
  { patterns: [
    /\b(?:grocery|groceries|supermarket|superstore)\b/i,
    /\b(?:walmart|costco|whole\s*foods|trader\s*joe|safeway|kroger|publix|aldi|lidl|target)\b/i,
    /\b(?:loblaws?|metro|sobeys?|no\s*frills|food\s*basics|freshco|iga|provigo|maxi)\b/i,
    /\b(?:save[- ]on|farm\s*boy|longos?|foodland|voila|instacart)\b/i,
    /\b(?:real\s*canadian|rcss|t&t|h\s*mart)\b/i,
  ], category: 'Groceries' },

  // ── Transport ──
  { patterns: [
    /\b(?:gas|fuel|gasoline|petrol|diesel)\b/i,
    /\b(?:shell|esso|petro[- ]?canada|chevron|bp|exxon|mobil|sunoco|ultramar|husky)\b/i,
    /\b(?:uber(?!\s*eats)|lyft|taxi|cab|ride)\b/i,
    /\b(?:parking|park\b)/i,
    /\b(?:transit|metro\s*(?:pass|card|fare)|bus\s*(?:pass|fare)|train|subway\s*(?:pass|fare))\b/i,
    /\b(?:airline|air\s*canada|westjet|flair|porter|united|delta|southwest|american\s*air)\b/i,
    /\b(?:presto|opus|stm|ttc|oc\s*transpo|compass)\b/i,
    /\b(?:circle\s*k|couche[- ]?tard)\b/i,
  ], category: 'Transport' },

  // ── Utilities ──
  { patterns: [
    /\b(?:hydro|electric|power|energy|water|sewage|utility|utilities)\b/i,
    /\b(?:internet|broadband|wifi|wi-fi|fibre|fiber)\b/i,
    /\b(?:bell|rogers|telus|fido|koodo|virgin\s*(?:mobile|plus)|freedom\s*mobile)\b/i,
    /\b(?:shaw|videotron|fizz|chatr|lucky\s*mobile|public\s*mobile)\b/i,
    /\b(?:comcast|xfinity|spectrum|at&t|verizon|t-mobile|sprint)\b/i,
    /\b(?:phone\s*bill|cell\s*bill|mobile\s*bill|telecom)\b/i,
    /\b(?:enbridge|fortis|hydro[- ]?(?:one|qu[eé]bec|ottawa))\b/i,
  ], category: 'Utilities' },

  // ── Housing ──
  { patterns: [
    /\b(?:rent|mortgage|landlord|property\s*(?:tax|mgmt|management))\b/i,
    /\b(?:condo\s*fee|strata|hoa|home\s*insurance|tenant|lease)\b/i,
  ], category: 'Housing' },

  // ── Leisure / Entertainment / Dining / Shopping ──
  { patterns: [
    // Streaming & digital
    /\b(?:netflix|spotify|disney|hulu|crave|hbo|paramount|peacock|apple\s*(?:tv|music))\b/i,
    /\b(?:youtube|twitch|audible|kindle)\b/i,
    // Dining & coffee
    /\b(?:starbucks?|starbux|sbux|tim\s*horton|tims|coffee|caf[eé]|bistro)\b/i,
    /\b(?:restaurant|diner|grill|kitchen|eatery|tavern|brasserie|pub)\b/i,
    /\b(?:mcdonald|burger\s*king|wendy|subway|chipotle|popeyes|kfc|taco\s*bell)\b/i,
    /\b(?:chick[- ]?fil[- ]?a|five\s*guys|a&w|harvey|swiss\s*chalet|boston\s*pizza)\b/i,
    /\b(?:earls|cactus\s*club|joey|the\s*keg|milestone|jack\s*astor|moxie|st[- ]?hubert)\b/i,
    // Food delivery
    /\b(?:doordash|door\s*dash|uber\s*eats|ubereats|skip\s*the\s*dishes|grubhub)\b/i,
    // Shopping & retail
    /\b(?:amazon|ebay|etsy|shopping|mall|best\s*buy|home\s*depot|ikea)\b/i,
    /\b(?:clothing|fashion|nike|adidas|zara|h&m|gap|old\s*navy|winners|marshalls)\b/i,
    /\b(?:dollarama|dollar\s*tree|canadian\s*tire|cdn\s*tire|sport\s*che[ck])\b/i,
    /\b(?:apple\.com|apple\s*store|google\s*play|app\s*store)\b/i,
    // Entertainment & recreation
    /\b(?:cinema|movie|theatre|theater|concert|ticket|event)\b/i,
    /\b(?:gym|fitness|yoga|crossfit|sport|golf|bowling|recreation)\b/i,
    /\b(?:steam|playstation|xbox|nintendo|gaming)\b/i,
    /\b(?:book|library|chapter|indigo)\b/i,
    // Alcohol
    /\b(?:wine|beer|liquor|lcbo|saq|brewery|winery)\b/i,
    // Pets
    /\b(?:petsmart|petcetera|pet\s*valu)\b/i,
  ], category: 'Leisure' },

  // ── Services ──
  { patterns: [
    /\b(?:barber|salon|hair|spa|massage|beauty|nails?)\b/i,
    /\b(?:dental|dentist|doctor|clinic|physician|optometrist|chiro)\b/i,
    /\b(?:pharmacy|drug\s*mart|shoppers|pharmaprix|jean\s*coutu|rexall)\b/i,
    /\b(?:insurance|legal|lawyer|accountant|tax|cpa|notary)\b/i,
    /\b(?:cleaning|laundry|dry\s*clean|repair|mechanic|auto\s*body)\b/i,
    /\b(?:vet|veterinary|daycare|tutor|tutoring|education)\b/i,
    /\b(?:storage|moving|courier|shipping|purolator|fedex|ups|canada\s*post)\b/i,
    /\b(?:subscription|membership)\b/i,
  ], category: 'Services' },
];

/**
 * Guess a budget category from the vendor name + notification text.
 * Matches regex patterns against both, so even if the vendor name is
 * mangled, context from the notification body can help.
 */
function guessCategory(vendor: string | null, notificationText: string): string | null {
  const vendorLower = (vendor || '').toLowerCase();
  const textLower = notificationText.toLowerCase();

  for (const { patterns, category } of CATEGORY_RULES) {
    for (const re of patterns) {
      if (re.test(vendorLower) || re.test(textLower)) {
        return category;
      }
    }
  }

  return null;
}

// ═════════════════════════════════════════════════════════════════
// 6. MAIN EXTRACTION ENTRY POINT
// ═════════════════════════════════════════════════════════════════

/**
 * Extract transaction details from a bank notification using local
 * pattern matching. Runs entirely on-device with no network calls.
 *
 * Pipeline:
 *   1. Extract dollar amount
 *   2. Reject known non-transaction patterns
 *   3. Extract vendor name (multi-strategy)
 *   4. Polish vendor name (typo correction, title-casing)
 *   5. Guess budget category from vendor + notification context
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

  if (amount === null) {
    return {
      isTransaction: false, vendor: null, amount: null,
      suggestedCategory: null,
      rejectionReason: 'No dollar amount found in notification',
    };
  }

  // ── 2. Reject non-transactions ──
  for (const pattern of REJECT_PATTERNS) {
    if (pattern.test(text)) {
      return {
        isTransaction: false, vendor: null, amount,
        suggestedCategory: null,
        rejectionReason: 'Not cost-related notification',
      };
    }
  }

  // ── 3. Check transaction keywords ──
  const hasTransactionKeyword = TRANSACTION_KEYWORDS.some(p => p.test(text));

  // ── 4. Extract vendor (multi-strategy) ──
  let rawVendor = extractVendorMultiStrategy(text);

  // ── 5. Determine if this is a transaction ──
  const isTransaction = amount > 0 && (hasTransactionKeyword || rawVendor !== null);

  if (!isTransaction) {
    return {
      isTransaction: false,
      vendor: rawVendor ? polishVendor(rawVendor) : null,
      amount,
      suggestedCategory: null,
      rejectionReason: 'No transaction keywords found',
    };
  }

  // ── 6. Polish vendor name ──
  const vendor = rawVendor ? polishVendor(rawVendor) : null;

  // ── 7. Reject if no vendor could be identified ──
  if (!vendor) {
    return {
      isTransaction: false,
      vendor: null,
      amount,
      suggestedCategory: null,
      rejectionReason: 'No vendor name found in notification',
    };
  }

  return {
    isTransaction: true,
    vendor,
    amount,
    suggestedCategory: guessCategory(vendor, text),
    rejectionReason: null,
  };
}

// ═════════════════════════════════════════════════════════════════
// 7. MULTI-STRATEGY VENDOR EXTRACTION
// ═════════════════════════════════════════════════════════════════

/**
 * Try multiple strategies to extract the vendor name.
 * Returns the raw (uncleaned) vendor string, or null.
 */
function extractVendorMultiStrategy(text: string): string | null {
  // Strategy A — preposition-based ("at VENDOR", "to VENDOR", "from VENDOR")
  for (const pattern of PREP_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (isValidVendor(candidate)) return candidate;
    }
  }

  // Strategy B — structured labels ("merchant: VENDOR")
  for (const pattern of LABEL_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (isValidVendor(candidate)) return candidate;
    }
  }

  // Strategy C — notification title extraction
  const titleVendor = extractVendorFromTitle(text);
  if (titleVendor) return titleVendor;

  // Strategy D — dollar-adjacent ("VENDOR $12.34")
  for (const pattern of DOLLAR_ADJ_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (isValidVendor(candidate)) return candidate;
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
  const bodyStarts = [
    /\s+You\s+(?:made|have|just|were|recently)\s/i,
    /\s+(?:A\s+)?(?:purchase|transaction|payment|charge|recurring)\s/i,
    /\s+(?:Your\s+(?:card|account|credit|debit|visa|mastercard))\s/i,
    /\s+(?:Charged?|Spent|Paid|Authorized|Pending|Approved|Declined)\s/i,
    /\s+(?:New|Recent)\s+(?:transaction|charge|purchase)\b/i,
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
  if (lower.length < 2) return false;
  if (/^\d+$/.test(lower)) return false;
  // Reject if entirely punctuation / symbols
  if (/^[^A-Za-z0-9]+$/.test(lower)) return false;

  const falsePositives = new Set([
    'you', 'your', 'the', 'for', 'and', 'with', 'from', 'this',
    'that', 'has', 'have', 'been', 'was', 'were', 'are', 'will',
    'its', 'it', 'not', 'but', 'our', 'can', 'all', 'new',
    'unknown', 'unknown merchant', 'merchant', 'card', 'account',
    'credit', 'debit', 'bank', 'alert', 'notification',
    'visa', 'mastercard', 'amex', 'interac',
    'payment', 'transaction', 'purchase', 'charge',
    'recurring', 'automatic', 'scheduled',
  ]);
  return !falsePositives.has(lower);
}
