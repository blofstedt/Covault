// lib/foreignCurrency.ts
//
// "€9.90" is not $9.90, and the app used to record it as though it were.
//
// The amount finder in deviceTransactionParser looks for a dollar sign, "CAD",
// or a bare number with two decimals. A euro price matches that last case with
// the symbol simply unseen, so a €9.90 pastry was captured as a $9.90 pastry —
// silently, with the right-looking number, and with nothing anywhere to say the
// figure had been read in another currency.
//
// What this file does NOT do is convert. A conversion needs a rate, which needs
// a network, a source and a date, and a rate fetched at review time is not the
// rate the bank used anyway. Guessing a converted number would replace a
// visibly odd figure with an invisibly wrong one, which is the same failure
// wearing better clothes.
//
// So the rule is: notice, refuse to file it behind the user's back, and say so
// on the row. The purchase is still captured — losing a real spend is never the
// answer here — it just has to be looked at by somebody who knows what they
// paid.
//
// Nothing is stored to make this work. The badge in Review re-derives from the
// row's own raw notification, the same way a fuel-hold placeholder does, so
// there is no marker to write, no column to add, and no second copy to drift.

/**
 * Currency symbols that are unambiguously not dollars.
 *
 * The value is what the badge shows, so it is the symbol as written rather
 * than a guessed code: ¥ is both yen and yuan, and an app that cannot know
 * which should not print one of them as though it did.
 */
const FOREIGN_SYMBOLS = ['€', '£', '¥', '₹', '₩', '₽', '₺', '₪', '฿', '₱', '₫'];

/**
 * Three-letter codes for currencies that are not dollars.
 *
 * USD, AUD, NZD and HKD are deliberately absent. A dollar sign on its own
 * cannot tell you whose dollars it is, and a Canadian card charged in US
 * dollars is usually announced in the converted amount anyway — so flagging
 * every alert from a US bank would put a badge on most rows and teach the user
 * to ignore it. The badge is worth having only while it is rare.
 */
const FOREIGN_CODES = [
  'EUR', 'GBP', 'JPY', 'CHF', 'CNY', 'INR', 'KRW', 'SEK', 'NOK', 'DKK',
  'PLN', 'CZK', 'HUF', 'MXN', 'BRL', 'ZAR', 'TRY', 'RUB', 'THB', 'PHP',
  'VND', 'ILS', 'SGD',
];

/** Escape a symbol for use inside a RegExp. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The non-dollar currency this alert quotes, or null.
 *
 * Requires the marker to sit against a number — "€9.90", "9,90 €", "EUR 12.00",
 * "12.00 EUR". A merchant called EURO CAR PARTS, or a sentence mentioning the
 * euro, is not a price and must not put a badge on a perfectly ordinary
 * Canadian purchase.
 */
export function detectForeignCurrency(text: string | null | undefined): string | null {
  const value = (text || '').trim();
  if (!value) return null;

  for (const symbol of FOREIGN_SYMBOLS) {
    const s = escape(symbol);
    if (new RegExp(`${s}\\s*\\d|\\d\\s*${s}`).test(value)) return symbol;
  }

  for (const code of FOREIGN_CODES) {
    if (new RegExp(`\\b${code}\\s*\\d|\\d\\s*${code}\\b`, 'i').test(value)) return code;
  }

  return null;
}
