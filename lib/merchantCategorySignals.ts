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

export type MerchantSignalKind = 'dining' | 'personal' | 'travel' | 'shopping';

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
 * Restaurant chains whose own name is the descriptor.
 *
 * The descriptor list above works because most independents describe
 * themselves — "PIZZERIA", "TAQUERIA", "BISTRO". The chains do not: nothing in
 * "WENDY'S CROWFOOT", "MCDONALDS #4021" or "A&W STORE 3388" says food, so the
 * whole detector above ran and found nothing, and a household's most frequent
 * restaurants were exactly the ones landing in Other.
 *
 * These are matched only after the grocery and big-box names above have had
 * their say, so a food court inside a supermarket still reads as a grocery run.
 *
 * The bar for an entry is the same as for a descriptor token: could this word
 * plausibly name something that is not a restaurant? Names that fail it are
 * left out even when the chain is large — a bare "DQ" is two letters, and a
 * surname like "EARLS" appears in businesses of every kind. Where the chain
 * shares a word with another category ("SUBWAY") the merchant reading is the
 * overwhelmingly more common one on a card statement, and the caller never
 * auto-files a signal anyway, so the worst case stays one tap in review.
 *
 * Written without accents, and with the trailing apostrophe-s optional
 * throughout, because banks are inconsistent about both. Every entry is
 * bounded at each end, so "KFCONSULTING" and "SUBWAYFARE" stay untouched.
 */
const DINING_CHAINS = [
  // Burgers and quick service
  "WENDY'?S", "MC\\s?DONALD'?S?", "BURGER\\s*KING", "BK\\s*#", "HARVEY'?S",
  "FIVE\\s*GUYS", "SHAKE\\s*SHACK", "IN[\\s-]?N[\\s-]?OUT", "WHATABURGER",
  "JACK\\s*IN\\s*THE\\s*BOX", "CARL'?S\\s*JR", "HARDEE'?S", "WHITE\\s*CASTLE",
  "STEAK\\s*'?N\\s*SHAKE", "CULVER'?S", "SONIC\\s*DRIVE", "A\\s?&\\s?W",
  "DAIRY\\s*QUEEN",
  // Chicken
  'KFC', 'POPEYES', "CHICK[\\s-]?FIL[\\s-]?A", "MARY\\s*BROWN'?S",
  "RAISING\\s*CANE'?S?", "ZAXBY'?S?", 'BOJANGLES', "SWISS\\s*CHALET", "NANDO'?S?",
  "ST[\\s-]?HUBERT", 'WINGSTOP',
  // Mexican and bowls
  "TACO\\s*BELL", 'CHIPOTLE', 'QDOBA', 'MUCHO\\s*BURRITO', "PANDA\\s*EXPRESS",
  // Sandwiches and subs
  'SUBWAY', 'QUIZNOS', "JIMMY\\s*JOHN'?S?", "JERSEY\\s*MIKE'?S?", "FIREHOUSE\\s*SUBS",
  "MR\\.?\\s*SUB", "PITA\\s*PIT", "EXTREME\\s*PITA", "OSMOW'?S?", 'FRESHII',
  'PANERA',
  // Coffee and doughnuts
  'STARBUCKS', "TIM\\s*HORTONS", 'DUNKIN', "SECOND\\s*CUP", "PEET'?S",
  "CARIBOU\\s*COFFEE", "COFFEE\\s*BEAN\\s*(?:&|AND)\\s*TEA", 'BLENZ',
  "KRISPY\\s*KREME", "CINNABON",
  // Pizza
  "DOMINO'?S", "PAPA\\s*JOHN'?S?", "LITTLE\\s*CAESAR'?S?", "BOSTON\\s*PIZZA",
  "PIZZA\\s*PIZZA", 'PIZZAVILLE',
  // Sit-down
  "THE\\s*KEG", "CACTUS\\s*CLUB", "MOXIE'?S", 'MILESTONES', "MONTANA'?S",
  "KELSEY'?S", "JACK\\s*ASTOR'?S?", "RED\\s*LOBSTER", "OLIVE\\s*GARDEN",
  "APPLEBEE'?S?", "CHILI'?S\\s*GRILL", "DENNY'?S", 'IHOP', "CRACKER\\s*BARREL",
  "OUTBACK\\s*STEAK(?:HOUSE)?", "TGI\\s*FRIDAY'?S?", "BUFFALO\\s*WILD\\s*WINGS",
];

