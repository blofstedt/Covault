import { describe, it, expect } from 'vitest';
import { pickNearMatchName } from '../InlineVendorEdit';
import type { ExistingRule } from '../CategoryPickerSheet';

/**
 * Renaming a captured row offers the stored spelling when the typed name is
 * close to a rule the user already taught, so one merchant doesn't fork into
 * two spellings.
 *
 * The trap this pins down: the rule carrying the row's CURRENT name matches
 * nearly anything typed over it, so the prompt used to offer the name being
 * renamed away from — and taking that offer saved nothing, which is
 * indistinguishable from the rename not working.
 */

const rule = (properName: string, categoryName = 'Leisure'): ExistingRule => ({
  properName,
  categoryId: categoryName.toLowerCase(),
  categoryName,
});

describe('pickNearMatchName', () => {
  it('does not offer the name being renamed away from', () => {
    const rules = [rule('Tst-pizza Culture')];
    expect(pickNearMatchName(rules, 'Pizza Culture', 'Tst-pizza Culture')).toBeNull();
  });

  it('ignores the current name regardless of case or padding', () => {
    const rules = [rule('TST-PIZZA CULTURE')];
    expect(pickNearMatchName(rules, 'Pizza Culture', '  tst-pizza culture ')).toBeNull();
  });

  it('still offers a different merchant the user has already named', () => {
    const rules = [rule('Tst-pizza Culture'), rule('Little Caesars')];
    expect(pickNearMatchName(rules, 'Little Caesar', 'Tst-pizza Culture')).toBe('Little Caesars');
  });

  it('offers the tidy spelling when renaming a bank string that has one', () => {
    const rules = [rule('Pizza Culture')];
    expect(pickNearMatchName(rules, 'Pizza Cultur', 'TST*PIZZA CULTURE 4451')).toBe('Pizza Culture');
  });

  it('says nothing when no rule resembles the typed name', () => {
    const rules = [rule('Shell', 'Transport'), rule('Netflix', 'Services')];
    expect(pickNearMatchName(rules, 'Pizza Culture', 'Tst-pizza Culture')).toBeNull();
  });

  it('says nothing when there are no rules at all', () => {
    expect(pickNearMatchName([], 'Pizza Culture', 'Tst-pizza Culture')).toBeNull();
  });
});
