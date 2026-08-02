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
    // business" is not a category.
    expect(detectMerchantSignal('SQ *BRIGHTON BARBERS')).toBeNull();
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
      'SPORT CHEK',
    ]) {
      expect(detectMerchantSignal(name), name).toBeNull();
    }
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

  it('returns null rather than inventing a home in a generic default set', () => {
    // The stock categories have nowhere a restaurant obviously belongs.
    // Dropping it in "Leisure" would be a guess dressed up as a decision;
    // "Other" plus a review tap is the correct outcome.
    const defaults = ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other']
      .map((name, i) => ({ id: String(i), name }));
    expect(resolveSignalCategory(signal, defaults)).toBeNull();
  });

  it('is safe on an empty category list', () => {
    expect(resolveSignalCategory(signal, [])).toBeNull();
  });
});
