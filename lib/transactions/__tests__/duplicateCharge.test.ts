import { describe, it, expect } from 'vitest';
import { findSameCharge, isSameCharge } from '../duplicateCharge';

/**
 * The case this exists for, from a real screenshot: "Google · Aug 3 · $2.93"
 * sitting directly above "Google One · Aug 3 · $2.93". One came from a monthly
 * recurring rule, the other from the bank's notification, and because the two
 * writers disagreed about what the merchant is called, neither recognised the
 * other's row.
 *
 * The capture pipeline had always matched vendors fuzzily. The recurring
 * executor keyed on the exact lowercased string and the exact day, so it only
 * ever recognised its own handiwork.
 */

const google = { vendor: 'Google', amount: 2.93, date: '2026-08-03' };

describe('isSameCharge', () => {
  it('matches a bank name against a shorter human one', () => {
    expect(isSameCharge(google, { vendor: 'Google One', amount: 2.93, date: '2026-08-03' })).toBe(true);
    expect(isSameCharge(google, { vendor: 'GOOGLE *GOOGLE ONE', amount: 2.93, date: '2026-08-03' })).toBe(true);
  });

  it('tolerates a few days of drift', () => {
    // A subscription's billing date moves, and a recurring rule's due date is
    // a guess at when the charge will land.
    expect(isSameCharge(google, { vendor: 'Google One', amount: 2.93, date: '2026-08-05' })).toBe(true);
    expect(isSameCharge(google, { vendor: 'Google One', amount: 2.93, date: '2026-07-31' })).toBe(true);
  });

  it('stops tolerating beyond the window', () => {
    expect(isSameCharge(google, { vendor: 'Google One', amount: 2.93, date: '2026-08-09' })).toBe(false);
  });

  it('will not merge two different merchants', () => {
    expect(isSameCharge(google, { vendor: 'Netflix', amount: 2.93, date: '2026-08-03' })).toBe(false);
  });

  it('will not merge two different amounts', () => {
    // Same merchant, same day, genuinely two purchases.
    expect(isSameCharge(google, { vendor: 'Google One', amount: 24.14, date: '2026-08-03' })).toBe(false);
  });

  it('treats a cent of float drift as equal', () => {
    expect(isSameCharge(google, { vendor: 'Google', amount: 2.9300000000000002, date: '2026-08-03' })).toBe(true);
  });

  it('never pairs a charge with its refund', () => {
    expect(isSameCharge(google, { vendor: 'Google One', amount: -2.93, date: '2026-08-03' })).toBe(false);
  });

  it('is safe on missing or malformed fields', () => {
    expect(isSameCharge(google, { vendor: 'Google', amount: null, date: '2026-08-03' })).toBe(false);
    expect(isSameCharge(google, { vendor: null, amount: 2.93, date: '2026-08-03' })).toBe(false);
    expect(isSameCharge(google, { vendor: 'Google', amount: 2.93, date: 'not a date' })).toBe(false);
    expect(isSameCharge(google, { vendor: 'Google', amount: 2.93, date: null })).toBe(false);
  });

  it('does not bend across a daylight-saving boundary', () => {
    // Dates are compared in UTC, so a clock change cannot make two days apart
    // read as three.
    const march = { vendor: 'Google', amount: 2.93, date: '2026-03-07' };
    expect(isSameCharge(march, { vendor: 'Google One', amount: 2.93, date: '2026-03-10' })).toBe(true);
    expect(isSameCharge(march, { vendor: 'Google One', amount: 2.93, date: '2026-03-11' })).toBe(false);
  });
});

describe('findSameCharge', () => {
  const books = [
    { vendor: 'Netflix', amount: 18.99, date: '2026-08-01' },
    { vendor: 'Google One', amount: 2.93, date: '2026-08-03' },
    { vendor: 'Spotify', amount: 11.99, date: '2026-08-04' },
  ];

  it('finds the row a recurring rule would otherwise duplicate', () => {
    expect(findSameCharge(google, books)?.vendor).toBe('Google One');
  });

  it('returns null when the charge really is new', () => {
    expect(findSameCharge({ vendor: 'Disney Plus', amount: 9.99, date: '2026-08-03' }, books)).toBeNull();
  });

  it('is safe on an empty book', () => {
    expect(findSameCharge(google, [])).toBeNull();
  });
});
