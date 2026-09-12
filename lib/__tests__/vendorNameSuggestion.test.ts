/**
 * "Did you mean the one you already have?" for the rename field.
 *
 * Two directions matter and they pull against each other. Missing a near-miss
 * forks a merchant into two spellings, each with its own rule, each free to
 * drift to a different category — which is the thing this exists to stop.
 * Offering the wrong merchant asks the user to consider replacing one real
 * shop with another, which is worse than saying nothing, because the safe
 * answer to a prompt is the one that makes you look twice.
 *
 * Both directions are pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
  pickVendorNameSuggestion,
  boundedEditDistance,
  editBudgetFor,
} from '../vendorNameSuggestion';

const known = (...names: string[]) => names.map((properName) => ({ properName }));

describe('pickVendorNameSuggestion', () => {
  it('offers nothing when the typed name is new', () => {
    expect(
      pickVendorNameSuggestion(known('Safeway', 'Costco'), 'Kinton Ramen', 'TST-KINTON'),
    ).toBeNull();
  });

  it('says nothing when punctuation and case are the only difference', () => {
    // Not a gap: "WAL-MART" and "Walmart" are the same key, and the rename
    // field reuses the stored spelling outright rather than asking. A prompt
    // here would be putting two names on screen that are already one.
    expect(pickVendorNameSuggestion(known('Walmart'), 'WAL-MART', 'WM SUPERCENTER')).toBeNull();
  });

  it('offers the stored spelling when the bank has appended a branch', () => {
    expect(
      pickVendorNameSuggestion(known("Wendy's"), "Wendy's Crowfoot", 'TST-WENDYS 3401'),
    ).toBe("Wendy's");
  });

  // The tier fuzzyVendorMatch cannot reach: not a prefix, no token agreement,
  // just a slip of the thumb.
  it('offers the stored spelling for a typo', () => {
    expect(pickVendorNameSuggestion(known('Safeway'), 'Safewya', 'SAFEWAY #4021')).toBe(
      'Safeway',
    );
  });

  it('offers the stored spelling for a dropped letter in a long name', () => {
    expect(
      pickVendorNameSuggestion(known('Shoppers Drug Mart'), 'Shoppers Drug Mrt', 'SDM 2144'),
    ).toBe('Shoppers Drug Mart');
  });

  it('never offers the name being renamed away from', () => {
    // It matches almost anything typed over it, so offering it would ask
    // whether to keep the very name the user is trying to get rid of — and
    // accepting saves nothing, which looks exactly like the rename failing.
    expect(
      pickVendorNameSuggestion(known('TST-Pizza Culture'), 'Pizza Culture', 'TST-Pizza Culture'),
    ).toBeNull();
  });

  it('does not offer a different merchant that happens to be one letter away', () => {
    // Short names are the danger: at four characters almost everything has a
    // neighbour. "Ikea" must not be offered for "Idea".
    expect(pickVendorNameSuggestion(known('Ikea'), 'Idea', 'IDEA')).toBeNull();
  });

  it('does not offer a merchant that only shares a kind of business', () => {
    // The rule fuzzyVendorMatch enforces, still enforced here: "Bloom Cafe"
    // and "Hero Cafe" are two shops, not two spellings of one.
    expect(pickVendorNameSuggestion(known('Bloom Cafe'), 'Hero Cafe', 'HERO CAFE')).toBeNull();
  });

  it('requires the first character to survive the typo', () => {
    // Without that anchor a two-edit budget starts reaching names a person
    // would not recognise as the same word at all.
    expect(pickVendorNameSuggestion(known('Petsmart'), 'Getsmart', 'GETSMART')).toBeNull();
  });

  it('offers the closest of several candidates', () => {
    // A household with both taught should be asked about the one it actually
    // looks like, not whichever the list happened to hold first.
    expect(
      pickVendorNameSuggestion(known('Safeway Gas Bar', 'Safeway'), 'Safewya', 'SAFEWAY #4021'),
    ).toBe('Safeway');
  });

  it('says nothing about an empty or punctuation-only entry', () => {
    expect(pickVendorNameSuggestion(known('Safeway'), '   ', 'SAFEWAY')).toBeNull();
    expect(pickVendorNameSuggestion(known('Safeway'), '---', 'SAFEWAY')).toBeNull();
  });

  it('says nothing when the typed name is already exactly a stored one', () => {
    // That case is handled before this is reached — the stored spelling is
    // simply reused — so a prompt here would be asking about nothing.
    expect(pickVendorNameSuggestion(known('Safeway'), 'safeway', 'SAFEWAY #4021')).toBeNull();
  });
});

describe('editBudgetFor', () => {
  it('forgives nothing in a short name', () => {
    expect(editBudgetFor(4)).toBe(0);
  });

  it('forgives one slip in a middling name and two in a long one', () => {
    expect(editBudgetFor(8)).toBe(1);
    expect(editBudgetFor(9)).toBe(2);
  });
});

describe('boundedEditDistance', () => {
  it('counts two neighbours swapped as one mistake, not two', () => {
    // The commonest typo there is. Plain Levenshtein scores it 2, which at a
    // seven-letter name is over budget — so this was the one mistake people
    // actually make that the suggestion could not see.
    expect(boundedEditDistance('safeway', 'safewya', 2)).toBe(1);
  });

  it('counts a substitution, an insertion and a deletion alike', () => {
    expect(boundedEditDistance('safeway', 'safewey', 2)).toBe(1);
    expect(boundedEditDistance('safeway', 'safewayy', 2)).toBe(1);
    expect(boundedEditDistance('safeway', 'safewy', 2)).toBe(1);
  });

  it('gives up rather than counting past the budget', () => {
    // The exact number is not interesting once it is over; only that it is.
    expect(boundedEditDistance('safeway', 'costco', 2)).toBeGreaterThan(2);
  });

  it('is zero for the same string', () => {
    expect(boundedEditDistance('costco', 'costco', 2)).toBe(0);
  });
});
