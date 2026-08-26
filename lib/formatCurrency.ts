// lib/formatCurrency.ts
//
// Single source of truth for the app's money formatting. Several components
// each declared an identical `const fmt = (n) => ...`; use this instead.

/** Format a number as a dollar string, e.g. 12.5 -> "$12.50", -3 -> "-$3.00". */
export function formatCurrency(n: number): string {
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
}

/**
 * One money figure, split so a component can set the cents in their own type.
 *
 * The dashboard's balance prints the dollars large and the cents small — the
 * same idiom the `$` already uses there — so it needs the two halves apart
 * rather than one string. Splitting here rather than in the component keeps one
 * rule for how a figure becomes digits: rounded once, to the cent, before
 * anything is split, so 6432.999 can never render as "6,432" beside ".100".
 */
export interface CurrencyParts {
  /** "-" only when the figure is still negative after rounding to the cent. */
  sign: string;
  /** Grouped, e.g. "6,432". Never carries the sign. */
  dollars: string;
  /** Always two digits, e.g. "48". Never carries the point. */
  cents: string;
}

export function splitCurrency(n: number): CurrencyParts {
  const safe = Number.isFinite(n) ? n : 0;

  // Round first, then read the sign off the result. Taking the sign from the
  // input instead prints "-$0.00" for a balance a fraction of a cent under
  // zero, which is a minus sign in front of nothing.
  const cents = Math.round(Math.abs(safe) * 100);
  const sign = cents > 0 && safe < 0 ? '-' : '';

  const whole = Math.floor(cents / 100);
  const remainder = cents % 100;

  return {
    sign,
    dollars: whole.toLocaleString('en-US'),
    cents: String(remainder).padStart(2, '0'),
  };
}
