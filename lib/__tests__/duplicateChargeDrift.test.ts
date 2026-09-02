import { describe, expect, it } from 'vitest';
import { generateProjectedTransactions } from '../projectedTransactions';
import { findRecurringScheduleMatch } from '../recurringSchedule';
import { amountsAgree, isSameCharge } from '../duplicateCharge';
import type { Transaction } from '../../types';

/**
 * The screenshot this file exists for: one monthly insurance premium on the
 * dashboard twice, $477.45 on Aug 30 and $477.46 on Aug 31. Every duplicate
 * check in the app demanded the amount to the exact cent, so a rounding cent
 * between the bank's two reports of one charge was enough to make it two.
 */
const PREMIUM = 477.45;
const PREMIUM_A_CENT_MORE = 477.46;

function makeTransaction(overrides: Partial<Transaction> & { recur?: string } = {}): Transaction {
  return {
    id: 'tx-1',
    user_id: 'user-1',
    vendor: 'Intact Insurance',
    amount: PREMIUM,
    date: '2026-07-30',
    budget_id: 'transport-id',
    recurrence: 'Monthly',
    label: 'Automatic',
    userName: 'me',
    is_projected: false,
    created_at: '2026-07-30T00:00:00.000Z',
    ...overrides,
  } as Transaction;
}

describe('amountsAgree', () => {
  it('accepts a rounding cent on a large charge', () => {
    expect(amountsAgree(PREMIUM, PREMIUM_A_CENT_MORE)).toBe(true);
  });

  it('accepts float noise', () => {
    expect(amountsAgree(2.93, 2.9300000000000002)).toBe(true);
  });

  it('still refuses two genuinely different amounts', () => {
    expect(amountsAgree(9.99, 53.4)).toBe(false);
    expect(amountsAgree(4.5, 9.0)).toBe(false);
    // A premium and one 5% larger are not the same charge.
    expect(amountsAgree(PREMIUM, 501.32)).toBe(false);
  });

  it('never matches a charge with its refund', () => {
    expect(amountsAgree(PREMIUM, -PREMIUM)).toBe(false);
  });
});

describe('a charge reported a cent apart', () => {
  it('is one charge, not two', () => {
    expect(
      isSameCharge(
        { vendor: 'Intact Insurance', amount: PREMIUM, date: '2026-08-30' },
        { vendor: 'INTACT INSURANCE', amount: PREMIUM_A_CENT_MORE, date: '2026-08-31' },
      ),
    ).toBe(true);
  });

  it('is recognised as the recurring charge already on the books, so it is not captured again', () => {
    const onTheBooks = [
      {
        id: 'intact-aug',
        vendor: 'Intact Insurance',
        amount: PREMIUM,
        date: '2026-08-30',
        recur: 'Monthly',
      },
    ];

    const match = findRecurringScheduleMatch(
      { vendors: ['Intact Insurance'], amount: PREMIUM_A_CENT_MORE, date: '2026-08-31' },
      onTheBooks,
    );

    expect(match?.id).toBe('intact-aug');
  });
});

describe('a projected occurrence the real charge did not land exactly on', () => {
  it('is cancelled by a real charge a day and a cent away', () => {
    const projected = generateProjectedTransactions(
      [
        makeTransaction({ id: 'intact-jul', date: '2026-07-30' }),
        makeTransaction({
          id: 'intact-aug',
          date: '2026-08-31',
          amount: PREMIUM_A_CENT_MORE,
          recurrence: 'One-time' as Transaction['recurrence'],
        }),
      ],
      '2026-08-31',
    );

    expect(projected.map((tx) => tx.date)).not.toContain('2026-08-30');
  });

  it('is cancelled when the bank worded the merchant differently', () => {
    const projected = generateProjectedTransactions(
      [
        makeTransaction({ id: 'intact-jul', date: '2026-07-30' }),
        makeTransaction({
          id: 'intact-aug',
          vendor: 'INTACT INSURANCE CO',
          date: '2026-08-30',
          recurrence: 'One-time' as Transaction['recurrence'],
        }),
      ],
      '2026-08-31',
    );

    expect(projected.map((tx) => tx.date)).not.toContain('2026-08-30');
  });

  it('still stands when the real charge is for a different amount entirely', () => {
    // A Prime subscription and an Amazon order the same week are two charges.
    const projected = generateProjectedTransactions(
      [
        makeTransaction({ id: 'prime-jul', vendor: 'Amazon', amount: 9.99, date: '2026-07-15' }),
        makeTransaction({
          id: 'order-aug',
          vendor: 'Amazon',
          amount: 53.4,
          date: '2026-08-16',
          recurrence: 'One-time' as Transaction['recurrence'],
        }),
      ],
      '2026-08-20',
    );

    expect(projected.map((tx) => tx.date)).toContain('2026-08-15');
  });

  it('lets one real charge cancel only one occurrence', () => {
    // The household's two Fizz charges a month, three days apart. The 13th
    // has been captured; the 16th has not, and must still be expected.
    const projected = generateProjectedTransactions(
      [
        makeTransaction({ id: 'fizz-13-jul', vendor: 'Fizz', amount: 26.2, date: '2026-07-13' }),
        makeTransaction({ id: 'fizz-16-jul', vendor: 'Fizz', amount: 26.2, date: '2026-07-16' }),
        makeTransaction({
          id: 'fizz-13-aug',
          vendor: 'Fizz',
          amount: 26.2,
          date: '2026-08-13',
          recurrence: 'One-time' as Transaction['recurrence'],
        }),
      ],
      '2026-08-14',
    );

    const august = projected.filter((tx) => tx.date.startsWith('2026-08')).map((tx) => tx.date);
    expect(august).toEqual(['2026-08-16']);
  });
});
