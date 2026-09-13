/**
 * The rules search finds the rule you are holding a bank alert about.
 *
 * The failures worth pinning are all "I know it is in there and it did not come
 * up": the tidy name and the bank's own spelling differing, an apostrophe, a
 * second word narrowing instead of widening, and the bank key arriving without
 * spaces because it never had any.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeForSearch,
  searchableText,
  searchTerms,
  matchesSearch,
  learnedRuleHaystack,
  skipRuleHaystack,
  filterBySearch,
} from '../ruleSearch';

const rule = (
  properName: string,
  categoryName: string,
  keys: string[] = [],
) => ({
  properName,
  categoryName,
  patterns: keys.map((match_key) => ({ match_key, proper_name: properName })),
});

describe('normalizeForSearch', () => {
  it('drops punctuation and case so one merchant is one string', () => {
    expect(normalizeForSearch("Wendy's")).toBe('wendy s');
    expect(normalizeForSearch('TST-PIZZA CULTURE')).toBe('tst pizza culture');
  });

  it('is empty for nothing at all', () => {
    expect(normalizeForSearch('   ')).toBe('');
    expect(normalizeForSearch('---')).toBe('');
  });
});

describe('searchTerms', () => {
  it('splits into terms that must all match', () => {
    expect(searchTerms('  coffee   Leisure ')).toEqual(['coffee', 'leisure']);
  });

  it('is empty for a blank query, which matches everything', () => {
    expect(searchTerms('')).toEqual([]);
    expect(matchesSearch('anything', searchTerms(''))).toBe(true);
  });
});

describe('searchableText', () => {
  it('holds the spaced form and the squeezed form together', () => {
    // Typed naturally you get the first; pasted off a bank alert, the second.
    const text = searchableText(['Wendy’s Crowfoot']);
    expect(text).toContain('wendy s crowfoot');
    expect(text).toContain('wendyscrowfoot');
  });
});

describe('learnedRuleHaystack', () => {
  const wendys = rule("Wendy's", 'Leisure', ['wendyscrowfoot', 'wendyscochrane']);

  const find = (query: string) => matchesSearch(learnedRuleHaystack(wendys), searchTerms(query));

  it('finds a rule by the name the app shows', () => {
    expect(find('wendys')).toBe(true);
  });

  it('finds it by the name typed with the apostrophe', () => {
    expect(find("Wendy's")).toBe(true);
  });

  it('finds it by the category it files into', () => {
    expect(find('leisure')).toBe(true);
  });

  it('finds it by the bank’s own spelling, which is the usual way in', () => {
    // The string in your hand when you go looking is the one off the alert.
    expect(find('wendyscrowfoot')).toBe(true);
    expect(find('crowfoot')).toBe(true);
  });

  it('narrows rather than widens as a second word is typed', () => {
    expect(find('wendys leisure')).toBe(true);
    expect(find('wendys groceries')).toBe(false);
  });

  it('does not match a merchant that is simply not there', () => {
    expect(find('costco')).toBe(false);
  });
});

describe('skipRuleHaystack', () => {
  it('finds a skip pattern by its text and by how it matches', () => {
    const skip = { pattern: 'BTC is trading at', pattern_type: 'contains' };
    const haystack = skipRuleHaystack(skip);
    expect(matchesSearch(haystack, searchTerms('btc'))).toBe(true);
    expect(matchesSearch(haystack, searchTerms('contains'))).toBe(true);
    expect(matchesSearch(haystack, searchTerms('groceries'))).toBe(false);
  });
});

describe('filterBySearch', () => {
  const rules = [
    rule('Costco', 'Groceries', ['costcowholesale']),
    rule('Costco Gas', 'Transport', ['costcogas']),
    rule('Safeway', 'Groceries', ['safeway4021']),
  ];
  const run = (query: string) =>
    filterBySearch(rules, searchTerms(query), learnedRuleHaystack).map((r) => r.properName);

  it('returns everything for an empty query', () => {
    expect(run('')).toEqual(['Costco', 'Costco Gas', 'Safeway']);
  });

  it('keeps both halves of a merchant that spans two categories', () => {
    // Costco's warehouse and its gas bar are a real, correct split — a search
    // for the chain has to show that rather than pick one.
    expect(run('costco')).toEqual(['Costco', 'Costco Gas']);
  });

  it('separates them again on the category', () => {
    expect(run('costco transport')).toEqual(['Costco Gas']);
  });

  it('leaves the order exactly as it was given', () => {
    // Alphabetical is what someone scanning a list of merchants expects, and
    // re-ranking on every keystroke moves the row out from under the thumb
    // reaching for it.
    expect(run('groceries')).toEqual(['Costco', 'Safeway']);
  });

  it('returns nothing when nothing matches, rather than everything', () => {
    expect(run('zzzz')).toEqual([]);
  });
});
