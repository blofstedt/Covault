/**
 * The merchant's display name is its IDENTITY, not decoration.
 *
 * The capture pipeline keys learned rules off the name the app shows, so every
 * spelling variation becomes a separate merchant that has to be taught its
 * category separately. A household running on RBC alerts had 185 rules
 * covering 126 merchants, and among them "Second Cup.", "Shoppers Drug Mart .",
 * "Walmart Store ." and "Lola Lash Bar - Crowfo." — because RBC ends its
 * sentence with a full stop ("...was made from RBC credit card 9141 at SECOND
 * CUP.") and removing a store number from the middle left that stop stranded
 * as a word of its own.
 *
 * Every case below is a real notification from that household's own alerts.
 * The rejections matter as much as the tidying: these rules run on names that
 * are already clean, which is most of them.
 */
import { describe, it, expect } from 'vitest';
import { parseNotificationText, stripVendorNoise } from '../deviceTransactionParser';

const rbc = (merchant: string) =>
  `RBC Mobile A purchase of $12.08 CAD was made from RBC credit card 9141 at ${merchant}`;

function nameFor(merchant: string): string {
  const parsed: any = parseNotificationText(rbc(merchant));
  expect(parsed.isOutgoing, `expected a capture for "${merchant}"`).toBe(true);
  return parsed.vendorDisplay;
}

describe('the full stop that ends the bank sentence is not part of the name', () => {
  it.each([
    ['SECOND CUP.', 'Second Cup'],
    ['POTATO CORNER.', 'Potato Corner'],
    ['BBQ BOB.', 'Bbq Bob'],
    ['SHOPPERS DRUG MART #0356.', 'Shoppers Drug Mart'],
  ])('%s reads as %s', (merchant, expected) => {
    expect(nameFor(merchant)).toBe(expected);
  });

  it('drops a word left stranded when the store number was cut out', () => {
    // "Walmart Store ." — the stranded punctuation is the tell that something
    // was removed, and is the only reason it is safe to drop the word.
    expect(stripVendorNoise('Walmart Store .')).toBe('Walmart');
    expect(stripVendorNoise('Walmart Store #3151.')).toBe('Walmart');
  });

  it('leaves the word alone on a merchant that really ends in it', () => {
    expect(stripVendorNoise('Apple Store')).toBe('Apple Store');
    expect(stripVendorNoise('The Ups Store')).toBe('The Ups Store');
  });
});

describe('the locale suffix banks append is not part of the name', () => {
  it.each([
    ['Audible CA.', 'Audible'],
    ['AMZN Mktp CA.', 'Amzn Mktp'],
  ])('%s reads as %s', (merchant, expected) => {
    expect(nameFor(merchant)).toBe(expected);
  });

  it('refuses when that would leave a name ending in a single letter', () => {
    // Toys R Us, not Toys R. The old rule stripped this unconditionally.
    expect(stripVendorNoise('Toys R Us')).toBe('Toys R Us');
  });
});

describe('a branch after a dash is the same merchant', () => {
  it('reads Lola Lash Bar - Crowfo as Lola Lash Bar', () => {
    expect(nameFor('LOLA LASH BAR - CROWFO.')).toBe('Lola Lash Bar');
  });

  it('keeps a dash that belongs to a two-word name', () => {
    // Only a single trailing word is dropped, and only when two or more words
    // are left standing.
    expect(stripVendorNoise('Tim - Bob')).toBe('Tim - Bob');
  });
});

describe('names that are already clean are left exactly as they are', () => {
  it.each([
    'Second Cup',
    'Shoppers Drug Mart',
    'Apple Store',
    'The Ups Store',
    'Toys R Us',
    "Wendy's",
    'Canadian Tire',
    'Petro-Canada',
    'A&W',
    'Dollarama',
  ])('%s survives untouched', (name) => {
    expect(stripVendorNoise(name)).toBe(name);
  });

  it('never reduces a name to nothing', () => {
    expect(stripVendorNoise('#1234')).toBe('#1234');
    expect(stripVendorNoise('.')).toBe('.');
    expect(stripVendorNoise('')).toBe('');
  });

  it('settles rather than looping on repeated noise', () => {
    expect(stripVendorNoise('Staples #462 #12 Ca ... ')).toBe('Staples');
  });
});

describe('a rule taught against the untidy name keeps working', () => {
  // Cleaning the name changes what future captures key on, so the old
  // spelling has to stay reachable or every rule the household already
  // taught would silently stop matching.
  it('offers the untidy spelling as an alias', () => {
    const parsed: any = parseNotificationText(rbc('STAPLES #462 CA'));
    expect(parsed.vendorDisplay).toBe('Staples');
    expect(parsed.vendorAliases).toContain('Staples #462 Ca');
  });

  it('offers the pre-dash spelling too', () => {
    const parsed: any = parseNotificationText(rbc('LOLA LASH BAR - CROWFO.'));
    expect(parsed.vendorAliases).toContain('Lola Lash Bar - Crowfo');
  });

  it('adds no alias when there was nothing to tidy', () => {
    const parsed: any = parseNotificationText(rbc('DOLLARAMA'));
    expect(parsed.vendorDisplay).toBe('Dollarama');
    expect(parsed.vendorAliases).toEqual([]);
  });
});