const DINING_CHAIN_RE = new RegExp(`\\b(?:${DINING_CHAINS.join('|')})\\b`, 'i');

/**
 * Personal care: barbers, salons, nails, lashes, brows, spas, tattooists.
 *
 * The same descriptor logic as dining, and it works for the same reason —
 * the proper noun changes every time ("Lola", "Moda", "N & K") but the word
 * beside it does not. A household's Other pile held a lash bar, a nail salon
 * and two barbers, none of which any learned rule had ever seen.
 *
 * "BROW" and "LASH" are safe on a word boundary: "BROWNS SHOES" is not a
 * match for \bBROW\b. Bare "CUTS" is deliberately absent — a butcher and a
 * steakhouse both use it — so "Moda Cuts" is left for a learned rule.
 */
const PERSONAL_TOKENS = [
  'BARBERS?', 'BARBERSHOPS?', 'SALONS?', 'HAIRDRESSERS?', 'HAIRCUTS?',
  'HAIRSTYLING', 'STYLISTS?', 'NAILS?', 'MANICURES?', 'PEDICURES?',
  'LASH(?:ES)?', 'BROWS?', 'WAXING', 'THREADING', 'SPAS?', 'DAY\\s*SPA',
  'AESTHETICS?', 'ESTHETICS?', 'SKIN\\s*CARE', 'SKINCARE', 'FACIALS?',
  'MASSAGE', 'TATTOOS?', 'PIERCING', 'COSMETICS', 'BEAUTY', 'GROOMING',
  'MED\\s*SPA',
];

const PERSONAL_CHAINS = [
  'SEPHORA', 'ULTA', 'SALLY\\s*BEAUTY', 'MAC\\s*COSMETICS', 'LUSH\\s*COSMETICS',
  'GREAT\\s*CLIPS', 'SUPERCUTS', 'FIRST\\s*CHOICE\\s*HAIRCUTTERS', 'CHATTERS',
  "TOMMY\\s*GUN'?S?", 'REGIS\\s*SALON', 'EUROPEAN\\s*WAX',
];

/**
 * Travel: the airline, the hotel, the booking site.
 *
 * "INN" and "LODGE" are left out on purpose — plenty of pubs are an Inn, and
 * the dining detector should keep those. "DELTA" is included: as a merchant
 * on a card statement it is the airline or the hotel, both of which are this
 * category, whereas the tap in a kitchen was bought from a hardware store
 * under the hardware store's name.
 */
const TRAVEL_TOKENS = [
  'AIRLINES?', 'AIRWAYS', 'AIR\\s*LINES?', 'HOTELS?', 'MOTELS?', 'RESORTS?',
  'HOSTELS?', 'CRUISES?', 'CRUISELINES?', 'TRAVEL', 'TOURS', 'VACATIONS?',
  'FLIGHT\\s*CENTRE', 'FLIGHTS?',
];

const TRAVEL_CHAINS = [
  'AIR\\s*CANADA', 'WESTJET', 'PORTER\\s*AIR', 'FLAIR\\s*AIR', 'LYNX\\s*AIR',
  'SUNWING', 'AIR\\s*TRANSAT', 'DELTA', 'UNITED\\s*AIR', 'AMERICAN\\s*AIR',
  'ALASKA\\s*AIR', 'SOUTHWEST\\s*AIR', 'JETBLUE', 'LUFTHANSA', 'KLM',
  'BRITISH\\s*AIRWAYS', 'EXPEDIA', 'BOOKING\\.?COM', 'AIRBNB', 'VRBO',
  'HOTELS\\.?COM', 'TRIVAGO', 'PRICELINE', 'FLIGHTHUB', 'MARRIOTT', 'HILTON',
  'HYATT', 'SHERATON', 'WESTIN', 'FAIRMONT', 'BEST\\s*WESTERN',
  'HOLIDAY\\s*INN', 'TRAVELODGE', 'SANDMAN', 'COAST\\s*HOTEL',
  'VIA\\s*RAIL', 'AMTRAK',
];

