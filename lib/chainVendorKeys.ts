// lib/chainVendorKeys.ts
//
// Teach a rule for the CHAIN, not the branch — but only for chains where that
// is unambiguously safe.
//
// A learned rule's `match_key` has to be what the bank actually sends, because
// that is the string that recurs (see the big comment in useTransactionOps.ts
// about why a rename keeps the ORIGINAL parsed name as match_key). The trouble
// is that a chain announces every location under its own name — "WENDY'S
// CROWFOOT", "WENDY'S OLYMPIC", "WENDY'S COCHRANE" — so each one is a
// different literal string, and teaching the rule once at one branch has
// never covered the other five. A household that had taught Wendy's five
// times over had five rules, one per branch, entirely because nothing told
// the write path that the five branches were the same lesson.
//
// The fix is not new matching logic — `match_type: 'prefix'` already exists
// and is already understood by every reader of the overrides table (the
// pipeline's own lookup, `useVendorMatcher`, the widget's mirror in
// WidgetDeltaStore.java). The fix is choosing to WRITE a prefix rule, keyed to
// the chain's own name, instead of the branch-specific one — for chains named
// here, and nowhere else.
//
// ── Why the list is short, and getting it wrong costs more here than in
//    merchantCategorySignals.ts ──
//
// A wrong guess in the category-signal detector costs one tap in Review: it
// can never auto-file, so the worst case is a mildly annoying pre-fill. A rule
// written here can reach the auto-accept threshold and file money without a
// human ever looking — so a chain belongs on this list only when EVERY branch
// of it genuinely means the same category, with no exceptions. That is a
// narrower bar than "this word is unambiguous", which is all the category
// detector needs.
//
// It is exactly the bar `CHAIN_NAME_WINS_RE` in merchantCategorySignals.ts
// already draws, for the opposite reason: those chains are named there
// because they sell across categories and a shared-word guess would
// confidently mis-file them. The same fact makes them wrong here too, for a
// sharper reason — Costco is the one that proved it. A household's own
// Costco rules split Groceries and Transport, because Costco has a gas bar
// and the two purchases are genuinely different money. A blanket "costco"
// rule would have forced the gas-bar charge into whatever category the
// warehouse run was taught, silently, at full confidence. Every grocery and
// big-box chain in `CHAIN_NAME_WINS_RE` carries the same risk — a pharmacy
// counter, a gas bar, a food court — so none of them, and nothing shaped
// like them, belongs here. IKEA is excluded for the same reason it is
// excluded there: a restaurant inside a furniture store.
//
// What IS safe: a chain whose branches sell exactly one kind of thing
// regardless of which location — a burger is a burger anywhere Wendy's has a
// counter, a haircut is a haircut anywhere Great Clips has a chair. That is
// the entire membership test below, and it is checked chain by chain, by
// hand, not derived from a pattern.

import { toVendorKey } from './deviceTransactionParser';

/**
 * Chains where every branch means the same spending, so teaching one branch
 * may teach the whole chain.
 *
 * Restaurants and cafes dominate the list on purpose: they are where the
 * branch-per-rule problem actually showed up (a chain announces its location
 * in the merchant name; a haircut or a flight usually does not), and a
 * restaurant chain is close to definitionally single-category. The smaller
 * groups after it — pure-play retail, personal care, hotels and airlines —
 * are each single-purpose in the same way and were picked by hand, not
 * generated from the category-signal lists, because the bar here is stricter
 * than "not obviously wrong" (see the file header).
 *
 * Deliberately excluded, even though they are large and well known: every
 * grocery, pharmacy and big-box chain — Costco, Walmart, Loblaws, Sobeys,
 * Safeway, No Frills, Real Canadian Superstore, Metro, Shoppers Drug Mart,
 * Canadian Tire, Target, Whole Foods, Trader Joe's, Kroger, Publix, Aldi,
 * Lidl, Wegmans, IKEA. `chainVendorKeys.test.ts` fails the build if any of
 * these ever appear here.
 */
