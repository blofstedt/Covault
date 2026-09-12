import { describe, it, expect } from 'vitest';
import {
  detectMerchantSignal,
  resolveSignalCategory,
  type MerchantSignal,
} from '../merchantCategorySignals';

/**
 * These signals only ever fire on a capture that was otherwise headed for
 * "Other", and the caller leaves the match confidence at 0 so nothing here can
 * be auto-filed. So the bar for a token is "better than Other", not "certain".
 *
 * What the tests below guard hardest is the other direction: tokens that must
 * NOT fire, because a wrong-but-plausible category is more annoying to spot
 * than an obviously-empty one.
 */

const CATEGORIES = [
  { id: 'c1', name: 'Groceries' },
  { id: 'c2', name: 'Transport' },
  { id: 'c3', name: 'Restaurants' },
  { id: 'c4', name: 'Other' },
];

function dining(text: string): MerchantSignal {
  const signal = detectMerchantSignal(text);
  expect(signal, `expected a signal for "${text}"`).not.toBeNull();
  expect(signal!.kind).toBe('dining');
  return signal!;
}

/**
 * The detector reads three more kinds than dining now (personal, travel,
 * shopping — see optInCategories.test.ts). Several cases below exist to pin
 * that something is NOT a restaurant, which is still exactly what they should
 * pin; they simply must not also require the answer to be "nothing at all".
 */
function notDining(text: string): void {
  const signal = detectMerchantSignal(text);
  expect(signal?.kind ?? null, `"${text}" must not read as dining`).not.toBe('dining');
}

describe('detectMerchantSignal — processor prefixes', () => {
  it('reads TST* as dining regardless of the name after it', () => {
    // The whole point: "Sunrise Kwan" is a name nothing has ever seen before,
    // but Toast only sells to food service.
    const signal = dining('TST* SUNRISE KWAN');
    expect(signal.evidence).toBe('TST* (Toast)');
  });

  it('finds TST* in raw notification text, where polishVendor has not run', () => {
    dining('BMO You spent $24.15 at TST* LA CARNITA on your card ending in 4471');
  });

  it('tolerates the spacing banks actually emit', () => {
    dining('TST *THE LOCAL');
    dining('tst* the local');
  });

  it('does NOT treat SQ* as dining', () => {
    // Square is used by barbers, market stalls and contractors too. "Small
    // business" is not a category — so the prefix itself still decides
    // nothing. This one reads as personal care, and on the word BARBERS
    // rather than on the prefix, which is the distinction being pinned.
    notDining('SQ *BRIGHTON BARBERS');
    expect(detectMerchantSignal('SQ *BRIGHTON BARBERS')?.kind).toBe('personal');
    // With nothing descriptive after it, the prefix alone still says nothing.
    expect(detectMerchantSignal('SQ *ALMALATINAEVENTS')).toBeNull();
  });

  it('does NOT treat PayPal or Google prefixes as dining', () => {
    expect(detectMerchantSignal('PP* STEAM GAMES')).toBeNull();
    expect(detectMerchantSignal('GOOGLE *YOUTUBEPREMIUM')).toBeNull();
  });
});

describe('detectMerchantSignal — descriptor tokens', () => {
  it('catches the venue words that survive in variable restaurant names', () => {
    for (const name of [
      'JOES PIZZA',
      'LA TAQUERIA',
      'KINTON RAMEN',
      'THE BISTRO ON MAIN',
      'PHO 88',
      'SUSHI SHOP 214',
      'BLACKBIRD BAKING',
      'MAPLE DINER',
      'CORNER DELI',
      'SMOKEHOUSE BBQ',
      'THE OLD PUB',
      'STEAM WHISTLE BREWING',
    ]) {
      dining(name);
    }
  });

  it('folds accents so CAFE tokens match either spelling', () => {
    dining('CAFÉ OLIMPICO');
    dining('CREPERIE DU MARCHE');
  });

  it('reports which token fired', () => {
    expect(dining('JOES PIZZA').evidence).toBe('PIZZA');
    expect(dining('KINTON RAMEN').evidence).toBe('RAMEN');
  });

  it('matches delivery platforms', () => {
    dining('DOORDASH*ORDER');
    dining('SKIPTHEDISHES');
    dining('UBER EATS');
    dining('UBEREATS');
  });

  it('does NOT fire on a plain Uber ride', () => {
    // A ride filed as dining is worse than a ride filed as Other, because the
    // user has to notice it to fix it.
    expect(detectMerchantSignal('UBER TRIP HELP.UBER.COM')).toBeNull();
    expect(detectMerchantSignal('UBER *TRIP')).toBeNull();
  });

  it('respects word boundaries so tokens do not match inside other words', () => {
    expect(detectMerchantSignal('PHONE HOUSE')).toBeNull();       // PHO
    expect(detectMerchantSignal('PUBLIX SUPER MARKETS')).toBeNull(); // PUB
    expect(detectMerchantSignal('DELIVERY ROOM CLINIC')).toBeNull(); // DELI
    expect(detectMerchantSignal('POKEMON CENTER')).toBeNull();     // POKE
  });

  it('leaves ordinary non-food merchants alone', () => {
    for (const name of [
      'CANADIAN TIRE #182',
      'SHOPPERS DRUG MART',
      'PETRO-CANADA',
      'NETFLIX.COM',
      'HYDRO ONE',
    ]) {
      expect(detectMerchantSignal(name), name).toBeNull();
    }
    // Sport Chek is now read — as shopping, which is right, and still never
    // as dining.
    notDining('SPORT CHEK');
    expect(detectMerchantSignal('SPORT CHEK')?.kind).toBe('shopping');
  });

  it('is safe on empty and missing input', () => {
    expect(detectMerchantSignal('')).toBeNull();
    expect(detectMerchantSignal('   ')).toBeNull();
    expect(detectMerchantSignal(null)).toBeNull();
    expect(detectMerchantSignal(undefined)).toBeNull();
  });
});

