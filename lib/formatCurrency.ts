// lib/formatCurrency.ts
//
// Single source of truth for the app's money formatting. Several components
// each declared an identical `const fmt = (n) => ...`; use this instead.

/** Format a number as a dollar string, e.g. 12.5 -> "$12.50", -3 -> "-$3.00". */
export function formatCurrency(n: number): string {
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
}
