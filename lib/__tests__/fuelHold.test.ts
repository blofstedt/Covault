import { describe, it, expect } from 'vitest';
import {
  isFuelMerchant,
  isHoldAmount,
  placeholderForHold,
  pastFillAmounts,
  detectFuelHold,
  detectFuelHoldPlaceholder,
  withFuelHoldMarker,
  readFuelHoldMarker,
  stripFuelHoldMarker,
  FUEL_HOLD_PLACEHOLDER,
} from '../fuelHold';
import { findSettlementCandidate } from '../fuelHoldReconcile';
import type { Transaction } from '../../types';

const tx = (over: Partial<Transaction> & { id: string }): Transaction =>
  ({
    user_id: 'u1',
    vendor: 'Petro-Canada',
    amount: 60,
    date: '2026-08-01',
    budget_id: 'b1',
    is_projected: false,
    ...over,
  }) as Transaction;

describe('isFuelMerchant', () => {
  it('recognises station brands from the vendor name', () => {
    for (const vendor of [
      'PETRO-CANADA #1234',
      'Esso Circle K',
      'SHELL 4471',
      'Chevron',
      'Husky Calgary',
      'Murphy USA',
      'Flying J',
    ]) {
      expect(isFuelMerchant(vendor), vendor).toBe(true);
    }
  });

  it('recognises forecourt words when the brand is unknown', () => {
    expect(isFuelMerchant('Riverbend Gas Bar')).toBe(true);
    expect(isFuelMerchant('Northside Fuels Ltd')).toBe(true);
    expect(isFuelMerchant('Highway 2 Cardlock')).toBe(true);
  });

  it('only counts a warehouse club or grocer when a fuel word is present', () => {
    expect(isFuelMerchant('COSTCO WHOLESALE #543')).toBe(false);
    expect(isFuelMerchant('COSTCO GAS #543')).toBe(true);
    expect(isFuelMerchant('Safeway')).toBe(false);
    expect(isFuelMerchant('Safeway Fuel Station')).toBe(true);
  });

  it('leaves ordinary merchants alone', () => {
    for (const vendor of [
      'Amazon.ca',
      'Tim Hortons',
      'Holiday Inn Express',
      'Gulf Coast Dental',
      'Pioneer Athletics',
      'Netflix',
    ]) {
      expect(isFuelMerchant(vendor), vendor).toBe(false);
    }
  });
});

describe('isHoldAmount', () => {
  it('treats round quarter figures from $50 up as holds', () => {
    for (const amount of [50, 75, 100, 125, 150, 175, 200, 250]) {
      expect(isHoldAmount(amount), `$${amount}`).toBe(true);
    }
  });

  it('treats the pay-at-pump token authorisation as a hold', () => {
    expect(isHoldAmount(1)).toBe(true);
    expect(isHoldAmount(0.01)).toBe(true);
  });

  it('leaves a real fill alone', () => {
    for (const amount of [71.43, 42.9, 150.01, 149.99, 62, 30, 40]) {
      expect(isHoldAmount(amount), `$${amount}`).toBe(false);
    }
  });
});

describe('placeholderForHold', () => {
  it('falls back to $100 without enough history', () => {
    expect(placeholderForHold(150).amount).toBe(FUEL_HOLD_PLACEHOLDER);
    expect(placeholderForHold(150, [70, 80]).basis).toBe('default');
  });

  it("uses the user's median fill once there are enough of them", () => {
    const result = placeholderForHold(150, [64.2, 71.43, 68.5, 90.1]);
    expect(result.basis).toBe('median-fill');
    expect(result.amount).toBeCloseTo(69.97, 2);
  });

  it('never exceeds the hold, because the hold caps the pump', () => {
    expect(placeholderForHold(50).amount).toBe(50);
    expect(placeholderForHold(50, [90, 95, 100]).amount).toBe(50);
  });

  it('does not cap a token authorisation, which says nothing about size', () => {
    expect(placeholderForHold(1).amount).toBe(FUEL_HOLD_PLACEHOLDER);
  });
});

describe('pastFillAmounts', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('collects settled fills at the same station', () => {
    const rows = [
      tx({ id: '1', amount: 71.43, date: '2026-07-01' }),
      tx({ id: '2', amount: 64.2, date: '2026-06-15' }),
      tx({ id: '3', amount: 55, date: '2026-06-01', vendor: 'Netflix' }),
    ];
    expect(pastFillAmounts('Petro-Canada', rows, now)).toEqual([71.43, 64.2]);
  });

  it('ignores past holds and unresolved placeholders, which would skew the median', () => {
    const rows = [
      tx({ id: '1', amount: 150, date: '2026-07-01' }),
      tx({
        id: '2',
        amount: 100,
        date: '2026-07-10',
        raw_notification: withFuelHoldMarker('A $150.00 purchase at PETRO-CANADA', {
          holdAmount: 150,
          placeholderAmount: 100,
          basis: 'default',
        }),
      }),
      tx({ id: '3', amount: 71.43, date: '2026-07-20' }),
    ];
    expect(pastFillAmounts('Petro-Canada', rows, now)).toEqual([71.43]);
  });
});

