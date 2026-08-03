import { describe, it, expect } from 'vitest';
import {
  compareByDateOccurred,
  findTodayIndex,
  isInMonth,
  transactionDay,
} from '../transactionOrdering';
import type { Transaction } from '../../types';

function tx(partial: Partial<Transaction> & { id: string }): Transaction {
  return {
    vendor: 'Vendor',
    amount: 10,
    date: '2026-08-01',
    budget_id: 'b1',
    recurrence: 'One-time',
    label: 'Manual',
    ...partial,
  } as Transaction;
}

describe('compareByDateOccurred', () => {
  it('orders a vial by the date each entry happened, not by the order it arrived', () => {
    // Exactly what the August "Services" vial showed: a real transaction from
    // the DB (newest-first) followed by projected occurrences appended after
    // it in generation order.
    const list = [
      tx({ id: 'cloud', vendor: 'Cloud', date: '2026-08-31' }),
      tx({ id: 'ha', vendor: 'Home Assistant', date: '2026-08-29' }),
      tx({ id: 'prime', vendor: 'Amazon Prime', date: '2026-08-27' }),
      tx({ id: 'fizz', vendor: 'Fizz', date: '2026-08-15' }),
    ];

    const sorted = [...list].sort(compareByDateOccurred).map(t => t.vendor);

    expect(sorted).toEqual(['Fizz', 'Amazon Prime', 'Home Assistant', 'Cloud']);
  });

  it('puts future (projected) entries after everything that has already happened', () => {
    const list = [
      tx({ id: 'future', date: '2026-08-27', is_projected: true }),
      tx({ id: 'past', date: '2026-08-02' }),
      tx({ id: 'today', date: '2026-08-03' }),
    ];

    expect([...list].sort(compareByDateOccurred).map(t => t.id))
      .toEqual(['past', 'today', 'future']);
  });

  it('breaks ties within a day by when the entry was recorded', () => {
    const list = [
      tx({ id: 'second', date: '2026-08-03', created_at: '2026-08-03T18:00:00.000Z' }),
      tx({ id: 'first', date: '2026-08-03', created_at: '2026-08-03T09:00:00.000Z' }),
    ];

    expect([...list].sort(compareByDateOccurred).map(t => t.id))
      .toEqual(['first', 'second']);
  });

  it('is stable when two entries share a day and have no timestamps', () => {
    const list = [tx({ id: 'b', date: '2026-08-03' }), tx({ id: 'a', date: '2026-08-03' })];

    // Same answer whichever order they come in, so the list cannot shuffle
    // between renders.
    expect([...list].sort(compareByDateOccurred).map(t => t.id)).toEqual(['a', 'b']);
    expect([...list].reverse().sort(compareByDateOccurred).map(t => t.id)).toEqual(['a', 'b']);
  });

  it('tolerates a timestamped date string', () => {
    // fromSupabaseTransaction appends T12:00:00.000Z to plain dates.
    expect(transactionDay(tx({ id: 'x', date: '2026-08-01T12:00:00.000Z' }))).toBe('2026-08-01');
  });
});

describe('isInMonth', () => {
  it('keeps the last day of the previous month out of this month', () => {
    // The reported bug: Jul 31 entries still sitting in the August vials.
    expect(isInMonth(tx({ id: 'jul31', date: '2026-07-31' }), '2026-08')).toBe(false);
    expect(isInMonth(tx({ id: 'aug1', date: '2026-08-01' }), '2026-08')).toBe(true);
    expect(isInMonth(tx({ id: 'aug31', date: '2026-08-31' }), '2026-08')).toBe(true);
    expect(isInMonth(tx({ id: 'sep1', date: '2026-09-01' }), '2026-08')).toBe(false);
  });

  it('reads the date in the local calendar, not UTC', () => {
    // A plain YYYY-MM-DD carries no zone; parsing it as UTC would slide it a
    // day backwards for users west of Greenwich and drop Aug 1 into July.
    expect(isInMonth(tx({ id: 'boundary', date: '2026-08-01T12:00:00.000Z' }), '2026-08')).toBe(true);
  });

  it('drops entries with no usable date', () => {
    expect(isInMonth(tx({ id: 'none', date: '' as any }), '2026-08')).toBe(false);
    expect(isInMonth(tx({ id: 'nullish', date: undefined as any }), '2026-08')).toBe(false);
  });
});

describe('findTodayIndex', () => {
  const sorted = [
    tx({ id: 'aug1', date: '2026-08-01' }),
    tx({ id: 'aug2', date: '2026-08-02' }),
    tx({ id: 'aug3', date: '2026-08-03' }),
    tx({ id: 'aug15', date: '2026-08-15' }),
  ];

  it('finds today itself', () => {
    expect(findTodayIndex(sorted, '2026-08-03')).toBe(2);
  });

  it('finds the next entry when nothing is dated today', () => {
    expect(findTodayIndex(sorted, '2026-08-04')).toBe(3);
  });

  it('returns the first entry when today is before all of them', () => {
    expect(findTodayIndex(sorted, '2026-07-30')).toBe(0);
  });

  it('reports -1 when every entry is in the past, so the caller can go to the end', () => {
    expect(findTodayIndex(sorted, '2026-08-20')).toBe(-1);
  });
});
