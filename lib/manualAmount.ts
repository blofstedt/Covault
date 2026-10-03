/** transactions.amount is numeric(12, 2) in the checked-in database schema. */
export const MAX_MANUAL_AMOUNT_CENTS = 999_999_999_999;

function readManualCents(value: string): number | null {
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  // Build cents before converting to Number, so a large dollar value cannot
  // round off its fraction during multiplication.
  return Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
}

export function isManualAmountOverLimit(value: string): boolean {
  const cents = readManualCents(value);
  return cents !== null && cents > MAX_MANUAL_AMOUNT_CENTS;
}

/** Read a complete positive amount in whole cents, never a numeric prefix. */
export function parseManualAmount(value: string): number | null {
  const cents = readManualCents(value);
  if (cents === null || !Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_MANUAL_AMOUNT_CENTS) return null;
  const amount = cents / 100;
  // The saved number must still display the exact cents the person entered.
  return Number(amount.toFixed(2).replace('.', '')) === cents ? amount : null;
}

function normalizePastedManualAmount(value: string): string | null {
  const text = value.trim();
  if (!/^\$?\s*(?:\d+|\d{1,3}(?:,\d{3})+|(?=\.\d))(?:\.\d{1,2})?$/.test(text)) return null;
  return text.replace(/[$,\s]/g, '');
}

export function isPastedManualAmountOverLimit(value: string): boolean {
  const normalized = normalizePastedManualAmount(value);
  return normalized !== null && isManualAmountOverLimit(normalized);
}

/** Accept copied dollar amounts, but never turn "12abc" into a $12 entry. */
export function parsePastedManualAmount(value: string): number | null {
  const normalized = normalizePastedManualAmount(value);
  return normalized === null ? null : parseManualAmount(normalized);
}