describe('detectFuelHold', () => {
  it('flags a round charge at a station', () => {
    const hold = detectFuelHold({
      vendor: 'Petro-Canada',
      rawText: 'BMO: A $150.00 purchase was approved at PETRO-CANADA #4471',
      amount: 150,
    });
    expect(hold).toEqual({ holdAmount: 150, placeholderAmount: 100, basis: 'default' });
  });

  it('sizes the placeholder from history when it has some', () => {
    const hold = detectFuelHold({
      vendor: 'Petro-Canada',
      rawText: 'A $150.00 purchase was approved at PETRO-CANADA',
      amount: 150,
      priorFills: [70, 72, 68],
    });
    expect(hold?.placeholderAmount).toBe(70);
    expect(hold?.basis).toBe('median-fill');
  });

  it('ignores a real fill at a station', () => {
    expect(
      detectFuelHold({ vendor: 'Esso', rawText: 'A $71.43 purchase at ESSO', amount: 71.43 }),
    ).toBeNull();
  });

  it('ignores a round charge somewhere that is not a station', () => {
    expect(
      detectFuelHold({ vendor: 'Best Buy', rawText: 'A $150.00 purchase at BEST BUY', amount: 150 }),
    ).toBeNull();
  });
});

describe('the placeholder marker', () => {
  const hold = { holdAmount: 150, placeholderAmount: 68.5, basis: 'median-fill' as const };

  it('round-trips', () => {
    const marked = withFuelHoldMarker('A $150.00 purchase at PETRO-CANADA', hold);
    expect(readFuelHoldMarker(marked)).toEqual({ holdAmount: 150, placeholderAmount: 68.5 });
  });

  it('is hidden from the text the user reads', () => {
    const original = 'A $150.00 purchase at PETRO-CANADA';
    expect(stripFuelHoldMarker(withFuelHoldMarker(original, hold))).toBe(original);
  });

  it('does not accumulate when applied twice', () => {
    const once = withFuelHoldMarker('text', hold);
    expect(withFuelHoldMarker(once, hold)).toBe(once);
  });
});

describe('detectFuelHoldPlaceholder', () => {
  const marked = withFuelHoldMarker('BMO: A $150.00 purchase at PETRO-CANADA #4471', {
    holdAmount: 150,
    placeholderAmount: 68.5,
    basis: 'median-fill',
  });

  it('recognises a marked placeholder row', () => {
    const hold = detectFuelHoldPlaceholder({
      vendor: 'Petro-Canada',
      amount: 68.5,
      raw_notification: marked,
    });
    expect(hold?.holdAmount).toBe(150);
  });

  it('stops recognising the row once the real amount is entered', () => {
    expect(
      detectFuelHoldPlaceholder({ vendor: 'Petro-Canada', amount: 71.43, raw_notification: marked }),
    ).toBeNull();
  });

  it('still recognises legacy rows captured before markers existed', () => {
    const hold = detectFuelHoldPlaceholder({
      vendor: 'Petro-Canada',
      amount: 100,
      raw_notification: 'BMO: A $150.00 purchase was approved at PETRO-CANADA #4471',
    });
    expect(hold?.holdAmount).toBe(150);
  });

  it('does not flag a genuine charge that happens to be $100', () => {
    expect(
      detectFuelHoldPlaceholder({
        vendor: 'Petro-Canada',
        amount: 100,
        raw_notification: 'BMO: A $62.18 purchase was approved at PETRO-CANADA',
      }),
    ).toBeNull();
  });
});

describe('findSettlementCandidate', () => {
  const placeholder = tx({
    id: 'hold-1',
    amount: 100,
    date: '2026-08-01',
    raw_notification: 'BMO: A $150.00 purchase was approved at PETRO-CANADA #4471',
  });

  it('pairs a later settled charge with the hold it replaces', () => {
    const charge = tx({ id: 'settle-1', amount: 71.43, date: '2026-08-03' });
    const found = findSettlementCandidate(charge, [placeholder, charge]);
    expect(found?.placeholder.id).toBe('hold-1');
    expect(found?.holdAmount).toBe(150);
    expect(found?.daysApart).toBe(2);
  });

  it('will not pair a charge larger than the authorisation', () => {
    const charge = tx({ id: 'settle-2', amount: 162.1, date: '2026-08-03' });
    expect(findSettlementCandidate(charge, [placeholder, charge])).toBeNull();
  });

  it('will not pair one hold with another', () => {
    const anotherHold = tx({ id: 'settle-3', amount: 150, date: '2026-08-03' });
    expect(findSettlementCandidate(anotherHold, [placeholder, anotherHold])).toBeNull();
  });

  it('will not reach back further than a week', () => {
    const charge = tx({ id: 'settle-4', amount: 71.43, date: '2026-08-20' });
    expect(findSettlementCandidate(charge, [placeholder, charge])).toBeNull();
  });

  it('ignores a different station', () => {
    const charge = tx({ id: 'settle-5', amount: 71.43, date: '2026-08-03', vendor: 'Shell' });
    expect(findSettlementCandidate(charge, [placeholder, charge])).toBeNull();
  });

  it('picks the nearest hold when more than one qualifies', () => {
    const older = tx({
      id: 'hold-0',
      amount: 100,
      date: '2026-07-30',
      raw_notification: 'A $150.00 purchase at PETRO-CANADA',
    });
    const charge = tx({ id: 'settle-6', amount: 71.43, date: '2026-08-03' });
    const found = findSettlementCandidate(charge, [older, placeholder, charge]);
    expect(found?.placeholder.id).toBe('hold-1');
  });
});
