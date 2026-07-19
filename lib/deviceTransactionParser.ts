import { formatVendorName } from './formatVendorName';

const STOP_PHRASES = [
  'verification code', 'security code', 'otp', 'passcode', '2fa', 'password', 'login', 'signed in', 'new device',
  'statement', 'e-statement', 'payment due', 'due date',
  'account balance', 'available balance', 'current balance', 'balance is',
  'deposit', 'payroll', 'salary', 'interest', 'dividend', 'e-transfer received', 'etransfer received', 'transfer received', 'money received',
  'available credit', 'credit limit',
];

const REFUND_PHRASES = [
  'refund', 'reversal', 'credited', 'cashback',
];

const GO_PHRASES = [
  'spend', 'spent', 'purchase', 'purchased', 'debit', 'debit purchase', 'pos', 'tap', 'tapped', 'charged', 'charge',
  'payment', 'bill payment', 'bill paid', 'paid', 'payment to',
  'transfer to', 'sent to', 'e-transfer sent', 'etransfer sent', 'interac e-transfer sent',
  'cost', 'costs', 'pre-authorized debit', 'preauthorized debit',
  'withdrawal', 'atm withdrawal',
];

/** Weak GO phrases — ambiguous words that can mean either pre-auth or settled. */
const WEAK_GO_PHRASES = ['authorized', 'approved'];

const PRE_AUTH_PHRASES = [
  'authorization hold', 'pre-authorization', 'preauthorization',
  'temporary hold', 'hold placed', 'pending transaction',
  'authorization pending', 'pending charge', 'pending purchase',
];

const SETTLEMENT_PHRASES = [
  'posted', 'settled', 'cleared', 'processed', 'completed',
];

/** Phrases that indicate incoming money (income, not expense). */
const INCOME_PHRASES = [
  'e-transfer received', 'etransfer received', 'transfer received',
  'you got an interac', 'you got a interac', 'you received',
  'sent you', 'money received', 'deposit received',
  'deposited the funds', 'direct deposit',
  'payroll', 'salary',
];

/**
 * Non-financial notification patterns that should be rejected before parsing.
 * Matches crypto price alerts, market data, promos, marketing, etc.
 */
