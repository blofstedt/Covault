import { formatVendorName } from './formatVendorName';

const STOP_PHRASES = [
  'verification code', 'security code', 'one-time', 'otp', 'passcode', '2fa', 'password', 'login', 'signed in', 'new device',
  'statement', 'e-statement', 'payment due', 'due date',
  'account balance', 'available balance', 'current balance', 'balance is',
  'refund', 'reversal', 'credited', 'deposit', 'payroll', 'salary', 'interest', 'cashback', 'dividend', 'e-transfer received', 'etransfer received', 'received',
  'available credit', 'credit limit',
];

const GO_PHRASES = [
  'spent', 'purchase', 'purchased', 'debit', 'debit purchase', 'pos', 'tap', 'tapped', 'charged', 'charge', 'authorized', 'approved',
  'payment', 'bill payment', 'bill paid', 'paid', 'payment to',
  'transfer to', 'sent to', 'e-transfer sent', 'etransfer sent', 'interac e-transfer sent',
  'cost', 'costs', 'pre-authorized debit', 'preauthorized debit',
  'withdrawal', 'atm withdrawal',
];

const amountRegex = /(?<!\w)(?:\$|cad\s*)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*|[0-9]+)(?:[.,]([0-9]{2}))?(?!\w)/gi;

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
    const rawWhole = match[1] || '';
    const decimals = match[2] || '00';
    const whole = rawWhole.replace(/[\s,]/g, '');
    const value = Number.parseFloat(`${whole}.${decimals}`);
    if (!Number.isFinite(value)) continue;

    const start = match.index || 0;
    const rawMatch = match[0] || '';
    const prevChar = start > 0 ? text[start - 1] : '';
    const hasCurrencyMarker = /^\s*(?:\$|cad\s*)/i.test(rawMatch);
    const hasExplicitDecimals = Boolean(match[2]);

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
    const window = tLower.slice(Math.max(0, c.startIndex - 35), Math.min(tLower.length, c.endIndex + 35));
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

  const cutoff = text.search(/\b(you|spent|charged|purchase|payment|transfer|withdrawal)\b/i);
  if (cutoff > 0) return text.slice(0, cutoff).trim();
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

  if (hasStop || amountCandidates.length === 0 || !hasGo) {
    return {
      isOutgoing: false,
      recurrence: 'One-time',
      rejectionReason: hasStop ? 'Contains stop phrase' : 'Missing amount or outgoing keywords',
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
