import { describe, expect, it } from 'vitest';

import {
  applyRecurringDeletePlan,
  planRecurringDelete,
  recurringSeriesKey,
} from '../recurringDelete';
import { generateProjectedTransactions } from '../projectedTransactions';
import type { Transaction } from '../../types';

const tx = (over: Partial<Transaction> & { id: string; date: string }): Transaction => ({
  user_id: 'user-1',
  vendor: 'Netflix',
  amount: 20,
  budget_id: 'budget:services',
  recurrence: 'Monthly',
  label: 'Manual',
  is_projected: false,
  created_at: '2026-01-01T12:00:00.000Z',
  ...over,
}) as Transaction;

describe('recurringSeriesKey', () => {
  it('is null for one-time entries', () => {
    expect(recurringSeriesKey(tx({ id: 'a', date: '2026-05-04', recurrence: 'One-time' }))).toBeNull();
  });

  it('keeps two monthly charges on different days apart', () => {
    const thirteenth = tx({ id: 'a', date: '2026-05-13', vendor: 'Fizz', amount: 26.2 });
    const sixteenth = tx({ id: 'b', date: '2026-05-16', vendor: 'Fizz', amount: 26.2 });
    expect(recurringSeriesKey(thirteenth)).not.toBe(recurringSeriesKey(sixteenth));
  });

  it('groups monthly occurrences of the same charge across months', () => {
    expect(recurringSeriesKey(tx({ id: 'a', date: '2026-05-13' })))
      .toBe(recurringSeriesKey(tx({ id: 'b', date: '2026-07-13' })));
  });

  it('groups biweekly occurrences even though the day of month moves', () => {
    const first = tx({ id: 'a', date: '2026-05-01', recurrence: 'Biweekly' });
    const second = tx({ id: 'b', date: '2026-05-15', recurrence: 'Biweekly' });
    const third = tx({ id: 'c', date: '2026-05-29', recurrence: 'Biweekly' });
    expect(recurringSeriesKey(second)).toBe(recurringSeriesKey(first));
    expect(recurringSeriesKey(third)).toBe(recurringSeriesKey(first));
  });
});

describe('planRecurringDelete', () => {
  it('deletes only the tapped row when it does not recur', () => {
    const one = tx({ id: 'a', date: '2026-05-04', recurrence: 'One-time' });
    const plan = planRecurringDelete('a', [one]);
    expect(plan).not.toBeNull();
    expect(plan!.isSeries).toBe(false);
    expect(plan!.remove.map(t => t.id)).toEqual(['a']);
    expect(plan!.endSeries).toEqual([]);
  });

  it('deletes the chosen occurrence and every later one, keeping the earlier ones', () => {
    const list = [
      tx({ id: 'may', date: '2026-05-13' }),
      tx({ id: 'jun', date: '2026-06-13' }),
      tx({ id: 'jul', date: '2026-07-13' }),
      tx({ id: 'aug', date: '2026-08-13' }),
    ];

    const plan = planRecurringDelete('jul', list)!;

    expect(plan.isSeries).toBe(true);
    expect(plan.remove.map(t => t.id).sort()).toEqual(['aug', 'jul']);
    expect(plan.endSeries.map(t => t.id).sort()).toEqual(['jun', 'may']);
  });

  it('ends the series when the user deletes a projected future occurrence', () => {
    const list = [
      tx({ id: 'may', date: '2026-05-13' }),
      tx({ id: 'jun', date: '2026-06-13' }),
    ];

    const plan = planRecurringDelete('projected-jun-2026-09-13', list)!;

    // Nothing saved exists on or after September, so nothing is deleted —
    // but both earlier rows stop recurring, which is what removes the
    // projection the user was actually looking at.
    expect(plan.remove).toEqual([]);
    expect(plan.endSeries.map(t => t.id).sort()).toEqual(['jun', 'may']);
  });

  it('leaves an unrelated series untouched', () => {
    const list = [
      tx({ id: 'netflix', date: '2026-05-13' }),
      tx({ id: 'spotify', date: '2026-05-13', vendor: 'Spotify', amount: 11 }),
    ];

    const plan = planRecurringDelete('netflix', list)!;

    expect(plan.remove.map(t => t.id)).toEqual(['netflix']);
    expect(plan.endSeries).toEqual([]);
  });

  it('picks up executor-spawned occurrences of the same charge', () => {
    const list = [
      tx({ id: 'template', date: '2026-05-13', source: 'manual' }),
      tx({ id: 'spawned-jun', date: '2026-06-13', source: 'executor' }),
      tx({ id: 'spawned-jul', date: '2026-07-13', source: 'executor' }),
    ];

    const plan = planRecurringDelete('spawned-jun', list)!;

    expect(plan.remove.map(t => t.id).sort()).toEqual(['spawned-jul', 'spawned-jun']);
    expect(plan.endSeries.map(t => t.id)).toEqual(['template']);
  });

  it('returns null when a projected id has no saved row behind it', () => {
    expect(planRecurringDelete('projected-missing-2026-09-13', [])).toBeNull();
  });

  it('stops the projections it was asked to stop', () => {
    const list = [
      tx({ id: 'may', date: '2026-05-13' }),
      tx({ id: 'jun', date: '2026-06-13' }),
    ];
    const today = '2026-06-20';

    const before = generateProjectedTransactions(list, today);
    expect(before.length).toBeGreaterThan(0);

    const plan = planRecurringDelete(before[0].id, list)!;
    const after = generateProjectedTransactions(applyRecurringDeletePlan(list, plan), today);

    expect(after).toEqual([]);
  });
});

describe('applyRecurringDeletePlan', () => {
  it('drops the deleted rows and flips the survivors to one-time', () => {
    const list = [
      tx({ id: 'may', date: '2026-05-13' }),
      tx({ id: 'jun', date: '2026-06-13' }),
      tx({ id: 'jul', date: '2026-07-13' }),
    ];

    const next = applyRecurringDeletePlan(list, planRecurringDelete('jun', list)!);

    expect(next.map(t => t.id)).toEqual(['may']);
    expect(next[0].recurrence).toBe('One-time');
  });
});