const CHAIN_NAMES = [
  // Burgers and quick service
  "Wendy's", "McDonald's", 'Burger King', "Harvey's", 'Five Guys',
  'Shake Shack', 'In-N-Out', 'Whataburger', 'Jack in the Box', "Carl's Jr",
  "Hardee's", 'White Castle', "Culver's", 'Sonic Drive-In', 'Dairy Queen',

  // Chicken
  'Popeyes', 'Chick-fil-A', "Mary Brown's", "Raising Cane's", "Zaxby's",
  'Bojangles', 'Swiss Chalet', "Nando's", 'St-Hubert', 'Wingstop',

  // Mexican and bowls
  'Taco Bell', 'Chipotle', 'Qdoba', 'Mucho Burrito', 'Panda Express',

  // Sandwiches and subs
  'Subway', 'Quiznos', "Jimmy John's", "Jersey Mike's", 'Firehouse Subs',
  'Mr Sub', 'Pita Pit', 'Extreme Pita', "Osmow's", 'Freshii', 'Panera',

  // Coffee and doughnuts
  'Starbucks', 'Tim Hortons', 'Dunkin', 'Second Cup', "Peet's",
  'Caribou Coffee', 'Blenz', 'Krispy Kreme', 'Cinnabon',

  // Pizza
  "Domino's", "Papa John's", 'Little Caesars', 'Boston Pizza',
  'Pizza Pizza', 'Pizzaville',

  // Sit-down
  'The Keg', 'Cactus Club', "Moxie's", 'Milestones', "Montana's",
  "Kelsey's", "Jack Astor's", 'Red Lobster', 'Olive Garden',
  "Applebee's", "Chili's", "Denny's", 'IHOP', 'Cracker Barrel',
  'Outback Steakhouse', "TGI Friday's", 'Buffalo Wild Wings',

  // Pure-play retail — one kind of store, everywhere it has a door.
  'Dollarama', 'Dollar Tree', 'Winners', 'HomeSense', 'Marshalls',
  'TJ Maxx', 'HomeGoods', 'Best Buy', 'Staples', 'Sport Chek',
  'Foot Locker', 'Indigo', 'Chapters',

  // Personal care
  'Sephora', 'Ulta', 'Sally Beauty', 'Great Clips', 'Supercuts',
  'First Choice Haircutters', 'Chatters', "Tommy Gun's", 'European Wax',

  // Airlines and hotels — the flight or the stay is Travel wherever it is.
  'Air Canada', 'WestJet', 'Porter Airlines', 'Delta Airlines',
  'United Airlines', 'American Airlines', 'Alaska Airlines',
  'Southwest Airlines', 'JetBlue', 'Marriott', 'Hilton', 'Hyatt',
  'Sheraton', 'Westin', 'Fairmont', 'Best Western', 'Holiday Inn',
  'Travelodge',
];

/** Below this, a "prefix" is really just a word, and coincidence gets likely. */
const MIN_ROOT_LENGTH = 4;

const CHAIN_ROOT_KEYS: readonly string[] = Array.from(
  new Set(
    CHAIN_NAMES.map(toVendorKey).filter((key) => key.length >= MIN_ROOT_LENGTH),
  ),
)
  // Longest first: purely defensive, since the curated names above are not
  // expected to overlap, but a shared prefix should resolve to the more
  // specific chain if one is ever added later.
  .sort((a, b) => b.length - a.length);

export interface ChainAwareMatchKey {
  matchKey: string;
  matchType: 'exact' | 'prefix';
}

/**
 * Where a new rule's match_key and match_type should point, given the
 * incoming vendor's normalized key.
 *
 * Returns a `prefix` rule keyed to the chain's own name when the incoming key
 * is a known chain name WITH something appended after it — a branch, a store
 * number, a city (the exact case that produced five Wendy's rules). Returns
 * the key unchanged, as `exact`, for everything else: an unrecognised
 * merchant, or a known chain's bare name with nothing appended (nothing to
 * generalise away).
 *
 * This only decides what gets WRITTEN. Matching a `prefix` rule against a
 * future capture is ordinary, already-existing behaviour — see
 * `bestMatchIn` in `useVendorMatcher.ts` and the equivalent lookup in
 * `notificationProcessor.ts`.
 */
export function chainAwareMatchKey(vendorKey: string): ChainAwareMatchKey {
  const key = String(vendorKey || '');
  for (const root of CHAIN_ROOT_KEYS) {
    if (key.length > root.length && key.startsWith(root)) {
      return { matchKey: root, matchType: 'prefix' };
    }
  }
  return { matchKey: key, matchType: 'exact' };
}
