import { describe, it, expect } from 'vitest';
import { pickRuleToAdopt } from '../InlineVendorEdit';

/**
 * The rename typeahead offers `Vendor · Category`, because that pairing is what
 * the user is choosing. Picking one only ever applied the name: a row the
 * pipeline had guessed as Other, renamed to "Pizza Culture · Leisure", stayed
 * in Other — and the rule the rename then taught paired the bank's spelling
 * with Other, contradicting the very rule whose name had just been picked. The
 * next purchase arrived correctly renamed and wrongly filed.
 */
const rules = [
  { properName: 'Pizza Culture', categoryId: 'budget:leisure', categoryName: 'Leisure' },
  { properName: 'Calgary Parking', categoryId: 'budget:transport', categoryName: 'Transport' },
  // One merchant, two categories — the groceries and the clothes.
  { properName: 'Walmart', categoryId: 'budget:groceries', categoryName: 'Groceries' },
  { properName: 'Walmart', categoryId: 'budget:other', categoryName: 'Other' },
];

describe('pickRuleToAdopt', () => {
  it('brings the category along when the name identifies one rule', () => {
    expect(pickRuleToAdopt(rules, 'Pizza Culture')?.categoryId).toBe('budget:leisure');
    expect(pickRuleToAdopt(rules, 'Calgary Parking')?.categoryId).toBe('budget:transport');
  });

  it('matches the name however it was capitalized or padded', () => {
    expect(pickRuleToAdopt(rules, '  pizza culture ')?.categoryId).toBe('budget:leisure');
  });

  it('adopts nothing for a name the user has never paired', () => {
    expect(pickRuleToAdopt(rules, 'Calgary Parkade')).toBeNull();
    expect(pickRuleToAdopt(rules, '')).toBeNull();
    expect(pickRuleToAdopt([], 'Pizza Culture')).toBeNull();
  });

  it('adopts nothing when the merchant holds two categories', () => {
    // The name alone cannot say which was meant, so the row keeps the category
    // it has and the user picks. Guessing here would file money on a coin toss.
    expect(pickRuleToAdopt(rules, 'Walmart')).toBeNull();
  });
});
