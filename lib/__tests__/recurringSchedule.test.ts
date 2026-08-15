/**
 * The charge the app was already expecting.
 *
 * The case that motivated this: a Netflix charge announced by the bank on the
 * 15th, with the household's monthly Netflix due on the 16th. The only real
 * Netflix row was the previous month's — a month outside every window the
 * capture pipeline looks at — so the charge was captured a second time, put in
 * Review, and announced with a notification, for money already accounted for.
 */
import { describe, it, expect } from 'vitest';
import {
  collectRecurringCharges,
  findRecurringScheduleMatch,
  isRecurringRow,
  scheduleLandsNear,
} from '../recurringSchedule';

describe('isRecurringRow', () => {
  it('counts a monthly or biweekly row, in any casing', () => {
    expect(isRecurringRow({ recur: 'Monthly' })).toBe(true);
    expect(isRecurringRow({ recur: 'biweekly' })).toBe(true);
  });

  it('counts an executor-spawned row even without a recurrence', () => {
    expect(isRecurringRow({ source: 'executor' })).toBe(true);
  });

  it('does not count a one-off', () => {
    expect(isRecurringRow({ recur: 'One-time', source: 'manual' })).toBe(false);
    expect(isRecurringRow({})).toBe(false);
  });
});

describe('scheduleLandsNear', () => {
  it('matches the anchor itself, so a one-off row still compares by date', () => {
    expect(scheduleLandsNear('2026-08-14', 'One-time', '2026-08-15')).toBe(true);
    expect(scheduleLandsNear('2026-08-01', 'One-time', '2026-08-15')).toBe(false);
  });

  it('matches a monthly occurrence months after the template', () => {
    // The template is from April; the charge arrives in August, the day before
    // the due date. This is the case the pipeline could not see.
    expect(scheduleLandsNear('2026-04-16', 'Monthly', '2026-08-15')).toBe(true);
  });

  it('does not match a monthly template mid-cycle', () => {
    expect(scheduleLandsNear('2026-04-16', 'Monthly', '2026-08-01')).toBe(false);
    expect(scheduleLandsNear('2026-04-16', 'Monthly', '2026-08-25')).toBe(false);
  });

  it('matches a biweekly occurrence', () => {
    // 2026-05-01 + 14*7 days = 2026-08-07.
    expect(scheduleLandsNear('2026-05-01', 'Biweekly', '2026-08-08')).toBe(true);
    expect(scheduleLandsNear('2026-05-01', 'Biweekly', '2026-08-14')).toBe(false);
  });

  it('does not walk backwards from a future template', () => {
    // A template dated next year has no earlier occurrences to offer.
    expect(scheduleLandsNear('2027-08-16', 'Monthly', '2026-08-15')).toBe(false);
  });

  it('refuses unusable dates rather than guessing', () => {
    expect(scheduleLandsNear('', 'Monthly', '2026-08-15')).toBe(false);
    expect(scheduleLandsNear('2026-08-16', 'Monthly', 'not-a-date')).toBe(false);
  });
});

describe('findRecurringScheduleMatch', () => {
  const netflixTemplate = {
    id: 'netflix-july',
    vendor: 'Netflix*',
    amount: 20.33,
    date: '2026-07-16',
    recur: 'Monthly',
    source: 'manual',
  };

  it('recognises a charge whose recurring occurrence is still a day away', () => {
    const match = findRecurringScheduleMatch(
      { vendors: ['Netflix.com'], amount: 20.33, date: '2026-08-15' },
      [netflixTemplate],
    );
    expect(match?.id).toBe('netflix-july');
  });

  it('matches on any of the names the capture answers to', () => {
    const match = findRecurringScheduleMatch(
      { vendors: ['Youtubepremium', 'Google Youtubepremium'], amount: 24.14, date: '2026-08-15' },
      [{
        id: 'google-template',
        vendor: 'Google',
        amount: 24.14,
        date: '2026-06-16',
        recur: 'Monthly',
      }],
    );
    expect(match?.id).toBe('google-template');
  });

  it('leaves a different amount at the same merchant alone', () => {
    // Google bills this household several times a month. A $2.93 subscription
    // is not this $24.14 charge, however similar the names look.
    expect(
      findRecurringScheduleMatch(
        { vendors: ['Netflix.com'], amount: 9.99, date: '2026-08-15' },
        [netflixTemplate],
      ),
    ).toBeNull();
  });

  it('leaves a charge that is nowhere near the due date alone', () => {
    expect(
      findRecurringScheduleMatch(
        { vendors: ['Netflix.com'], amount: 20.33, date: '2026-08-01' },
        [netflixTemplate],
      ),
    ).toBeNull();
  });

  it('ignores a one-off row for the same charge', () => {
    // Two real purchases at one merchant. The user has said they would rather
    // see both than lose one, so only the recurring machinery can absorb a
    // capture.
    expect(
      findRecurringScheduleMatch(
        { vendors: ['Netflix.com'], amount: 20.33, date: '2026-07-17' },
        [{ ...netflixTemplate, recur: 'One-time' }],
      ),
    ).toBeNull();
  });

  it('does not treat a refund as the charge it reverses', () => {
    expect(
      findRecurringScheduleMatch(
        { vendors: ['Netflix.com'], amount: -20.33, date: '2026-08-15' },
        [netflixTemplate],
      ),
    ).toBeNull();
  });

  it('needs a vendor name to work with', () => {
    expect(
      findRecurringScheduleMatch(
        { vendors: [null, undefined, '  '], amount: 20.33, date: '2026-08-15' },
        [netflixTemplate],
      ),
    ).toBeNull();
  });
});

describe('collectRecurringCharges', () => {
  it('collapses a template and its spawned occurrences into one entry', () => {
    const charges = collectRecurringCharges([
      { vendor: 'Netflix', amount: 20.33, date: '2026-06-16', recur: 'Monthly' },
      { vendor: 'Netflix', amount: 20.33, date: '2026-07-16', recur: 'Monthly', source: 'executor' },
      { vendor: 'Netflix', amount: 20.33, date: '2026-08-16', recur: 'Monthly', source: 'executor' },
    ]);
    expect(charges).toEqual([{ vendor: 'Netflix', amount: 20.33 }]);
  });

  it('keeps two different amounts at the same merchant apart', () => {
    const charges = collectRecurringCharges([
      { vendor: 'Google', amount: 24.14, date: '2026-08-16', recur: 'Monthly' },
      { vendor: 'Google', amount: 2.93, date: '2026-08-04', recur: 'Monthly' },
    ]);
    expect(charges).toHaveLength(2);
  });

  it('drops one-offs, refunds and unnamed rows', () => {
    const charges = collectRecurringCharges([
      { vendor: 'Subway', amount: 12.5, date: '2026-08-14', recur: 'One-time' },
      { vendor: 'Netflix', amount: -20.33, date: '2026-08-16', recur: 'Monthly' },
      { vendor: '', amount: 20.33, date: '2026-08-16', recur: 'Monthly' },
    ]);
    expect(charges).toEqual([]);
  });
});
