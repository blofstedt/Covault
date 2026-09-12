/**
 * "Is this the same merchant?" — asked on the capture path in four places at
 * once: the same-day duplicate skip, the soft-duplicate warning, the phone's
 * local vendor memory, and the recurring-charge lookup.
 *
 * It used to answer yes whenever the two names shared any word of four letters
 * or more, anywhere. That word is almost always the one saying what KIND of
 * business it is — cafe, ramen, pizza — or the city it is in, which is the one
 * word that cannot say WHICH business it is. So "Bloom Cafe" and "Hero Cafe"
 * were one merchant, and so were "Calgary Co-op" and "Calgary Public Library".
 *
 * The rejections below are the point of the file. The acceptances exist so
 * that tightening it does not quietly break the cases it is actually for.
 */
import { describe, it, expect } from 'vitest';
import { fuzzyVendorMatch } from '../formatVendorName';

describe('fuzzyVendorMatch — two businesses of the same kind are not one business', () => {
  it.each([
    ['Bloom Cafe', 'Hero Cafe'],
    ['Rosso Coffee', 'Monogram Coffee'],
    ['Kinton Ramen', 'Ramen Danbo'],
    ["Joe's Pizza", 'Pizza Hut'],
    ['Village Ice Cream', 'Made By Marcus Ice Cream'],
    ['Anejo Restaurant', 'Cilantro Restaurant'],
    ['Model Milk Kitchen', 'Ten Foot Henry Kitchen'],
  ])('%s is not %s', (a, b) => {
    expect(fuzzyVendorMatch(a, b)).toBe(false);
    expect(fuzzyVendorMatch(b, a)).toBe(false);
  });

  it('does not join two merchants by the city they are in', () => {
    // The one that gives the game away: nothing about these is the same
    // business, and a shared first word is not enough on its own.
    expect(fuzzyVendorMatch('Calgary Co-op', 'Calgary Public Library')).toBe(false);
  });

  it('does not let a short name swallow a longer unrelated one', () => {
    expect(fuzzyVendorMatch('Pho', 'Phoenix Store')).toBe(false);
    expect(fuzzyVendorMatch('Bar', 'Barburrito')).toBe(false);
  });

  it('still says no to merchants with nothing in common', () => {
    expect(fuzzyVendorMatch('Walmart', 'Costco')).toBe(false);
    expect(fuzzyVendorMatch('Tim Hortons', 'Starbucks')).toBe(false);
    expect(fuzzyVendorMatch('Safeway', 'Sobeys')).toBe(false);
  });
});

describe('fuzzyVendorMatch — the same merchant spelled differently is still one merchant', () => {
  it.each([
    ['Staples #462 Ca', 'Staples'],
    ['Walmart', 'WALMART #3106'],
    ['Shoppers Drug Mart #23', 'Shoppers Drug Mart'],
    ['Shoppers Drug Mart', 'Shoppers Drugmart'],
    ['PUB MOBILE', 'Public Mobile'],
    ['KFC', 'KFC Calgary'],
    ["Wendy's", "Wendy's Crowfoot"],
    ['Amazon', 'AMAZON.CA'],
    ['Fizz (Tx. Incl.)', 'Fizz'],
  ])('%s is %s', (a, b) => {
    expect(fuzzyVendorMatch(a, b)).toBe(true);
    expect(fuzzyVendorMatch(b, a)).toBe(true);
  });

  it('sees through a payment processor prefix the parser left on', () => {
    expect(fuzzyVendorMatch('SQ *Bloom Cafe', 'Bloom Cafe')).toBe(true);
  });

  it('reads the abbreviations banks actually send', () => {
    // Banks squeeze the vowels out. This is the one kind of "different words"
    // that really is the same merchant, and the old rule caught it only by
    // accident — via the shared word "Prime".
    expect(fuzzyVendorMatch('AMZN Prime', 'Amazon Prime')).toBe(true);
    expect(fuzzyVendorMatch('Sprt Chek', 'Sport Chek')).toBe(true);
    expect(fuzzyVendorMatch('Mtrs West', 'Motors West')).toBe(true);
  });

  it('does not pretend to read every abbreviation', () => {
    // Squeezing vowels only reaches an abbreviation that KEPT every
    // consonant. "MKTP" dropped one of Marketplace's, "CDN" one of
    // Canadian's, "MGMT" three of Management's, so none is reachable this way
    // — those are handled upstream, by the merchant's list of known
    // alternative names. This must not be "fixed" by loosening the rule until
    // they match: unbounded loosening is exactly how the old matcher ended up
    // treating every cafe as the same cafe.
    expect(fuzzyVendorMatch('AMZN Mktp', 'Amazon Marketplace')).toBe(false);
    expect(fuzzyVendorMatch('Cdn Tire', 'Canadian Tire')).toBe(false);
    expect(fuzzyVendorMatch('Mgmt Co', 'Management Co')).toBe(false);
  });

  it('does not treat two short words as abbreviations of each other', () => {
    // "bar" and "bear" both reduce to "br", which is why the squeeze needs
    // three consonants before it counts for anything.
    expect(fuzzyVendorMatch('Bar Roma', 'Bear Roma')).toBe(false);
  });

  it('matches what a user has typed so far, for the rename typeahead', () => {
    expect(fuzzyVendorMatch('Staples', 'stap')).toBe(true);
    expect(fuzzyVendorMatch("Wendy's", 'wend')).toBe(true);
  });
});

describe('fuzzyVendorMatch — edges', () => {
  it('is false rather than throwing on empty input', () => {
    expect(fuzzyVendorMatch('', 'Staples')).toBe(false);
    expect(fuzzyVendorMatch('Staples', '')).toBe(false);
    expect(fuzzyVendorMatch('!!!', 'Staples')).toBe(false);
  });

  it('still compares a merchant whose whole name is numbers', () => {
    // Stripping store numbers must not leave nothing to compare.
    expect(fuzzyVendorMatch('7 11', '7 11')).toBe(true);
    expect(fuzzyVendorMatch('7 11', '5 55')).toBe(false);
  });

  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['Bloom Cafe', 'Hero Cafe'],
      ['Staples #462 Ca', 'Staples'],
      ['Calgary Co-op', 'Calgary Public Library'],
    ];
    for (const [a, b] of pairs) {
      expect(fuzzyVendorMatch(a, b)).toBe(fuzzyVendorMatch(b, a));
    }
  });
});
