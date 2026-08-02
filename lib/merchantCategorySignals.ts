// lib/merchantCategorySignals.ts
//
// Offline "what kind of business is this?" signals, read from the merchant
// descriptor the bank already puts in the notification.
//
// This exists because restaurants are the worst case for first-time category
// guessing. The proper noun is different every time — "Kinton", "La Carnita",
// "Joe's" — so a learned vendor rule has never seen it and flan-t5-small has
// nothing to reason from either. What IS stable is the descriptor around the
// name (PIZZA, TAQUERIA, BISTRO, BAKERY) and, for one payment processor, the
// prefix on the charge itself. Both are sitting in the notification text and
// were previously thrown away.
//
// Deliberately not a network lookup. This runs on the capture path's terms:
// no key, no rate limit, no per-merchant latency, works with the app closed,
// and nothing about the household's spending leaves the device.
//
// Scope is narrow on purpose — one signal kind, dining — because that is the
// case where the descriptor is reliable. "SPORT", "AUTO" or "MEDICAL" tokens
// are far more likely to appear in a name that means something else.

export type MerchantSignalKind = 'dining';

export interface MerchantSignal {
  kind: MerchantSignalKind;
  /** What fired, for the debug log. */
  evidence: string;
}

/**
 * Payment processors whose customer base is narrow enough to categorise on.
 *
 * Toast (TST*) sells almost exclusively to restaurants, cafes and bars, so the
 * prefix alone is strong evidence regardless of what follows it.
 *
 * Square (SQ*) is NOT in this list on purpose. Barbers, market stalls,
 * contractors, craft sellers and food trucks all run Square, so the prefix
 * means "small independent business" — which is not a category. The same goes
 * for the PayPal and Google prefixes.
 */
const PROCESSOR_RULES: { kind: MerchantSignalKind; evidence: string; pattern: RegExp }[] = [
  { kind: 'dining', evidence: 'TST* (Toast)', pattern: /\bTST\s*\*/i },
];

/**
 * Descriptor tokens that identify a food-service merchant.
 *
 * Every entry has to survive one test: could this word plausibly appear in the
 * name of a business that is NOT a restaurant? Words that fail it are left out
 * even when they are common in restaurant names — "LOUNGE" (spas, salons),
 * "BAR" (juice bars, but also bar stools and sports bars' retail arms),
 * "MARKET" (groceries), "CHOCOLATE" (retail confectioners).
 *
 * Written without accents; the input is stripped of diacritics before matching
 * so "CAFÉ" and "CRÊPERIE" hit the ASCII entries here.
 */
const DINING_TOKENS = [
  // Venue types
  'RESTAURANTS?', 'RESTAURANTE', 'PIZZERIA', 'PIZZA', 'TRATTORIA', 'OSTERIA',
  'BRASSERIE', 'BISTROT?', 'CANTINA', 'TAQUERIA', 'STEAKHOUSE', 'CHOPHOUSE',
  'DINER', 'EATERY', 'EATS', 'GRILLE?', 'GRILLHOUSE', 'KITCHEN', 'CUISINE',
  'BUFFET', 'CAFE', 'CAFETERIA', 'COFFEE', 'ESPRESSO', 'ROASTERS?',
  'ROASTERY', 'ROASTING', 'TEAHOUSE', 'BAKERY', 'BAKESHOP', 'BAKEHOUSE',
  'BAKING', 'PATISSERIE',
  'BOULANGERIE', 'CREPERIE', 'DELI', 'DELICATESSEN', 'PUB', 'TAVERN',
  'ALEHOUSE', 'BREWERY', 'BREWING', 'BREWHOUSE', 'TAPROOM', 'CREAMERY',
  'GELATO', 'ICE\\s+CREAM',
  // Dishes and cuisines
  'SUSHI', 'RAMEN', 'PHO', 'NOODLES?', 'DUMPLINGS?', 'TACOS?', 'BURRITOS?',
  'QUESADILLA', 'KEBABS?', 'KABOBS?', 'SHAWARMA', 'GYROS?', 'FALAFEL',
  'CURRY', 'TANDOORI', 'BIRYANI', 'POKE', 'BURGERS?', 'SANDWICH(?:ES)?',
  'WINGS', 'WAFFLES?', 'PANCAKES?', 'DONUTS?', 'DOUGHNUTS?', 'BAGELS?',
  'SMOOTHIE', 'BOBA', 'BUBBLE\\s+TEA', 'DIM\\s+SUM', 'HOT\\s?POT',
  'BBQ', 'BARBEQUE', 'BARBECUE',
  // Delivery platforms. UBER is matched only with EATS — plain "UBER" is a
  // ride, and filing those as dining would be worse than filing them as Other.
  'UBER\\s*EATS', 'DOORDASH', 'SKIP\\s*THE\\s*DISHES', 'GRUBHUB', 'POSTMATES',
  'SEAMLESS', 'FANTUAN', 'FOODORA',
];