describe('resolveSignalCategory', () => {
  const signal: MerchantSignal = { kind: 'dining', evidence: 'PIZZA' };

  it('maps a dining signal onto the user\'s own category', () => {
    expect(resolveSignalCategory(signal, CATEGORIES)).toEqual({ id: 'c3', name: 'Restaurants' });
  });

  it('recognises the same intent spelled differently', () => {
    const names = ['Dining', 'Dining Out', 'Eating Out', 'Restaurants & Bars', 'Takeout', 'Food & Drink', 'Coffee'];
    for (const name of names) {
      const cats = [{ id: 'x', name: 'Groceries' }, { id: 'y', name }];
      expect(resolveSignalCategory(signal, cats)?.name, name).toBe(name);
    }
  });

  it('prefers an explicit dining category over an ambiguous "Food"', () => {
    const cats = [
      { id: 'a', name: 'Food' },
      { id: 'b', name: 'Dining Out' },
    ];
    expect(resolveSignalCategory(signal, cats)?.name).toBe('Dining Out');
  });

  it('falls back to "Food" only when nothing better exists', () => {
    const cats = [{ id: 'a', name: 'Food' }, { id: 'b', name: 'Other' }];
    expect(resolveSignalCategory(signal, cats)?.name).toBe('Food');
  });

  it('never resolves onto Groceries', () => {
    const cats = [{ id: 'a', name: 'Groceries' }, { id: 'b', name: 'Other' }];
    expect(resolveSignalCategory(signal, cats)).toBeNull();
  });

  it('falls back to Leisure in the stock category set', () => {
    // This is the case that matters most: a vault still on the default
    // categories has nothing matching "dining", so returning null here — which
    // is what this used to do — meant the whole descriptor detector above ran
    // and was then discarded, and every restaurant landed in Other.
    const defaults = ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other']
      .map((name, i) => ({ id: String(i), name }));
    expect(resolveSignalCategory(signal, defaults)?.name).toBe('Leisure');
  });

  it('prefers a real dining category over the Leisure fallback', () => {
    const cats = [
      { id: 'a', name: 'Leisure' },
      { id: 'b', name: 'Restaurants' },
    ].map(c => c);
    expect(resolveSignalCategory(signal, cats)?.name).toBe('Restaurants');
  });

  it('still returns null when there is neither', () => {
    // Housing is not where a taqueria goes, and guessing anyway is worse than
    // Other plus a review tap.
    const cats = [{ id: 'a', name: 'Housing' }, { id: 'b', name: 'Other' }];
    expect(resolveSignalCategory(signal, cats)).toBeNull();
  });

  it('is safe on an empty category list', () => {
    expect(resolveSignalCategory(signal, [])).toBeNull();
  });
});

/**
 * Named chains.
 *
 * The descriptor tokens above work because independents describe themselves.
 * Chains do not — nothing in "WENDY'S CROWFOOT" or "MCDONALDS #4021" says
 * food — so the household's most frequent restaurants were precisely the ones
 * the detector could not see, and they landed in Other.
 */
describe('detectMerchantSignal — named chains', () => {
  it('reads the chain the user actually complained about', () => {
    const signal = dining("WENDY'S CROWFOOT");
    expect(signal.evidence).toContain('WENDY');
  });

  it('reads it out of the raw bank alert, branch suffix and all', () => {
    dining("WENDY'S CROWFOOT \u{1F374} You spent $11.75 with your credit card.");
  });

  it.each([
    'MCDONALDS #4021',
    "MC DONALD'S 2211",
    'BURGER KING 1147',
    'TIM HORTONS #20024',
    'STARBUCKS STORE 6612',
    'A&W STORE 3388',
    'KFC / TACO BELL',
    'SUBWAY 45512',
    'DAIRY QUEEN GRILL',
    'SWISS CHALET 0781',
    'BOSTON PIZZA #219',
    'THE KEG STEAKHOUSE',
    'CHICK-FIL-A #01822',
    'PANDA EXPRESS 2214',
    'FIVE GUYS CALGARY',
  ])('reads %s as dining', (name) => {
    dining(name);
  });

  it('handles apostrophes the bank left out', () => {
    dining('WENDYS OLYMPIC');
    dining('DENNYS 8812');
  });

  it('still lets a grocery or big-box name win', () => {
    // A food court inside a supermarket is a grocery run. The chain-name
    // suppression is checked before any of this.
    expect(detectMerchantSignal('REAL CDN SUPERSTORE STARBUCKS')).toBeNull();
    expect(detectMerchantSignal('WALMART SUBWAY 3312')).toBeNull();
  });

  it('does not fire on words that merely start the same way', () => {
    // The chain patterns are anchored at a word boundary, so a longer word
    // that happens to begin with one must not match.
    expect(detectMerchantSignal('KFCONSULTING')).toBeNull();
    expect(detectMerchantSignal('SUBWAYFARE CONSULTING')).toBeNull();
  });

  it('leaves names that are not chains alone', () => {
    expect(detectMerchantSignal('CANADA POST')).toBeNull();
    expect(detectMerchantSignal('SHELL C33221')).toBeNull();
    expect(detectMerchantSignal('PETRO-CANADA 2211')).toBeNull();
    // Best Buy is a known shopping chain now. Not a restaurant either way.
    notDining('BEST BUY 977');
    expect(detectMerchantSignal('BEST BUY 977')?.kind).toBe('shopping');
  });
});
