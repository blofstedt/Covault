import { formatVendorName } from './formatVendorName';

const STOP_PHRASES = [
  'verification code', 'security code', 'otp', 'passcode', '2fa', 'password', 'login', 'signed in', 'new device',
  'statement', 'e-statement', 'payment due', 'due date',
  'account balance', 'available balance', 'current balance', 'balance is',
  'refund', 'reversal', 'credited', 'deposit', 'payroll', 'salary', 'interest', 'cashback', 'dividend', 'e-transfer received', 'etransfer received', 'transfer received', 'money received',
  'available credit', 'credit limit',
];

const GO_PHRASES = [
  'spend', 'spent', 'purchase', 'purchased', 'debit', 'debit purchase', 'pos', 'tap', 'tapped', 'charged', 'charge', 'authorized', 'approved',
  'payment', 'bill payment', 'bill paid', 'paid', 'payment to',
  'transfer to', 'sent to', 'e-transfer sent', 'etransfer sent', 'interac e-transfer sent',
  'cost', 'costs', 'pre-authorized debit', 'preauthorized debit',
  'withdrawal', 'atm withdrawal',
];

const amountRegex = /(?<!\w)(?:\$|cad\s*)\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:[.,]([0-9]{1,2}))?(?!\w)|(?<!\w)([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{2}))(?!\w)/gi;

export interface ParsedNotification {
  isOutgoing: boolean;
  amount?: number;
  vendorDisplay?: string;
  vendorKey?: string;
  recurrence: 'One-time' | 'Biweekly' | 'Monthly';
  rejectionReason?: string;
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

function extractVendorRaw(text: string): string {
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

export function parseNotificationText(text: string): ParsedNotification {
  const t = text.trim();
  const tLower = collapseWhitespace(t.toLowerCase());

  const hasStop = STOP_PHRASES.some(p => tLower.includes(p));
  const hasGo = GO_PHRASES.some(p => tLower.includes(p));
  const amountCandidates = findAllAmounts(t);
  const hasDollarSign = /\$\d/.test(t);

  // Reject if: no amounts at all, OR stop-phrase present with no go-phrase
  // and no dollar sign (banking apps often just say "$12.34 at Vendor")
  const shouldReject = amountCandidates.length === 0
    || (hasStop && !hasGo)
    || (!hasGo && !hasDollarSign);

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

  const vendorRaw = extractVendorRaw(t);
  const cleanedVendor = cleanVendor(vendorRaw);
  const vendorDisplay = formatVendorName(titleCaseVendor(cleanedVendor));
  const vendorKey = toVendorKey(cleanedVendor || 'unknown');

  let recurrence: ParsedNotification['recurrence'] = 'One-time';
  if (/biweekly|bi-weekly|every two weeks|every 2 weeks|fortnight/.test(tLower)) {
    recurrence = 'Biweekly';
  } else if (/monthly|every month|per month|\/mo|mo\./.test(tLower)) {
    recurrence = 'Monthly';
  } else if (/recurring|recur|subscription|autopay|auto-pay|preauthorized|pre-authorized|pad/.test(tLower)) {
    recurrence = 'Monthly';
  }

  return {
    isOutgoing: true,
    amount: pickedAmount,
    vendorDisplay: vendorDisplay || 'Unknown',
    vendorKey,
    recurrence,
  };
}