const DINING_TOKEN_RE = new RegExp(`\\b(?:${DINING_TOKENS.join('|')})\\b`, 'i');

/**
 * Chains big enough that their own name settles the category, so a food word
 * next to it is a department rather than the business.
 *
 * "LOBLAWS BAKERY" is a grocery run; "IKEA RESTAURANT" is a furniture trip that
 * happened to include meatballs. Without this, the descriptor token wins and
 * confidently files both as dining. Suppressing the signal entirely is the
 * right call here rather than trying to pick a category — a grocery chain's own
 * name is exactly the kind of thing a learned vendor rule handles well, so
 * these merchants get sorted properly on the second purchase anyway.
 */
const CHAIN_NAME_WINS_RE = new RegExp(
  '\\b(?:' + [
    'LOBLAWS?', 'SOBEYS?', 'SAFEWAY', 'FRESHCO', 'NO\\s*FRILLS', 'SUPERSTORE',
    'RCSS', 'WHOLE\\s*FOODS', 'WHOLEFDS', "TRADER\\s*JOE'?S?", 'KROGER',
    'PUBLIX', 'ALDI', 'LIDL', 'WEGMANS',
    'COSTCO', 'WALMART', 'WAL[\\s-]?MART', 'WM\\s*SUPERCENTER', 'TARGET',
    'IKEA', 'CANADIAN\\s*TIRE', 'SHOPPERS\\s*DRUG', 'METRO',
  ].join('|') + ')\\b',
  'i',
);

/** Fold accents so "CAFÉ" matches the ASCII token "CAFE". */
function deaccent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Read a business-type signal out of a merchant name or raw notification text.
 *
 * Returns null when nothing fires, which is the common case and must stay
 * cheap — callers run this on every capture that would otherwise land in
 * "Other".
 */
export function detectMerchantSignal(text: string | null | undefined): MerchantSignal | null {
  const value = deaccent((text || '').trim());
  if (!value) return null;

  // Checked before anything else, including the processor prefix: a big chain's
  // own name outranks both.
  if (CHAIN_NAME_WINS_RE.test(value)) return null;

  for (const rule of PROCESSOR_RULES) {
    if (rule.pattern.test(value)) {
      return { kind: rule.kind, evidence: rule.evidence };
    }
  }

  const tokenMatch = value.match(DINING_TOKEN_RE);
  if (tokenMatch) {
    return { kind: 'dining', evidence: tokenMatch[0].toUpperCase() };
  }

  return null;
}

/**
 * Category-name patterns a dining signal is allowed to resolve to, best first.
 *
 * These match against the names the user actually created, not a fixed list,
 * because budgets here are user-defined — "Restaurants & Bars", "Eating Out"
 * and "Food/Dining" are all the same intent spelled three ways.
 *
 * A bare "Food" is last and separate because it is genuinely ambiguous: plenty
 * of households use it to mean groceries. It is still preferable to "Other",
 * and the result can never be auto-filed (see the caller), so the worst case is
 * one tap in the review list rather than a silently miscategorised charge.
 */
const DINING_CATEGORY_PATTERNS: RegExp[] = [
  /\b(?:dining|restaurants?|eating\s*out|dine\s*out|takeout|take[\s-]?out)\b/i,
  /\b(?:fast\s*food|food\s*(?:&|and|\/)\s*drink|coffee|cafe|meals?)\b/i,
  /\bfood\b/i,
];

/**
 * Map a signal onto one of the user's own budget categories.
 *
 * Returns null when the user has no category the signal clearly belongs in.
 * That is the intended outcome, not a failure: inventing a destination — a
 * restaurant charge dropped into "Leisure" because it was the closest of a
 * generic default set — is how a month of budget data quietly goes wrong. When
 * there is nowhere obvious to put it, "Other" and a review tap is correct.
 */
export function resolveSignalCategory<T extends { id: string; name: string }>(
  signal: MerchantSignal,
  availableCategories: T[],
): T | null {
  if (signal.kind !== 'dining' || !availableCategories?.length) return null;

  for (const pattern of DINING_CATEGORY_PATTERNS) {
    const hit = availableCategories.find((c) => c?.name && pattern.test(c.name));
    if (hit) return hit;
  }
  return null;
}
