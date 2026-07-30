import { describe, it, expect } from 'vitest';
import { parseNotificationText, stripVendorNoise } from '../deviceTransactionParser';
import { normalizeVendorForDedup, fuzzyVendorMatch } from '../formatVendorName';

/**
 * One purchase is often announced twice — by the bank app and by Google Wallet —
 * in different wordings. Both landed in the review queue as separate rows, and
 * the noisier name ("Staples #462 Ca", the "Ca" being the front of "CA$") was as
 * likely to survive as the clean one.
 */
describe('cross-app duplicate reports', () => {
  const pairs: Array<[string, string, string]> = [
    [
      'STAPLES #462 You spent $1.85 with your credit card.',
      'STAPLES #462 CA$1.85 with Wealthsimple Cash',
      'Staples',
    ],
    [
      'TIM HORTONS #20024 You spent $16.57 with your credit card.',
      'TIM HORTONS #20024 CA$16.57 with Wealthsimple Cash',
      'Tim Hortons',
    ],
  ];

  it.each(pairs)('both wordings yield the same tidy name (%s)', (bankText, walletText, expected) => {
    const a = parseNotificationText(bankText);
    const b = parseNotificationText(walletText);
    expect(a.vendorDisplay).toBe(expected);
    expect(b.vendorDisplay).toBe(expected);
  });

  it.each(pairs)('and the same dedup key (%s)', (bankText, walletText) => {
    const a = normalizeVendorForDedup(parseNotificationText(bankText).vendorDisplay || '');
    const b = normalizeVendorForDedup(parseNotificationText(walletText).vendorDisplay || '');
    expect(a).toBe(b);
  });

  it('strips store numbers wherever they appear, not only at the end', () => {
    // The end-anchored version kept "#462" because "ca" followed it.
    expect(normalizeVendorForDedup('Staples #462 Ca')).toBe(normalizeVendorForDedup('Staples'));
    expect(normalizeVendorForDedup('Tim Hortons #20024 Ca')).toBe(normalizeVendorForDedup('Tim Hortons'));
  });

  it('still fuzzy-matches names that survive with noise', () => {
    // Belt and braces for the Step 4 hard skip.
    expect(fuzzyVendorMatch('Staples #462 Ca', 'Staples')).toBe(true);
  });
});

describe('stripVendorNoise', () => {
  it.each([
    ['Staples #462 Ca', 'Staples'],
    ['Tim Hortons #20024 Ca', 'Tim Hortons'],
    ['Homesense 028', 'Homesense'],
    ['Shoppers Drug Mart #23', 'Shoppers Drug Mart'],
  ])('%s -> %s', (input, expected) => {
    expect(stripVendorNoise(input)).toBe(expected);
  });

  it('leaves ordinary names untouched', () => {
    for (const name of ['Tim Hortons', 'Amazon.ca', 'A&W', "McDonald's", 'Petro Canada']) {
      expect(stripVendorNoise(name)).toBe(name);
    }
  });

  it('never reduces a name to nothing', () => {
    expect(stripVendorNoise('#462')).toBe('#462');
    expect(stripVendorNoise('028')).toBe('028');
  });
});
