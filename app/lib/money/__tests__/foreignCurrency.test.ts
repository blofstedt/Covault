/**
 * A price in another currency is noticed, and an ordinary one is left alone.
 *
 * Both halves matter equally. Missing a euro means a €9.90 pastry lands on the
 * dashboard as $9.90 with nobody told; a false positive puts a warning badge
 * on an ordinary Canadian purchase, and a badge that appears on ordinary rows
 * is a badge nobody reads by the third time they see it.
 */
import { describe, it, expect } from 'vitest';
import { detectForeignCurrency } from '../foreignCurrency';

describe('detectForeignCurrency', () => {
  it('sees a symbol against the number, either side of it', () => {
    expect(detectForeignCurrency('You spent €9.90 at BOULANGERIE')).toBe('€');
    expect(detectForeignCurrency('Purchase of 9,90 € at BOULANGERIE')).toBe('€');
    expect(detectForeignCurrency('£24.00 at PRET A MANGER')).toBe('£');
    expect(detectForeignCurrency('¥1200 at LAWSON')).toBe('¥');
  });

  it('sees a three-letter code against the number', () => {
    expect(detectForeignCurrency('You spent EUR 9.90 at BOULANGERIE')).toBe('EUR');
    expect(detectForeignCurrency('Purchase 24.00 GBP at PRET')).toBe('GBP');
    expect(detectForeignCurrency('you spent eur 9.90')).toBe('EUR');
  });

  it('leaves ordinary dollar purchases alone', () => {
    expect(detectForeignCurrency('You spent $12.34 at Walmart')).toBeNull();
    expect(detectForeignCurrency('CAD 12.34 at Walmart')).toBeNull();
    expect(detectForeignCurrency('You spent $12.34 at Walmart. Available balance $923.12')).toBeNull();
  });

  it('does not flag a US-bank alert, which cannot be told from a Canadian one', () => {
    // Deliberate: a dollar sign cannot say whose dollars it is, and a badge on
    // every US alert would be a badge on almost every row for those users.
    expect(detectForeignCurrency('You spent USD 12.00 at TARGET')).toBeNull();
    expect(detectForeignCurrency('$12.00 at TARGET')).toBeNull();
  });

  it('needs a number beside it, so a merchant name is not a price', () => {
    expect(detectForeignCurrency('You spent $84.10 at EURO CAR PARTS')).toBeNull();
    expect(detectForeignCurrency('Your euro account statement is ready')).toBeNull();
    expect(detectForeignCurrency('You spent $30.00 at KRW MOTORS')).toBeNull();
  });

  it('says nothing about empty or missing text', () => {
    expect(detectForeignCurrency('')).toBeNull();
    expect(detectForeignCurrency(null)).toBeNull();
    expect(detectForeignCurrency(undefined)).toBeNull();
  });
});