const NON_FINANCIAL_PATTERNS: RegExp[] = [
  // Crypto price alerts: "ETH is down 5.06%", "BTC trading at $45k"
  /\b(?:ETH|BTC|SOL|ADA|DOT|DOGE|XRP|MATIC|AVAX|LINK|LTC|USDT|USDC|BNB|SHIB)\b.*?\b(?:up|down|trading|price|market|rally|crash|surge|drop|gain|loss|fell|rose|climb)/i,
  /\b(?:is\s+)?trading\s+at\b/i,
  /\bmarket\s+cap\b/i,
  /\bprice\s+alert\b/i,
  /\b(?:up|down)\s+\d+(?:\.\d+)?%/i,
  // Promotional / marketing language
  /\b(?:limited\s+time|act\s+now|don't\s+miss|exclusive\s+offer|flash\s+sale)\b/i,
  /\b(?:promo\s+code|coupon\s+code|discount\s+code|referral\s+code)\b/i,
  /\b(?:earn\s+(?:up\s+to|bonus)|free\s+(?:shipping|trial|gift))\b/i,
  // App feature announcements
  /\b(?:new\s+feature|update\s+available|what'?s\s+new)\b/i,
];

const amountRegex = /(?<!\w)(?:\$|cad\s*)\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:[.,]([0-9]{1,2}))?(?!\w)|(?<!\w)([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{2}))(?!\w)/gi;

export interface ParsedNotification {
  isOutgoing: boolean;
  amount?: number;
  vendorDisplay?: string;
  vendorKey?: string;
  recurrence: 'One-time' | 'Biweekly' | 'Monthly';
  rejectionReason?: string;
  isRefund?: boolean;
  isPreAuth?: boolean;
  /** True when this is incoming money (e.g. Interac e-Transfer received) */
  isIncome?: boolean;
  /**
   * Parser confidence in the extraction, 0..1.
   * 0.9+ : high — strong go-phrase, clear preposition-based vendor, clean amount
   * 0.7-0.9 : medium — vendor from a static correction table, or weak go-phrase
   * 0.5-0.7 : low — vendor guessed from title-case, or amount had multiple candidates
   * < 0.5 : very low — the AI fallback should kick in for this one
   */
  confidence?: number;
  /**
   * Why the confidence is what it is. Useful for the UI to explain
   * "we guessed this" and for the AI fallback to know what to focus on.
   */
  confidenceReasons?: string[];
}
interface AmountCandidate {
  value: number;
  startIndex: number;
  endIndex: number;
}

const outgoingHints = /(spend|spent|charged|purchase|purchased|debit|payment|paid|withdrawal|transfer|sent|cost)/;
const balanceHints = /(balance|available|limit|remaining|credit limit|available credit|owing)/;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Strip emoji and non-text Unicode symbols before regex vendor extraction.
 * Some banking apps (e.g. Wealthsimple) insert emoji between the merchant
 * name and the transaction description, which breaks character-class patterns.
 */
function stripEmoji(text: string): string {
  return text
    // Supplementary Multilingual Plane — emoji, symbols, pictographs (U+1F000–U+1FFFF)
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, ' ')
    // Miscellaneous Symbols, Dingbats, Arrows, Geometric Shapes (U+2600–U+27BF, U+2B00–U+2BFF)
    .replace(/[\u2600-\u27BF\u2B00-\u2BFF]/g, ' ')
    // Variation selectors (make text emoji render as pictograph)
    .replace(/[\uFE00-\uFE0F]/g, '')
    // Zero-width joiner (used in multi-codepoint emoji sequences)
    .replace(/\u200D/g, '')
    // Collapse extra whitespace introduced by removals above
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function findAllAmounts(text: string): AmountCandidate[] {
  const candidates: AmountCandidate[] = [];
  for (const match of text.matchAll(amountRegex)) {
    // Groups 1,2 = currency-prefixed ($X or CAD X): whole, decimals
    // Groups 3,4 = bare number with explicit .XX decimals: whole, decimals
    const rawWhole = match[1] || match[3] || '';
    const decimals = match[2] || match[4] || '00';
    const whole = rawWhole.replace(/,/g, '');
    const value = Number.parseFloat(`${whole}.${decimals}`);
    if (!Number.isFinite(value) || value <= 0) continue;

    const start = match.index || 0;
    const rawMatch = match[0] || '';
    const prevChar = start > 0 ? text[start - 1] : '';
    const hasCurrencyMarker = /^\s*(?:\$|cad\s*)/i.test(rawMatch);
    const hasExplicitDecimals = Boolean(match[2] || match[4]);

    // Ignore store/terminal IDs (e.g. #5028) and bare integers that are
    // unlikely to represent money unless explicitly currency-marked.
    if (prevChar === '#') continue;
    if (!hasCurrencyMarker && !hasExplicitDecimals) continue;

    candidates.push({
      value,
      startIndex: start,
      endIndex: start + rawMatch.length,
    });
  }
  return candidates;
}

export function pickAmount(candidates: AmountCandidate[], tLower: string): number | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].value;

  let bestIdx = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  candidates.forEach((c, idx) => {
    const window = tLower.slice(Math.max(0, c.startIndex - 70), Math.min(tLower.length, c.endIndex + 70));
    let score = 0;
    if (outgoingHints.test(window)) score += 5;
    if (balanceHints.test(window)) score -= 6;
    if (/for\s+[$0-9]/.test(window)) score += 2;
    if (window.includes('balance') && window.includes('now')) score -= 3;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return candidates[bestIdx].value;
}

/**
 * Trim common prepositions/articles that signal the end of a vendor name when
 * a greedy pattern has over-captured (e.g. "Amazon for your order" → "Amazon").
 */
function trimAtPreposition(vendor: string): string {
  return vendor.split(/\s+(?=(?:for|on|with|using|via|ending|was|is|has|and|from)\b)/i)[0].trim();
}

function extractVendorRaw(text: string, isRefund?: boolean): string {
  // Strip emoji/symbols so they don't break character-class patterns or act
  // as unexpected delimiters between merchant name and description text.
  let t = stripEmoji(text);

  // Strip known bank name prefixes (e.g. "Wealthsimple", "TD", "BMO") from
  // the start of the notification so they don't interfere with vendor extraction.
  const BANK_NAME_PREFIXES = [
    'bmo', 'scotiabank', 'td', 'td bank', 'rbc', 'cibc',
    'wealthsimple', 'tangerine', 'simplii', 'national bank',
    'desjardins', 'chase', 'wells fargo', 'bank of america',
    'amex', 'american express', 'capital one', 'discover',
    'citi', 'citibank', 'hsbc', 'barclays', 'usaa',
  ];
  const tLowerPrefix = t.toLowerCase();
  for (const prefix of BANK_NAME_PREFIXES) {
    if (tLowerPrefix.startsWith(prefix + ' ') && t.length > prefix.length + 3) {
      t = t.slice(prefix.length + 1).trim();
      break;
    }
  }

  // ── Refund-specific vendor extraction ─────────────────────────────────────
  // Handles patterns like:
  //   "$57.74 will be refunded to your credit card from AMZN MKTP CA. Your refund may take..."
  //   "Refund of $14.23 from AMAZON.CA"
  //   "Credit card refund - $52.49 from CANADIAN TIRE #611"
  if (isRefund) {
    // Strip trailing "Your refund may take..." / "may take up to..." boilerplate
    const cleaned = t.replace(/\.?\s*your\s+refund\s+may\s+take.*$/i, '').trim();

    // Pattern R1: "from VENDOR" (most common refund pattern)
    const refundFromMatch = cleaned.match(
      /\bfrom\s+([A-Za-z0-9&'./#\u00C0-\u00FF -]{2,60}?)(?:\s*[.,]?\s*$)/i,
    );
    if (refundFromMatch) return refundFromMatch[1].trim();

    // Pattern R2: "refunded by VENDOR" / "credited by VENDOR"
    const refundByMatch = cleaned.match(
      /\b(?:refunded|credited)\s+by\s+([A-Za-z0-9&'./#\u00C0-\u00FF -]{2,60})/i,
    );
    if (refundByMatch) return refundByMatch[1].trim();
  }

  // Vendor character class used across patterns:
  // ASCII alphanumeric + common punctuation + accented Latin (À–ÿ) + space + hyphen
  // NOTE: hyphen must appear last in the class bracket to be literal, not a range marker

  // ── Pattern 1: "... at VENDOR ..." ────────────────────────────────────────
  // Used by TD, RBC, BMO, CIBC, Scotiabank, Desjardins, and many others.
  const atMatch = t.match(/\bat\s+([A-Za-z0-9&'./#\u00C0-\u00FF -]{2,60})/i);
  if (atMatch) return trimAtPreposition(atMatch[1].trim());

  // ── Pattern 2: "Merchant: VENDOR" / "Merchant - VENDOR" ───────────────────
  const merchantMatch = t.match(/\bmerchant\b[:\s-]+([A-Za-z0-9&'./#\u00C0-\u00FF -]{2,60})/i);
  if (merchantMatch) return trimAtPreposition(merchantMatch[1].trim());

  // ── Pattern 3: "payment to VENDOR" / "paid to VENDOR" ────────────────────
  const paidToMatch = t.match(
    /\b(?:payment|paid)\s+to\s+([A-Za-z0-9&'./#\u00C0-\u00FF -]{2,60}?)(?=\s+(?:for|on|using|via|ending)\b|[.,]|$)/i,
  );
  if (paidToMatch) return paidToMatch[1].trim();

  // ── Pattern 4: "e-transfer / transfer to VENDOR" ─────────────────────────
  const transferMatch = t.match(
    /\b(?:e-?transfer|interac\s+e-?transfer|transfer)\b.*?\bto\b\s+([A-Za-z0-9&'./#\u00C0-\u00FF -]{2,60}?)(?=\s+(?:for|on|using|via|ending)\b|[.,]|$)/i,
  );
  if (transferMatch) return transferMatch[1].trim();

  // ── Pattern 5: "VENDOR [dash] you spend/spent/charged/paid/purchased …" ───
  // Handles Wealthsimple and any bank that leads with the merchant name.
  // The dash separator is optional — catches both:
  //   "AMZN MKTP CA - You spent $36.64 with your credit card."
  //   "AMZN MKTP CA 🛍️ You spend $27.29 with your credit card."
  //   (emoji already stripped to a space by stripEmoji above)
  const beforeSpendingMatch = t.match(
    /^([A-Za-z0-9&'./#\u00C0-\u00FF -]{2,60}?)\s*[-–—]?\s*(?:you\s+)?(?:spend\b|spent\b|charg(?:e|ed)\b|paid\b|purchas(?:e|ed)\b|authorized\b)/i,
  );
  if (beforeSpendingMatch) {
    // Strip any trailing dash that bled into the capture group
    const candidate = beforeSpendingMatch[1].trim().replace(/\s*[-–—]+$/, '').trim();
    if (candidate.length >= 2) return candidate;
  }

  // ── Pattern 6: "$X.XX at/from/to VENDOR" ─────────────────────────────────
  const afterAmountMatch = t.match(
    /\$[\d,.]+\s+(?:at|from|to|@)\s+([A-Za-z0-9&'./#\u00C0-\u00FF -]{2,60})/i,
  );
  if (afterAmountMatch) return trimAtPreposition(afterAmountMatch[1].trim());

  // ── Last resort: capitalized word sequence after an amount ────────────────
  // Reject matches that start with pronouns or prepositions — those indicate
  // we've landed in the description text rather than the merchant name.
  const nearDollar = t.match(/\$[\d,.]+[^A-Za-z]*([A-Z][A-Za-z0-9&'.\- ]{1,59})/);
  if (nearDollar) {
    const candidate = nearDollar[1].trim();
    if (!/^(?:with|from|on|using|via|by|through|for|and|the|a|an|your|my|our|you)\b/i.test(candidate)) {
      return candidate;
    }
  }

  // ── Heuristic fallback: longest uppercase word sequence ───────────────────
  // Many bank notifications put merchant names in ALL CAPS. Extract the longest
  // run of uppercase words (excluding known non-vendor words).
  const capsRuns: string[] = [];
  const capsRegex = /\b([A-Z][A-Z0-9&'.# -]{1,59})\b/g;
  let capsMatch;
  while ((capsMatch = capsRegex.exec(t)) !== null) {
    const tokens = capsMatch[1].trim().split(/\s+/).filter(w => !NON_VENDOR_WORDS.has(w) && w.length >= 2);
    if (tokens.length > 0) {
      capsRuns.push(tokens.join(' '));
    }
  }
  if (capsRuns.length > 0) {
    // Pick the longest run
    capsRuns.sort((a, b) => b.length - a.length);
    const candidate = capsRuns[0];
    if (!isCommonNounOnly(candidate)) return candidate;
    // All-caps run was all common nouns — try shorter runs in case one is real
    for (let i = 1; i < capsRuns.length; i++) {
      if (!isCommonNounOnly(capsRuns[i])) return capsRuns[i];
    }
  }

  return 'Unknown';
}

function cleanVendor(raw: string): string {
  let vendor = raw.trim();
  vendor = vendor.replace(/\s*\([^)]*\)\s*$/, '');
  vendor = vendor.replace(/\s*(#\s*\d+|store\s*\d+|pos\s*\d+|terminal\s*\w+)\s*$/i, '');
  vendor = vendor.replace(/\s*ending\s*\d{2,4}\s*$/i, '');
  vendor = vendor.replace(/\s+(monthly|biweekly|bi-weekly|weekly|subscription|recurring)\s*$/i, '');
  // Strip any trailing dash/separator that leaked from format patterns
  vendor = vendor.replace(/\s*[-–—]+\s*$/, '');
  vendor = collapseWhitespace(vendor);
  return vendor;
}

export function toVendorKey(vendor: string): string {
  return vendor.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Common-noun stopword set used by the vendor-extraction fallbacks. If
 * EVERY word in an extracted candidate is in this set, the candidate
 * is almost certainly boilerplate from the notification text rather
 * than a real merchant name. Examples caught by this in production:
 *   "SUBSCRIPTION PANIC" → "Subscription Panic"  (news headline)
 *   "YOU GOT"           → "You Got"            (e-Transfer phrase)
 *   "TRANSACTION ALERT" → "Transaction Alert"  (notification kind)
 *   "MONTHLY PAYMENT"   → "Monthly Payment"    (cadence text)
 *   "YOUR BALANCE"      → "Your Balance"       (account summary)
 *
 * Words are lowercased and stripped of non-alphanumerics before lookup,
 * so the set is case-insensitive.
 */
const NON_VENDOR_WORDS = new Set([
  // pronouns / possessives
  'you', 'your', 'yours', 'my', 'our', 'i', 'me', 'we', 'us', 'they', 'them', 'their',
  // verbs that often appear in transaction descriptions, not vendor names
  'got', 'sent', 'received', 'spent', 'paid', 'charged', 'purchased', 'purchases',
  'transferred', 'withdrew', 'deposited', 'moved',
  'subscribe', 'subscribed', 'unsubscribed',
  // cadence / billing words
  'subscription', 'monthly', 'weekly', 'daily', 'annual', 'yearly', 'biweekly',
  'bi-weekly', 'fortnight', 'recurring', 'recurrence', 'autopay', 'auto-pay',
  // notification boilerplate
  'alert', 'alerts', 'notification', 'notifications', 'message', 'messages',
  'reminder', 'reminders', 'update', 'updates', 'confirmation', 'confirmations',
  'fyi', 'psa', 'heads', 'up',
  // financial / banking boilerplate
  'card', 'account', 'bank', 'credit', 'debit', 'transaction', 'transactions',
  'payment', 'payments', 'transfer', 'transfers', 'deposit', 'deposits',
  'withdrawal', 'withdrawals', 'fee', 'fees', 'charge', 'charges',
  'available', 'balance', 'limit', 'remaining', 'total', 'amount', 'sum', 'cost', 'price',
  'preauthorized', 'pre-authorized', 'authorized', 'approved', 'declined',
  // urgency / promo words (false-positive headlines)
  'panic', 'urgent', 'important', 'attention', 'warning', 'help', 'breaking', 'news',
  // generic adjectives / state words
  'new', 'old', 'first', 'last', 'next', 'previous', 'today', 'yesterday', 'tomorrow',
  'now', 'just', 'success', 'successfully', 'completed', 'failed', 'pending', 'processing',
  'verified', 'test', 'demo', 'sample', 'example',
  // prepositions / articles / conjunctions
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'to', 'from', 'with', 'at', 'on',
  'in', 'of', 'by', 'as', 'is', 'was', 'has', 'been', 'will', 'may', 'take', 'days',
  // brand/card-network boilerplate (uppercase forms historically matched here)
  'visa', 'mastercard', 'interac',
]);

/**
 * Returns true if the candidate vendor string is composed entirely of
 * common-noun stopwords. Used to reject fallback extractions that
 * picked up boilerplate instead of a real merchant name.
 *
 * A vendor with 0 words (empty / whitespace) is also treated as
 * "common-noun-only" since it cannot be a real merchant.
 */
function isCommonNounOnly(vendor: string): boolean {
  const words = vendor.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every(w => NON_VENDOR_WORDS.has(w.replace(/[^a-z0-9]/g, '')));
}

/**
 * Title-case a vendor name, preserving fully-uppercase abbreviations/acronyms
 * of any length (e.g. AMZN, MKTP, CA, TD, RBC, BMO, VISA, TD-VISA).
 * A word is treated as an acronym when it contains no lowercase letters but
 * has at least one uppercase letter.
 */
function titleCaseVendor(vendor: string): string {
  if (!vendor.trim()) return 'Unknown';
  return vendor
    .split(/\s+/)
    .filter(Boolean)
    .map(word => {
      // Preserve all-uppercase abbreviations/acronyms of any length
      if (!/[a-z]/.test(word) && /[A-Z]/.test(word)) return word;
      return word[0].toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Extract the sender name from an income / e-Transfer notification.
 * Handles patterns like:
 *   "NEISHA WILLIAMS sent you $160.00"
 *   "You received $50 from JOHN SMITH"
 *   "e-Transfer from JANE DOE"
 */
function extractIncomeSender(text: string): string | null {
  const t = stripEmoji(text);

  // Pattern I1: "SENDER sent you $X" / "SENDER has sent you"
  const sentYouMatch = t.match(
    /([A-Z][A-Za-z\u00C0-\u00FF]+(?: [A-Z][A-Za-z\u00C0-\u00FF]+){0,3})\s+(?:has\s+)?sent\s+you\b/i,
  );
  if (sentYouMatch) return sentYouMatch[1].trim();

  // Pattern I2: "from SENDER" at end or before period/comma
  const fromMatch = t.match(
    /\bfrom\s+([A-Z][A-Za-z\u00C0-\u00FF]+(?: [A-Z][A-Za-z\u00C0-\u00FF]+){0,3})(?:\s*[.,]|\s*$)/i,
  );
  if (fromMatch) return fromMatch[1].trim();

  // Pattern I3: "received from SENDER"
  const receivedFromMatch = t.match(
    /\breceived\s+from\s+([A-Z][A-Za-z\u00C0-\u00FF]+(?: [A-Z][A-Za-z\u00C0-\u00FF]+){0,3})/i,
  );
  if (receivedFromMatch) return receivedFromMatch[1].trim();

  return null;
}

export function parseNotificationText(text: string): ParsedNotification {
  const t = text.trim();
  const tLower = collapseWhitespace(t.toLowerCase());

  // ── Early rejection: non-financial notifications ──
  // Reject crypto price alerts, promotional content, marketing, etc. before
  // any amount parsing to avoid false positives on dollar amounts in promos.
  if (NON_FINANCIAL_PATTERNS.some(p => p.test(t))) {
    return {
      isOutgoing: false,
      recurrence: 'One-time',
      rejectionReason: 'Non-financial notification (crypto/promo/marketing)',
    };
  }

  const hasStop = STOP_PHRASES.some(p => tLower.includes(p));
  const hasStrongGo = GO_PHRASES.some(p => tLower.includes(p));
  const hasWeakGo = WEAK_GO_PHRASES.some(p => tLower.includes(p));
  const hasGo = hasStrongGo || hasWeakGo;
  const hasRefund = REFUND_PHRASES.some(p => tLower.includes(p));
  const hasPreAuth = PRE_AUTH_PHRASES.some(p => tLower.includes(p));
  const hasSettlement = SETTLEMENT_PHRASES.some(p => tLower.includes(p));
  const hasIncome = INCOME_PHRASES.some(p => tLower.includes(p));
  const amountCandidates = findAllAmounts(t);
  const hasDollarSign = /\$\d/.test(t);

  // ── Income detection (Interac e-Transfers, deposits, payroll) ──
  // Per product spec: only EXPENSE transactions are captured. Income,
  // deposits, e-Transfers received, payroll credits, etc. are explicitly
  // rejected so the user's expense tracking isn't polluted with money
  // flowing in. The notification pipeline logs the rejection so the user
  // can debug if needed, but no row is inserted.
  if (hasIncome) {
    return {
      isOutgoing: false,
      recurrence: 'One-time',
      isIncome: true,
      rejectionReason: 'Income notification \u2014 only expenses are captured',
    };
  }

  // Pre-authorization filtering:
  // If notification matches a pre-auth phrase OR only has weak GO (authorized/approved)
  // without any strong GO or settlement phrase, reject it as a pre-auth hold.
  // A dollar sign alone doesn't override this — "Authorized $50 at Starbucks" is still pre-auth.
  const isLikelyPreAuth = !hasRefund && !hasSettlement && !hasStrongGo
    && (hasPreAuth || hasWeakGo);

  if (isLikelyPreAuth && amountCandidates.length > 0) {
    return {
      isOutgoing: false,
      recurrence: 'One-time',
      rejectionReason: 'Pre-authorization hold (not yet settled)',
      isPreAuth: true,
    };
  }

  // Refund notifications should be accepted, not rejected.
  // Reject if: no amounts at all, OR stop-phrase present with no go-phrase
  // and no dollar sign (banking apps often just say "$12.34 at Vendor")
  // BUT: never reject if it's a refund notification with an amount
  const shouldReject = amountCandidates.length === 0
    || (!hasRefund && ((hasStop && !hasGo) || (!hasGo && !hasDollarSign)));

  if (shouldReject) {
    return {
      isOutgoing: false,
      recurrence: 'One-time',
      rejectionReason: hasStop && !hasGo ? 'Contains stop phrase' : 'Missing amount or outgoing keywords',
    };
  }

  const pickedAmount = pickAmount(amountCandidates, tLower);
  if (!pickedAmount) {
    return { isOutgoing: false, recurrence: 'One-time', rejectionReason: 'Amount not found' };
  }

  const vendorRaw = extractVendorRaw(t, hasRefund);
  const cleanedVendor = cleanVendor(vendorRaw);
  let vendorDisplay = formatVendorName(titleCaseVendor(cleanedVendor));
  let vendorKey = toVendorKey(cleanedVendor || 'unknown');

  // ── Final vendor sanity check ──
  // If every word in the extracted vendor is a common noun ("You Got",
  // "Subscription Panic", "Transaction Alert", "Monthly Payment"), the
  // parser has picked up boilerplate instead of a real merchant name.
  // The pipeline will fall back to the on-device AI to re-extract; if the
  // AI also fails, this is rejected below with a clear reason.
  if (isCommonNounOnly(vendorDisplay) || vendorDisplay === 'Unknown') {
    console.warn(
      `[parser] Common-noun vendor rejected: "${vendorDisplay}" from text "${t.slice(0, 80)}..."`,
    );
    return {
      isOutgoing: false,
      recurrence: 'One-time',
      rejectionReason: vendorDisplay === 'Unknown'
        ? 'No vendor name found in notification'
        : `Vendor extraction looks like boilerplate ("${vendorDisplay}")`,
    };
  }

  let recurrence: ParsedNotification['recurrence'] = 'One-time';
  if (/biweekly|bi-weekly|every two weeks|every 2 weeks|fortnight/.test(tLower)) {
    recurrence = 'Biweekly';
  } else if (/monthly|every month|per month|\/mo|mo\./.test(tLower)) {
    recurrence = 'Monthly';
  } else if (/recurring|recur|subscription|autopay|auto-pay|preauthorized|pre-authorized|pad/.test(tLower)) {
    recurrence = 'Monthly';
  }

  // ── Confidence scoring ──
  // Higher = the parser is confident in its extraction. The notification
  // pipeline uses this to decide whether to fall back to the on-device
  // AI model (low confidence) or trust the regex result outright (high).
  const confidenceReasons: string[] = [];
  let confidence = 0.5; // baseline: we extracted something, but it's a guess

  if (hasStrongGo) {
    confidence += 0.2;
    confidenceReasons.push('strong go-phrase');
  } else if (hasWeakGo) {
    confidence += 0.05;
    confidenceReasons.push('weak go-phrase (pre-auth?)');
  } else if (hasDollarSign) {
    confidence += 0.1;
    confidenceReasons.push('dollar sign without go-phrase');
  }

  if (hasSettlement) {
    confidence += 0.1;
    confidenceReasons.push('settlement phrase');
  }

  if (amountCandidates.length === 1) {
    confidence += 0.1;
    confidenceReasons.push('single amount candidate');
  } else if (amountCandidates.length > 1) {
    confidence -= 0.1;
    confidenceReasons.push(`multiple amount candidates (${amountCandidates.length})`);
  }

  if (vendorDisplay && vendorDisplay !== 'Unknown') {
    // Strong preposition-based extraction → +0.1
    if (/\b(at|from|to|paid to|with)\s+/i.test(t) && vendorDisplay.length >= 3) {
      confidence += 0.1;
      confidenceReasons.push('preposition-based vendor');
    }
  } else {
    confidence -= 0.15;
    confidenceReasons.push('no vendor extracted');
  }

  // Clamp to [0, 1]
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    isOutgoing: true,
    amount: pickedAmount,
    vendorDisplay: vendorDisplay || 'Unknown',
    vendorKey,
    recurrence,
    isRefund: hasRefund,
    confidence,
    confidenceReasons,
  };
}
