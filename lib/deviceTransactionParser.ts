import { formatVendorName } from './formatVendorName';

const STOP_PHRASES = [
  'verification code', 'security code', 'otp', 'passcode', '2fa', 'password', 'login', 'signed in', 'new device',
  'statement', 'e-statement', 'payment due', 'due date',
  'account balance', 'available balance', 'current balance', 'balance is',
  'refund', 'reversal', 'credited', 'deposit', 'payroll', 'salary', 'interest', 'cashback', 'dividend', 'e-transfer received', 'etransfer received', 'transfer received', 'money received',
  'available credit', 'credit limit',
];

const GO_PHRASES = [
  'spent', 'purchase', 'purchased', 'debit', 'debit purchase', 'pos', 'tap', 'tapped', 'charged', 'charge', 'authorized', 'approved',
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

const outgoingHints = /(spent|charged|purchase|purchased|debit|payment|paid|withdrawal|transfer|sent|cost)/;
const balanceHints = /(balance|available|limit|remaining|credit limit|available credit|owing)/;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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

function extractVendorRaw(text: string): string {
  const patterns: RegExp[] = [
    /\b at \s+([A-Za-z0-9&'./#\- ]{2,60})/i,
    /\bmerchant\b[:\s-]+([A-Za-z0-9&'./#\- ]{2,60})/i,
    /\b(payment|paid)\s+to\s+([A-Za-z0-9&'./#\- ]{2,60}?)(?=\s+(?:for|on|using|via|ending)\b|$)/i,
    /\b(transfer|e-?transfer|interac e-?transfer)\b.*?\bto\b\s+([A-Za-z0-9&'./#\- ]{2,60}?)(?=\s+(?:for|on|using|via|ending)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m) continue;
    return (m[2] || m[1] || '').trim();
  }

  // "VENDOR - You spent $X" / "VENDOR – You charged $X" etc.
  // Handles Wealthsimple and any bank that puts the merchant name before a dash
  // and a spending phrase (e.g. "AMZN MKTP CA - You spent $36.64 with your credit card.")
  const vendorBeforeSpending = text.match(
    /^([A-Za-z0-9&'./#\- ]{2,60}?)\s*[-–—]\s*(?:you\s+)?(?:spent|charged|paid|purchased)\b/i,
  );
  if (vendorBeforeSpending) {
    const candidate = vendorBeforeSpending[1].trim();
    if (candidate.length >= 2) return candidate;
  }

  // Fallback: look for text AFTER an amount+keyword pattern like "$12.34 at VENDOR"
  const afterAmount = text.match(/\$[\d,.]+\s+(?:at|from|to|@)\s+([A-Za-z0-9&'./#\- ]{2,60})/i);
  if (afterAmount) return afterAmount[1].trim();

  // Last resort: try to extract a capitalized word sequence near a dollar amount.
  // Reject matches that start with common prepositions/articles — those are almost
  // always false positives like "with your credit card" or "from your account".
  const nearDollar = text.match(/\$[\d,.]+[^A-Za-z]*([A-Z][A-Za-z0-9&'.\- ]{1,59})/i);
  if (nearDollar) {
    const candidate = nearDollar[1].trim();
    if (!/^(?:with|from|on|using|via|by|through|for|and|the|a|an|your|my|our)\b/i.test(candidate)) {
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
  vendor = collapseWhitespace(vendor);
  return vendor;
}

function toVendorKey(vendor: string): string {
  return vendor.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleCaseVendor(vendor: string): string {
  if (!vendor.trim()) return 'Unknown';
  return vendor
    .split(' ')
    .filter(Boolean)
    .map(word => {
      if (word.length <= 3 && word === word.toUpperCase()) return word;
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
