// lib/fuelHold.ts
//
// Pre-authorisation ("hold") detection for fuel purchases.
//
// A pay-at-pump purchase is announced twice by the card network: first as an
// authorisation for a round figure the station picked ($150, $250, sometimes a
// $1 ping), then — hours or days later — as the settled amount for what was
// actually pumped. Banking apps reliably notify on the first and, in practice,
// often never on the second. Capture therefore records $150 for a $72 fill and
// nothing ever corrects it.
//
// What this module does is deliberately narrow: recognise the shape of a hold
// (fuel merchant + a suspiciously round figure) so the pipeline can store a
// placeholder and put the row in front of the user, instead of quietly filing a
// number that is wrong. It never claims to know the real amount — only the
// person who pumped the fuel does.
//
// The placeholder itself is a guess with a floor under it: the user's own
// median past fill at that station when there is enough history to have one,
// and $100 when there is not. Either way the row says "placeholder" until the
// real number is entered, so the guess is never mistaken for a fact.

import type { Transaction } from '../types';

/** Fallback placeholder when the user has no fill history to learn from. */
export const FUEL_HOLD_PLACEHOLDER = 100;

/**
 * Smallest hold worth treating as a hold, and the step it has to land on.
 *
 * Stations authorise in round quarters — $50, $75, $100, $125, $150, $175,
 * $200, $250. Anything below $50 that is not a token ping is far more likely to
 * be a real fill that happened to end in .00, so it is left alone.
 */
const HOLD_STEP = 25;
const HOLD_MIN = 50;

/**
 * Token authorisations: the $1.00 (occasionally $0.01) ping a pump puts through
 * to check the card is live before it will dispense anything. Never a real
 * purchase — nobody buys a dollar of gas — so these are always holds.
 */
const TOKEN_AUTH_MAX = 1.5;

/** Fills needed before the user's own history beats the flat $100 default. */
const MIN_FILLS_FOR_MEDIAN = 3;

/** How far back to look for past fills, in days. */
const FILL_HISTORY_DAYS = 400;

export interface FuelHold {
  /** The round figure the bank actually announced. */
  holdAmount: number;
  /** What the row carries until the user tells us the real number. */
  placeholderAmount: number;
  /** Where the placeholder came from, so the UI can say so honestly. */
  basis: 'median-fill' | 'default';
}

/**
 * Fuel brands and forecourt words.
 *
 * Conservative on purpose. Every entry has to be a name that means "fuel" and
 * nothing else, because a false positive here does real damage: it replaces a
 * correct amount with a placeholder and makes the user retype it. That is why
 * genuinely ambiguous names a Canadian or US station also trades under —
 * "Pioneer", "Holiday", "Gulf", plain "QT" — are missing on purpose, and why
 * warehouse clubs and grocers only count when a fuel word sits next to them.
 */
const FUEL_TOKENS = [
  // Forecourt words
  'GAS\\s*BAR', 'GAS\\s*STATION', 'GASOLINE', 'PETROL(?:EUM)?', 'FUEL(?:S)?',
  'SERVICE\\s*STATION', 'TRUCK\\s*STOP', 'CARD\\s*LOCK', 'CARDLOCK', 'PUMP\\s*&?\\s*PANTRY',
  // Canada
  'PETRO[\\s-]?CANADA', 'PETROCAN', 'PETRO[\\s-]?PASS', 'ESSO', 'HUSKY', 'ULTRAMAR',
  'IRVING\\s*OIL', 'FAS\\s*GAS', 'CO[\\s-]?OP\\s*GAS', 'MACEWEN', 'CENTEX', 'DOMO',
  'PARKLAND', 'COUCHE[\\s-]?TARD',
  // Shared / global majors
  'SHELL', 'CHEVRON', 'MOBIL', 'EXXON', 'TEXACO', 'ARCO', 'AMOCO', 'SUNOCO',
  'CITGO', 'VALERO', 'MARATHON', 'CONOCO', 'PHILLIPS\\s*66', 'SINCLAIR', 'CENEX',
  '\\bBP\\b',
  // US chains
  'SPEEDWAY', 'WAWA', 'SHEETZ', 'QUIKTRIP', 'RACETRAC', 'RACEWAY', 'PILOT\\s*(?:TRAVEL|FLYING)',
  'FLYING\\s*J', "LOVE'?S\\s*(?:TRAVEL|COUNTRY)", 'MURPHY\\s*USA', 'MAVERIK',
  'KWIK\\s*TRIP', 'KWIK\\s*STAR', "CASEY'?S", "BUC[\\s-]?EE'?S", 'GETGO',
  'CUMBERLAND\\s*FARMS', 'ROYAL\\s*FARMS', 'THORNTONS', 'CIRCLE\\s*K', '7[\\s-]?ELEVEN',
];

