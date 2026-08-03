import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Guards the "the vials show this month, and only this month" rule.
 *
 * The dashboard derives four things from today's date: which transactions are
 * in the current month, which recurring occurrences have already happened,
 * which projected ones belong to this month, and what is left of the income.
 * When those came from separately-read clocks they could disagree — and a
 * disagreement is not visible as an error, it just puts last month's rows in
 * this month's list. That is what a Jul 31 entry sitting in an August vault
 * looked like.
 *
 * One `useCurrentDay()` feeds all of them, and it ticks over at local midnight
 * rather than waiting for the next resume.
 */

const ROOT = resolve(__dirname, '../..');

const dashboard = readFileSync(join(ROOT, 'components/Dashboard.tsx'), 'utf8');
const totals = readFileSync(
  join(ROOT, 'components/dashboard_components/useDashboardTotals.ts'),
  'utf8',
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('dashboard current-month scoping', () => {
  it('derives the month from useCurrentDay rather than reading the clock itself', () => {
    const code = stripComments(dashboard);

    expect(/useCurrentDay\(\)/.test(code)).toBe(true);
    expect(
      /const\s+monthKey\s*=\s*todayIso\.slice\(0,\s*7\)/.test(code),
      'The month key must be a slice of the same day the rest of the dashboard ' +
      'uses, so the two can never disagree.',
    ).toBe(true);
    expect(
      /new Date\(\)\.getMonth\(\)/.test(code),
      'Reading the month straight off the clock only advances when something ' +
      'else happens to re-render, which leaves last month on screen.',
    ).toBe(false);
  });

  it('filters the real and the projected half of the vial list against the same key', () => {
    const code = stripComments(dashboard);
    const block = code.slice(
      code.indexOf('const currentMonthBudgetTransactions'),
      code.indexOf('const chartTransactions'),
    );

    expect(block.length).toBeGreaterThan(0);

    const filters = block.match(/\.filter\(inCurrentMonth\)/g) || [];
    expect(
      filters.length,
      'Both currentMonthTransactions and projectedTransactions must go through ' +
      'the same isInMonth(monthKey) predicate. Filtering only one of them is ' +
      'how a previous-month row survives into this month\'s vial.',
    ).toBe(2);
    expect(/isInMonth\(t,\s*monthKey\)/.test(block)).toBe(true);
  });

  it('passes today through to the totals and the projections', () => {
    expect(/useDashboardTotals\([\s\S]*?todayIso,?\s*\)/.test(stripComments(dashboard))).toBe(true);

    const code = stripComments(totals);
    expect(/getLocalMonthKey\(todayIso\)/.test(code)).toBe(true);
    expect(
      /generateProjectedTransactions\(\s*transactions,\s*todayIso,?\s*\)/.test(code),
      'The projection has to be told what day it is, otherwise its memo keeps ' +
      'yesterday\'s answers about what has already happened.',
    ).toBe(true);
    expect(
      /\[transactions,\s*todayIso\]/.test(code),
      'and the memo has to be keyed on the day for that to have any effect.',
    ).toBe(true);
  });
});
