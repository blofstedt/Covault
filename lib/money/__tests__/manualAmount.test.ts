import { describe, expect, it } from 'vitest';
import { parseManualAmount, parsePastedManualAmount } from '../manualAmount';

describe('manual amounts', () => {
  it.each([
    ['12', 12], ['12.30', 12.3], ['0.01', 0.01], ['.50', 0.5], ['12.', 12],
    ['00012.34', 12.34], ['9999999999.99', 9999999999.99],
  ])('reads %s as %s dollars', (input, expected) => {
    expect(parseManualAmount(input)).toBe(expected);
  });

  it.each(['', '0', '0.00', '-12', '12abc', '1e3', '12.345', '0.001', 'NaN', 'Infinity', '1,234.50', '10000000000', '10000000000.00', '12345678901234.56', '90071992547409.92', '90071992547409.91', '90071992547409.90'])('rejects %s without accepting a numeric prefix or an amount storage cannot preserve', input => {
    expect(parseManualAmount(input)).toBeNull();
    expect(parseManualAmount('12.34')).toBe(12.34);
  });

  it.each([
    ['0.01', '{"amount":0.01}'],
    ['12.34', '{"amount":12.34}'],
    ['9999999999.98', '{"amount":9999999999.98}'],
    ['9999999999.99', '{"amount":9999999999.99}'],
  ])('preserves the cents in %s when serialized for saving', (input, expected) => {
    const amount = parseManualAmount(input);
    expect(JSON.stringify({ amount })).toBe(expected);
  });
});

describe('copied amounts', () => {
  it.each([
    ['$1,234.50', 1234.5], [' 12.30 ', 12.3], ['$ .50', 0.5], ['1000', 1000], ['$9,999,999,999.99', 9999999999.99],
  ])('reads %s as %s dollars', (input, expected) => {
    expect(parsePastedManualAmount(input)).toBe(expected);
  });

  it.each(['12abc', 'Paid $12.34', '1k', '1e3', '-12.34', '0', '12.345', '1,23.45', '12,34', '$', '1 000.00', '$10,000,000,000.00'])('rejects %s without changing its meaning', input => {
    expect(parsePastedManualAmount(input)).toBeNull();
    expect(parsePastedManualAmount('$12.34')).toBe(12.34);
  });
});