const FUEL_TOKEN_RE = new RegExp(`(?:${FUEL_TOKENS.join('|')})`, 'i');

/**
 * Retailers that sell fuel on one side of the lot and everything else on the
 * other. Their name alone says nothing, so they only count as a fuel merchant
 * when a fuel word appears with it.
 */
const CLUB_RETAILER_RE = /\b(?:COSTCO|SAM'?S\s*CLUB|WALMART|WAL[\s-]?MART|KROGER|SAFEWAY|MEIJER|CANADIAN\s*TIRE|SOBEYS)\b/i;
const FUEL_WORD_RE = /\b(?:GAS|FUEL|PETROL|GASOLINE|PUMP)\b/i;

/** Fold accents so a decorated brand name still matches the ASCII token. */
function deaccent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * True when the merchant text describes a filling station.
 *
 * Reads whatever it is given — the parsed vendor, the raw notification, or
 * both — because banks vary in which half carries the recognisable name.
 */
export function isFuelMerchant(text: string | null | undefined): boolean {
  const value = deaccent((text || '').trim());
  if (!value) return false;
  if (FUEL_TOKEN_RE.test(value)) return true;
  return CLUB_RETAILER_RE.test(value) && FUEL_WORD_RE.test(value);
}

/**
 * True when an amount has the shape of an authorisation rather than a fill.
 *
 * Round to the quarter and at least $50, or a token ping. A real fill lands on
 * a round figure occasionally — someone asks for exactly $75 — and that case is
 * why the row goes to review with the hold amount showing rather than being
 * silently rewritten.
 */
export function isHoldAmount(amount: number | null | undefined): boolean {
  if (amount == null || !Number.isFinite(amount)) return false;
  const value = Math.abs(amount);
  if (value <= 0) return false;
  if (value <= TOKEN_AUTH_MAX) return true;
  if (Math.round(value * 100) % 100 !== 0) return false; // has cents
  if (value < HOLD_MIN) return false;
  return value % HOLD_STEP === 0;
}

/** Median of a non-empty list, rounded to cents. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(raw * 100) / 100;
}

/** Compare two merchant names loosely enough to survive store numbers. */
function sameStation(a: string, b: string): boolean {
  const norm = (v: string) =>
    deaccent(v).toUpperCase().replace(/[^A-Z]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

/**
 * The user's own past fills at this station, most recent first.
 *
 * Only settled-looking amounts count: a past row that was itself a hold, or is
 * still carrying a placeholder, would teach the median the wrong thing. Rows
 * are matched on merchant name rather than category, because the point is "what
 * do you normally put in the tank *here*" — a $40 top-up at a corner station
 * and a $160 fill at a highway truck stop should not average together.
 */
export function pastFillAmounts(
  vendor: string,
  transactions: Transaction[],
  now: Date = new Date(),
): number[] {
  const cutoff = new Date(now.getTime() - FILL_HISTORY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  return transactions
    .filter((tx) => {
      const amount = Number(tx.amount);
      if (!Number.isFinite(amount) || amount <= 0) return false;
      if (tx.is_projected) return false;
      if (String(tx.date || '').slice(0, 10) < cutoff) return false;
      if (!sameStation(String(tx.vendor || ''), vendor)) return false;
      if (isHoldAmount(amount)) return false;               // a hold, not a fill
      if (readFuelHoldMarker(tx.raw_notification)) return false; // unresolved placeholder
      return true;
    })
    .map((tx) => Number(tx.amount));
}

/**
 * What to store instead of the hold.
 *
 * The user's median fill at this station when there are enough of them,
 * otherwise $100. Either way it is capped at the hold: the authorisation caps
 * what the pump will dispense, so a $50 hold cannot become a $100 fill and
 * writing $100 there would overstate the month.
 *
 * Token pings are the exception to the cap — a $1 ping says nothing about the
 * size of the fill that follows, so capping at $1 would be absurd.
 */
export function placeholderForHold(
  holdAmount: number,
  priorFills: number[] = [],
): { amount: number; basis: FuelHold['basis'] } {
  const hold = Math.abs(holdAmount);
  const isToken = hold <= TOKEN_AUTH_MAX;

  let amount = FUEL_HOLD_PLACEHOLDER;
  let basis: FuelHold['basis'] = 'default';

  if (priorFills.length >= MIN_FILLS_FOR_MEDIAN) {
    amount = median(priorFills);
    basis = 'median-fill';
  }

  if (!isToken) amount = Math.min(amount, hold);
  return { amount: Math.round(amount * 100) / 100, basis };
}

/**
 * Decide whether an incoming capture is a fuel hold.
 *
 * Returns null for everything else, which is the overwhelmingly common case and
 * costs two regex tests.
 */
export function detectFuelHold(input: {
  vendor?: string | null;
  rawText?: string | null;
  amount?: number | null;
  /** Past settled fills at this station, for the placeholder. Optional. */
  priorFills?: number[];
}): FuelHold | null {
  const amount = input.amount;
  if (amount == null || amount <= 0) return null;
  if (!isHoldAmount(amount)) return null;
  if (!isFuelMerchant(`${input.vendor || ''} ${input.rawText || ''}`)) return null;

  const { amount: placeholderAmount, basis } = placeholderForHold(amount, input.priorFills || []);
  return { holdAmount: amount, placeholderAmount, basis };
}

// ── Marking a stored row as a placeholder ────────────────────────────────────
//
// The flag lives in a marker appended to the row's `raw_notification` rather
// than a new column, for two reasons. It needs no migration, and — more to the
// point — the amount alone is no longer enough to recognise a placeholder now
// that it can be any median. An explicit marker is also honest: the row records
// what the bank said AND what we substituted, so nothing is lost and the UI can
// show both.
//
// The marker is stripped everywhere the raw text is shown to the user.

const MARKER_RE = /\n?<!--\s*covault:fuel-hold\s+hold=([\d.]+)\s+placeholder=([\d.]+)\s*-->/;

/** Append the marker to a notification body. */
export function withFuelHoldMarker(rawText: string, hold: FuelHold): string {
  const clean = stripFuelHoldMarker(rawText);
  return `${clean}\n<!-- covault:fuel-hold hold=${hold.holdAmount.toFixed(2)} placeholder=${hold.placeholderAmount.toFixed(2)} -->`;
}

/** Read the marker back, or null if there isn't one. */
export function readFuelHoldMarker(
  rawText: string | null | undefined,
): { holdAmount: number; placeholderAmount: number } | null {
  if (!rawText) return null;
  const m = MARKER_RE.exec(rawText);
  if (!m) return null;
  const holdAmount = parseFloat(m[1]);
  const placeholderAmount = parseFloat(m[2]);
  if (!Number.isFinite(holdAmount) || !Number.isFinite(placeholderAmount)) return null;
  return { holdAmount, placeholderAmount };
}

/** The notification body as the bank sent it, without our bookkeeping. */
export function stripFuelHoldMarker(rawText: string | null | undefined): string {
  return (rawText || '').replace(MARKER_RE, '');
}

/** Every dollar figure in a notification, in the order they appear. */
function amountsIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

/**
 * Recognise a stored row as an unresolved hold placeholder.
 *
 * Marker first. The heuristic below it is the fallback for rows captured before
 * markers existed: a station, a hold-shaped figure in the saved text, and an
 * amount equal to the flat $100 default that figure would have produced. It is
 * necessarily weaker — it cannot tell a genuine $100 fill from a placeholder —
 * which is exactly why new rows get an explicit marker instead.
 *
 * The flag clears itself either way: once the user enters the real amount it no
 * longer matches the recorded placeholder, and the row is an ordinary capture.
 */
export function detectFuelHoldPlaceholder(row: {
  vendor?: string | null;
  amount?: number | null;
  raw_notification?: string | null;
}): FuelHold | null {
  const amount = row.amount;
  if (amount == null || amount <= 0) return null;

  const marker = readFuelHoldMarker(row.raw_notification);
  if (marker) {
    // Still a placeholder only while the amount is untouched.
    if (Math.abs(marker.placeholderAmount - amount) >= 0.005) return null;
    return { ...marker, basis: 'default' };
  }

  const raw = stripFuelHoldMarker(row.raw_notification);
  if (!raw) return null;
  if (!isFuelMerchant(`${row.vendor || ''} ${raw}`)) return null;

  for (const candidate of amountsIn(raw)) {
    if (!isHoldAmount(candidate)) continue;
    const legacy = Math.min(FUEL_HOLD_PLACEHOLDER, candidate <= TOKEN_AUTH_MAX ? FUEL_HOLD_PLACEHOLDER : candidate);
    if (Math.abs(legacy - amount) < 0.005) {
      return { holdAmount: candidate, placeholderAmount: amount, basis: 'default' };
    }
  }
  return null;
}
