/**
 * Three categories were added after the app had users. Everything below is
 * about the one property that makes that safe: a household already using
 * Covault must open the app and see exactly the dashboard it had yesterday.
 *
 * The failure this guards is not a crash — it is three extra vials appearing
 * on the one screen the user reads every day, as a side effect of an update
 * they never asked for, at a vial count the two-line row cannot hold. A new
 * vault has nothing to disturb, so it meets all ten in the intro and switches
 * off what it does not want.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SYSTEM_CATEGORIES, OPT_IN_CATEGORIES, isOptInCategory } from '../../constants';
import { sortBudgets, budgetRank } from '../budgetOrder';
import { detectMerchantSignal, resolveSignalCategory } from '../merchantCategorySignals';
import { shouldUseDenseRows, DENSE_ROW_THRESHOLD } from '../vialDensity';

describe('the category list itself', () => {
  it('offers all ten', () => {
    expect(SYSTEM_CATEGORIES.map((c) => c.name)).toEqual([
      'Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure',
      'Services', 'Shopping', 'Personal', 'Travel', 'Other',
    ]);
  });

  it('leaves the original seven in the order they were already in', () => {
    // The three are inserted AFTER Services, never among the originals, so an
    // established dashboard reads top-to-bottom exactly as it did before.
    const original = ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other'];
    const ranked = [...original].sort((a, b) => budgetRank(a) - budgetRank(b));
    expect(ranked).toEqual(original);
  });

  it('keeps Other last even with the new ones present', () => {
    const shuffled = sortBudgets(
      ['Travel', 'Other', 'Housing', 'Shopping', 'Personal'].map((name) => ({ name })),
    );
    expect(shuffled[shuffled.length - 1].name).toBe('Other');
  });

  it('names exactly the three later additions as opt-in', () => {
    expect([...OPT_IN_CATEGORIES].sort()).toEqual(['Personal', 'Shopping', 'Travel']);
  });

  it('never treats one of the original seven as opt-in', () => {
    // If this ever passed for, say, Groceries, that category would arrive
    // switched off for every existing user — their groceries would vanish
    // from the dashboard.
    for (const name of ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other']) {
      expect(isOptInCategory(name), name).toBe(false);
    }
  });

  it('matches opt-in names however they are cased or padded', () => {
    expect(isOptInCategory('shopping')).toBe(true);
    expect(isOptInCategory('  Travel ')).toBe(true);
    expect(isOptInCategory('PERSONAL')).toBe(true);
    expect(isOptInCategory('')).toBe(false);
    expect(isOptInCategory(null)).toBe(false);
    expect(isOptInCategory(undefined)).toBe(false);
  });

  it('gives every category its own colour, with no repeats', () => {
    // The fallback palette repeats, so a category missing from the map is not
    // "similar" to another vial — it is drawn in the identical colour.
    const source = readFileSync(resolve(__dirname, '../budgetColors.ts'), 'utf8');
    const map = source.slice(
      source.indexOf('BUDGET_CATEGORY_COLORS'),
      source.indexOf('FALLBACK_COLORS'),
    );
    const hexes: string[] = [];
    for (const category of SYSTEM_CATEGORIES) {
      const match = map.match(new RegExp(`${category.name}:\\s*'(#[0-9a-f]{6})'`, 'i'));
      expect(match, `${category.name} has no colour of its own`).not.toBeNull();
      hexes.push(match![1].toLowerCase());
    }
    expect(new Set(hexes).size).toBe(SYSTEM_CATEGORIES.length);
  });

  it('gives every category its own icon', () => {
    // Unmatched names all fall through to the same three-dot placeholder, and
    // three vials wearing one glyph reads as a bug.
    const source = readFileSync(
      resolve(__dirname, '../../components/dashboard_components/getBudgetIcon.tsx'),
      'utf8',
    );
    for (const category of SYSTEM_CATEGORIES) {
      if (category.name === 'Other') continue; // Other IS the placeholder
      expect(
        source.includes(`lower.includes('${category.name.toLowerCase()}')`),
        `${category.name} has no icon branch`,
      ).toBe(true);
    }
  });
});

describe('seeding: off in an existing vault, on in a new one', () => {
  const source = readFileSync(resolve(__dirname, '../hooks/useDataLoading.ts'), 'utf8');
  const seedBlock = source.slice(
    source.indexOf('const ensureDefaultBudgets'),
    source.indexOf('const seedDefaultBudgetsIfEmpty'),
  );

  it('decides visibility from whether the vault already had rows', () => {
    expect(seedBlock).toContain('const isNewVault = existingCategories.size === 0');
    expect(seedBlock).toContain('isNewVault || !isOptInCategory(name)');
  });

  it('applies the same rule on both column-name spellings', () => {
    // The user_uuid/budget and user_id/category shapes are both live — one
    // seeding visible and the other hidden would make the outcome depend on
    // which schema the vault happens to have.
    const visibleWrites = seedBlock.match(/[Vv]isible: seedVisible\(sc\.name\)/g) || [];
    expect(visibleWrites.length).toBe(2);
    expect(seedBlock).not.toMatch(/[Vv]isible: true/);
  });

  it('keeps the same rule on the path taken when seeding did not come back', () => {
    // loadUserBudgets fills in any system category the rows do not mention.
    // Without the opt-in check there, the three would appear on an established
    // dashboard exactly when something had already gone wrong.
    const fallbackBlock = source.slice(
      source.indexOf('// Ensure all system categories are present'),
      source.indexOf('const orderedBudgets'),
    );
    expect(fallbackBlock).toContain('isOptInCategory(sysCat.name)');
    expect(fallbackBlock).toContain('hiddenCategoryIds.push(sysCat.id)');
  });
});

describe('the offline guess knows the three new kinds', () => {
  const TEN = SYSTEM_CATEGORIES.map((c) => ({ id: c.id, name: c.name }));

  function kindOf(text: string): string | null {
    return detectMerchantSignal(text)?.kind ?? null;
  }

  it.each([
    ['LOLA LASH BAR - CROWFO', 'personal'],
    ['N & K NAILS & SPA', 'personal'],
    ['CLASSIC ART BARBERSHOP', 'personal'],
    ['CLS AESTHETICS', 'personal'],
    ['SEPHORA 2201', 'personal'],
    ['DELTA AIRLINES 0062', 'travel'],
    ['EXPEDIA 7317', 'travel'],
    ['FAIRMONT BANFF SPRINGS', 'travel'],
    ['AIR CANADA 014', 'travel'],
    ['DOLLARAMA #1284', 'shopping'],
    ['WINNERS 0455', 'shopping'],
    ['HOMESENSE 028', 'shopping'],
    ['PARIS JEWELLERS', 'shopping'],
    ['BROWNS SHOES', 'shopping'],
    ['JD SPORTS CHINOOK CENT', 'shopping'],
  ])('reads %s as %s', (text, kind) => {
    expect(kindOf(text)).toBe(kind);
  });

  it('files each kind into the category of that name', () => {
    const cases: [string, string][] = [
      ['LOLA LASH BAR', 'Personal'],
      ['DELTA AIRLINES', 'Travel'],
      ['DOLLARAMA', 'Shopping'],
      ["WENDY'S CROWFOOT", 'Leisure'], // dining, via its Leisure fallback
    ];
    for (const [text, expected] of cases) {
      const signal = detectMerchantSignal(text);
      expect(signal, text).not.toBeNull();
      expect(resolveSignalCategory(signal!, TEN)?.name, text).toBe(expected);
    }
  });

  it('says nothing rather than guessing when the category is switched off', () => {
    // This is what makes deselecting mean something. With Shopping hidden, a
    // Dollarama capture must land in Other — NOT in Leisure, not in Groceries,
    // and above all not into the hidden category itself, where the dashboard
    // would never draw it.
    const withoutShopping = TEN.filter((c) => c.name !== 'Shopping');
    const signal = detectMerchantSignal('DOLLARAMA #1284');
    expect(signal!.kind).toBe('shopping');
    expect(resolveSignalCategory(signal!, withoutShopping)).toBeNull();
  });

  it('gives the three new kinds no fallback at all', () => {
    // Dining falls back to Leisure because a restaurant genuinely belongs
    // there. There is no equivalent home for a haircut or a flight, so the
    // honest answer is Other and a review tap.
    const stockSeven = SYSTEM_CATEGORIES
      .filter((c) => !isOptInCategory(c.name))
      .map((c) => ({ id: c.id, name: c.name }));
    for (const text of ['LOLA LASH BAR', 'DELTA AIRLINES', 'DOLLARAMA']) {
      const signal = detectMerchantSignal(text);
      expect(resolveSignalCategory(signal!, stockSeven), text).toBeNull();
    }
    // Dining, by contrast, still resolves in that same stock set.
    const dining = detectMerchantSignal("WENDY'S");
    expect(resolveSignalCategory(dining!, stockSeven)?.name).toBe('Leisure');
  });

  it('still lets dining win a word two kinds could claim', () => {
    // You ate at the airport; you did not fly at the cafe.
    expect(kindOf('AIRPORT CAFE')).toBe('dining');
    expect(kindOf('HOTEL RESTAURANT')).toBe('dining');
  });

  it('leaves the grocery and big-box suppression untouched', () => {
    // These sell all four kinds, which is why a learned rule is the honest
    // answer for them and every signal stays suppressed.
    for (const text of ['WALMART STORE 3151', 'COSTCO WHOLESALE', 'IKEA CALGARY', 'SHOPPERS DRUG MART']) {
      expect(detectMerchantSignal(text), text).toBeNull();
    }
  });

  it('does not fire on names that merely contain a shorter word', () => {
    expect(kindOf('BROWN BAGGING CO')).toBeNull();
    expect(kindOf('SPAM MUSEUM')).toBeNull();
  });

  it('is still only ever a suggestion', () => {
    // The whole safety argument: a signal sets a category but never the match
    // confidence, and auto-accept needs both.
    const source = readFileSync(resolve(__dirname, '../notificationProcessor.ts'), 'utf8');
    const block = source.slice(
      source.indexOf('const signal = detectMerchantSignal('),
      source.indexOf('if (!categoryId) {', source.indexOf('const signal = detectMerchantSignal(')),
    );
    expect(block).not.toContain('overrideMatchConfidence =');
  });

  it('hands the signal only the categories the user can see', () => {
    const source = readFileSync(resolve(__dirname, '../notificationProcessor.ts'), 'utf8');
    expect(source).toContain('input.hiddenCategoryIds');
    expect(source).toContain('resolveSignalCategory(signal, visibleCategories)');
  });

  it('is fed the hidden list by the listener that runs captures', () => {
    const source = readFileSync(resolve(__dirname, '../hooks/useNotificationListener.ts'), 'utf8');
    expect(source).toContain('hiddenCategoryIds: settingsRef.current?.hiddenCategories');
  });
});

describe('the collapsed row drops to one line past seven vials', () => {
  it('changes density exactly where the two-line row runs out of column', () => {
    expect(DENSE_ROW_THRESHOLD).toBe(8);
    expect(shouldUseDenseRows(7)).toBe(false);
    expect(shouldUseDenseRows(8)).toBe(true);
    expect(shouldUseDenseRows(10)).toBe(true);
  });

  it('is unbothered by a nonsense count', () => {
    expect(shouldUseDenseRows(0)).toBe(false);
    expect(shouldUseDenseRows(NaN as unknown as number)).toBe(false);
  });

  it('only ever applies while every card is collapsed', () => {
    const source = readFileSync(
      resolve(__dirname, '../../components/dashboard_components/DashboardBudgetSectionsList.tsx'),
      'utf8',
    );
    // An expanded card has the whole column to itself and must be drawn full
    // size, so the dense flag is gated on the same "all closed" condition the
    // compact styles already use.
    expect(source).toContain('shouldAutoFitClosedCards && shouldUseDenseRows(visibleBudgets.length)');
  });

  it('counts only the VISIBLE vials', () => {
    // Switching a category off has to give the others their second line back.
    const source = readFileSync(
      resolve(__dirname, '../../components/dashboard_components/DashboardBudgetSectionsList.tsx'),
      'utf8',
    );
    expect(source).toContain('shouldUseDenseRows(visibleBudgets.length)');
    expect(source).not.toContain('shouldUseDenseRows(budgets.length)');
  });

  it('drops the "left" line and nothing else', () => {
    const source = readFileSync(resolve(__dirname, '../../components/BudgetSection.tsx'), 'utf8');
    // The name and the limit stay; the middle line goes.
    expect(source).toContain('{!isExpanded && !isDense && (');
    // And an expanded card ignores density entirely.
    expect(source).toContain('const isDense = useDenseCollapsedStyles && !isExpanded;');
  });
});

describe('the migration that has to land first', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/2026_09_add_shopping_personal_travel_budgets.sql'),
    'utf8',
  );

  it('adds every opt-in category to the Budgets enum', () => {
    // These names are enum values, not free text. Without the migration a
    // Shopping row cannot be stored at all, and the category-frequency lookup
    // that filters on `budget=in.(...)` fails the whole query rather than
    // matching nothing — which is how a similar lookup once 400'd for months.
    for (const name of OPT_IN_CATEGORIES) {
      expect(sql).toContain(`ALTER TYPE public."Budgets" ADD VALUE IF NOT EXISTS '${name}'`);
    }
  });

  it('is re-runnable and removes nothing', () => {
    expect(sql).not.toMatch(/DROP|DELETE|TRUNCATE|ALTER\s+TABLE/i);
    const adds = sql.match(/ADD VALUE IF NOT EXISTS/g) || [];
    expect(adds.length).toBe(OPT_IN_CATEGORIES.size);
  });
});