/**
 * Shopping: clothes, shoes, jewellery, homewares, electronics, general retail.
 *
 * The narrowest list of the four, because retail words are the most likely to
 * appear in the name of something else. Absent on purpose: "SHOP" (a barber
 * shop, a coffee shop), "MARKET" (groceries), "STORE" and "OUTLET" (anything
 * at all), "SUPPLY" (trades). The big-box names stay in CHAIN_NAME_WINS_RE
 * below, where they suppress every signal — Walmart and Costco genuinely sell
 * all of these categories, and a learned rule is the honest answer there.
 */
const SHOPPING_TOKENS = [
  'BOUTIQUES?', 'APPAREL', 'CLOTHING', 'CLOTHIERS?', 'OUTFITTERS?',
  'FOOTWEAR', 'SHOES', 'JEWELLERS?', 'JEWELERS?', 'JEWELLERY', 'JEWELRY',
  'DEPARTMENT\\s*STORES?', 'DEPT\\s*STORES?', 'THRIFT', 'CONSIGNMENT',
  'HOMEWARES?', 'FURNISHINGS', 'FURNITURE', 'BOOKSTORES?', 'BOOKSELLERS?',
  'STATIONERS?', 'ELECTRONICS',
];

const SHOPPING_CHAINS = [
  'DOLLARAMA', 'DOLLAR\\s*TREE', 'WINNERS', 'HOMESENSE', 'HOME\\s*SENSE',
  'MARSHALLS', 'TJ\\s*MAXX', 'HOMEGOODS', 'NORDSTROM', 'SIMONS',
  "HUDSON'?S\\s*BAY", 'THE\\s*BAY', 'BEST\\s*BUY', 'THE\\s*SOURCE',
  'STAPLES', 'INDIGO', 'CHAPTERS', 'SPORT\\s*CHEK', 'JD\\s*SPORTS',
  'FOOT\\s*LOCKER', 'SPORTING\\s*LIFE', 'ZARA', 'H\\s?&\\s?M', 'UNIQLO',
  'OLD\\s*NAVY', 'GAP', 'BANANA\\s*REPUBLIC', 'LULULEMON', 'ARITZIA',
  'ROOTS\\s*CANADA', 'BROWNS\\s*SHOES', 'ALDO', 'SOFT\\s*MOC',
  'PANDORA\\s*JEWEL', 'SWAROVSKI', 'MICHAEL\\s*HILL', 'PEOPLES\\s*JEWELL',
  'WAYFAIR', 'STRUCTUBE', 'BOUCLAIR', 'TEMU', 'SHEIN', 'ETSY', 'EBAY',
  'ALIEXPRESS', 'WISH\\.?COM',
];

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
const KIND_RULES: { kind: MerchantSignalKind; tokens: RegExp; chains: RegExp }[] = [
  {
    kind: 'dining',
    tokens: DINING_TOKEN_RE,
    chains: DINING_CHAIN_RE,
  },
  {
    kind: 'personal',
    tokens: new RegExp(`\\b(?:${PERSONAL_TOKENS.join('|')})\\b`, 'i'),
    chains: new RegExp(`\\b(?:${PERSONAL_CHAINS.join('|')})\\b`, 'i'),
  },
  {
    kind: 'travel',
    tokens: new RegExp(`\\b(?:${TRAVEL_TOKENS.join('|')})\\b`, 'i'),
    chains: new RegExp(`\\b(?:${TRAVEL_CHAINS.join('|')})\\b`, 'i'),
  },
  {
    kind: 'shopping',
    tokens: new RegExp(`\\b(?:${SHOPPING_TOKENS.join('|')})\\b`, 'i'),
    chains: new RegExp(`\\b(?:${SHOPPING_CHAINS.join('|')})\\b`, 'i'),
  },
];

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

  // Descriptors before chain names, across every kind, then chain names across
  // every kind. Two orderings matter here:
  //
  //   - A descriptor IN the text is the stronger tell, so it is asked first
  //     everywhere. A chain name buried in a longer merchant string
  //     ("WENDY'S CROWFOOT") must not outrank a plain "BARBERSHOP".
  //
  //   - Dining is asked before the rest, because it is the kind with the most
  //     evidence behind its list and the one a shared word most often belongs
  //     to: an "AIRPORT CAFE" is a meal, a "HOTEL RESTAURANT" is a meal.
  //     Shopping is asked last, because its words are the broadest.
  for (const rule of KIND_RULES) {
    const match = value.match(rule.tokens);
    if (match) return { kind: rule.kind, evidence: match[0].toUpperCase() };
  }

  for (const rule of KIND_RULES) {
    const match = value.match(rule.chains);
    if (match) return { kind: rule.kind, evidence: match[0].toUpperCase() };
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
 * Where dining goes in a vault that has no dining category of its own.
 *
 * This used to return null instead, on the reasoning that dropping a
 * restaurant into "Leisure" was a guess dressed up as a decision. The flaw in
 * that reasoning was practical: the stock category set is Housing, Groceries,
 * Transport, Utilities, Leisure, Services, Other, which matches none of the
 * patterns above — so every household still on the defaults got the full
 * descriptor detection above and then had its answer thrown away, and every
 * restaurant landed in "Other" regardless.
 *
 * Restaurants belong in Leisure here — the household's own call, and the one
 * that turns the detector back on for anyone who never renamed a category.
 * It stays the last resort: a vault with a real dining category still uses it,
 * and the caller still refuses to auto-file anything a signal decided, so a
 * wrong guess costs one tap in the review list rather than a silent
 * miscategorisation.
 */
const DINING_FALLBACK_PATTERN = /\b(?:leisure|entertainment|fun|lifestyle|discretionary)\b/i;

/**
 * Category-name patterns for the three later kinds, best first.
 *
 * Matched against the names the user actually has, exactly as dining is, so a
 * category called "Clothes & Gifts" or "Self care" is found without the app
 * needing to know those spellings in advance.
 *
 * None of them has a fallback, and that is the whole point. Dining falls back
 * to Leisure because a restaurant genuinely belongs there in the stock set.
 * There is no equivalent home for a haircut or a flight — so when the
 * household has no such category, or has switched it off, the answer is "I do
 * not know", the capture lands in Other, and the person decides. Inventing a
 * destination from whatever is left is how a month of budget data quietly
 * goes wrong.
 */
const KIND_CATEGORY_PATTERNS: Record<MerchantSignalKind, RegExp[]> = {
  dining: DINING_CATEGORY_PATTERNS,
  personal: [
    /\b(?:personal(?:\s*care)?|grooming|self[\s-]?care)\b/i,
    /\b(?:beauty|hair|salon|wellness)\b/i,
  ],
  travel: [
    /\b(?:travel|trips?|vacations?|holidays?)\b/i,
    /\b(?:flights?|hotels?)\b/i,
  ],
  shopping: [
    /\b(?:shopping|shops?)\b/i,
    /\b(?:clothes|clothing|apparel|retail|goods)\b/i,
  ],
};

/** Only dining has a last resort. See KIND_CATEGORY_PATTERNS for why. */
const KIND_FALLBACK_PATTERNS: Partial<Record<MerchantSignalKind, RegExp>> = {
  dining: DINING_FALLBACK_PATTERN,
};

/**
 * Map a signal onto one of the user's own budget categories.
 *
 * A category named for the kind wins outright. Dining, and only dining, then
 * falls back to Leisure — see DINING_FALLBACK_PATTERN for why that is a
 * decision rather than a shrug.
 *
 * Returns null when the vault has nothing suitable, because inventing a
 * destination out of whatever is left is how a month of budget data quietly
 * goes wrong. "Other" and a review tap is the correct outcome then.
 *
 * IMPORTANT: pass only the categories the user can actually SEE. A category
 * they have switched off is not a destination — filing into it would put the
 * purchase somewhere the dashboard does not draw, which is the one outcome
 * worse than Other. The capture pipeline filters the hidden ones out before
 * calling this; see step 5c of lib/notificationProcessor.ts.
 */
export function resolveSignalCategory<T extends { id: string; name: string }>(
  signal: MerchantSignal,
  availableCategories: T[],
): T | null {
  if (!signal?.kind || !availableCategories?.length) return null;

  const patterns = KIND_CATEGORY_PATTERNS[signal.kind];
  if (!patterns) return null;

  for (const pattern of patterns) {
    const hit = availableCategories.find((c) => c?.name && pattern.test(c.name));
    if (hit) return hit;
  }

  const fallback = KIND_FALLBACK_PATTERNS[signal.kind];
  if (!fallback) return null;

  return availableCategories.find((c) => c?.name && fallback.test(c.name)) ?? null;
}
