import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  MONTH_WINDOW_LENGTH,
  balanceLabelForMonth,
  buildMonthWindow,
  longMonthLabel,
  monthRelation,
  remainingForMonth,
  shiftMonthKey,
  shortMonthName,
} from '../monthWindow';
import type { Transaction } from '../../types';

/**
 * Reading another month, and coming back from it.
 *
 * The chart shows seven months — three back, this one, three forward — and any
 * of them can be tapped, which puts the vials and the headline figure on that
 * month. That is one screen showing two possible truths, so the tests here are
 * mostly about the second one being unmistakable and never leaking:
 *
 *  - the axis is built from the calendar, so "three back" is a fixed place
 *    rather than "whichever months happen to hold transactions",
 *  - the figure at the top is renamed, because the number itself looks
 *    identical whether it is money you still have or a month that closed in
 *    March,
 *  - and the things that leave this screen — the home-screen widget, the
 *    over-budget notifications — stay on the month the user is actually in.
 *    A widget showing March because the phone was left on March is wrong in a
 *    way nobody can see from the dashboard.
 */

const ROOT = resolve(__dirname, '../..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const DASHBOARD = stripComments(readFileSync(join(ROOT, 'components/Dashboard.tsx'), 'utf8'));
const CHART = stripComments(
  readFileSync(join(ROOT, 'components/dashboard_components/BudgetFlowChart.tsx'), 'utf8'),
);
const SELECTION = stripComments(readFileSync(join(ROOT, 'lib/hooks/useMonthSelection.ts'), 'utf8'));

const tx = (date: string, amount: number): Transaction =>
  ({ id: date + amount, user_id: 'u', vendor: 'V', amount, date, budget_id: 'b', is_projected: false }) as Transaction;

describe('the seven months', () => {
  it('is three back, this one, and three forward', () => {
    expect(MONTH_WINDOW_LENGTH).toBe(7);
    const months = buildMonthWindow('2026-09');
    expect(months).toEqual([
      '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
    ]);
    expect(months[3]).toBe('2026-09');
  });

  it('crosses the new year rather than inventing a thirteenth month', () => {
    expect(buildMonthWindow('2026-12')).toEqual([
      '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
    ]);
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  });

  it('is the same seven months whatever the ledger holds', () => {
    // The point of building it from the calendar: a month with no spending is
    // an answer, and it keeps its place on the axis.
    expect(buildMonthWindow('2026-09')).toEqual(buildMonthWindow('2026-09'));
    expect(buildMonthWindow('2026-09')).toHaveLength(7);
  });

  it('leaves an unusable key alone rather than guessing a month', () => {
    expect(shiftMonthKey('', 1)).toBe('');
    expect(shortMonthName('nonsense')).toBe('');
    expect(longMonthLabel('2026-13')).toBe('');
  });

  it('names months the way the rail and the banner need them', () => {
    expect(shortMonthName('2026-09')).toBe('Sep');
    expect(longMonthLabel('2026-09')).toBe('September 2026');
  });
});

describe('where a month sits', () => {
  it('knows past from now from future', () => {
    expect(monthRelation('2026-08', '2026-09')).toBe('past');
    expect(monthRelation('2026-09', '2026-09')).toBe('current');
    expect(monthRelation('2026-10', '2026-09')).toBe('future');
  });
});

describe('what the headline figure is called', () => {
  it('is the remaining balance, in this month', () => {
    expect(balanceLabelForMonth('2026-09', '2026-09', true)).toBe('Our Remaining Balance');
    expect(balanceLabelForMonth('2026-09', '2026-09', false)).toBe('Remaining Balance');
  });

  it('names the month, and says which kind it is, in any other', () => {
    // Without this the same emerald number reads as "you have this much" for a
    // month that closed four months ago.
    expect(balanceLabelForMonth('2026-07', '2026-09', true)).toBe('July · Closing Balance');
    expect(balanceLabelForMonth('2026-11', '2026-09', false)).toBe('November · Projected Balance');
  });
});

describe('what is left of a month', () => {
  it('is the income less everything the vials are showing', () => {
    expect(remainingForMonth([tx('2026-07-02', 100), tx('2026-07-20', 250)], 3000)).toBe(2650);
  });

  it('counts a refund back, because the vials do', () => {
    expect(remainingForMonth([tx('2026-07-02', 100), tx('2026-07-05', -40)], 1000)).toBe(940);
  });
});

describe('the dashboard', () => {
  it('keeps the month it is in and the month it is showing apart', () => {
    expect(/const\s+monthKey\s*=\s*todayIso\.slice\(0,\s*7\)/.test(DASHBOARD)).toBe(true);
    expect(DASHBOARD).toContain('useMonthSelection(monthKey)');
  });

  it('draws the vials and the headline for the month being shown', () => {
    expect(DASHBOARD).toContain('transactions={viewMonthBudgetTransactions}');
    expect(DASHBOARD).toContain('remainingMoney={viewMonthRemaining}');
    expect(DASHBOARD).toContain('balanceLabel={balanceLabelForMonth(');
  });

  it('leaves the widget on the month the user is actually in', () => {
    const widgetEffect = DASHBOARD.slice(
      DASHBOARD.indexOf('const snapshot = buildWidgetSnapshot({'),
      DASHBOARD.indexOf('const rules: WidgetVendorRule[]'),
    );
    expect(widgetEffect.length).toBeGreaterThan(0);
    expect(
      widgetEffect.includes('currentMonthTransactions'),
      'The home screen is not where the user is browsing. A widget drawn from ' +
      'a month they wandered to would keep showing it after they put the phone ' +
      'down, with nothing on it to say which month it is.',
    ).toBe(true);
    expect(widgetEffect).not.toContain('viewMonth');
  });

  it('leaves the over-budget notifications on it too', () => {
    const notifications = DASHBOARD.slice(
      DASHBOARD.indexOf('checkAndTriggerAppNotifications({'),
      DASHBOARD.indexOf('const aiTransactionsCount'),
    );
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications).toContain('transactions: currentMonthBudgetTransactions');
    expect(notifications).not.toContain('viewMonth');
  });

  it('comes back to this month when the home button is pressed', () => {
    const goHome = DASHBOARD.slice(
      DASHBOARD.indexOf('const goHome'),
      DASHBOARD.indexOf('const scrollRef'),
    );
    expect(goHome).toContain('resetToCurrentMonth()');
  });

  it('says which month it is showing, above the vials rather than over them', () => {
    expect(DASHBOARD).toContain('<MonthViewBanner');
    expect(DASHBOARD).toContain('{!isViewingCurrentMonth && (');
  });

  it('hands the chart every projected occurrence, not only this month\'s', () => {
    const chartTransactions = DASHBOARD.slice(
      DASHBOARD.indexOf('const chartTransactions'),
      DASHBOARD.indexOf('const viewMonthBudgetTransactions'),
    );
    expect(chartTransactions.length).toBeGreaterThan(0);
    expect(
      /getLocalMonthKey\(t\.date\)\s*===\s*monthKey/.test(chartTransactions),
      'The rail runs three months forward. Filtering the projection down to ' +
      'this month leaves those three flat at zero even where the household ' +
      'already has subscriptions due.',
    ).toBe(false);
  });
});

describe('the chart', () => {
  it('builds its axis from the calendar, not from the months with data', () => {
    expect(CHART).toContain('buildMonthWindow(currentMonthKey)');
    expect(
      /getWindowedMonthKeys/.test(CHART),
      'The old windowing picked six months out of whichever ones held ' +
      'transactions, so the first purchase in a new month shifted every label.',
    ).toBe(false);
  });

  it('takes the month it is on from the dashboard rather than reading the clock', () => {
    expect(/currentMonthKey:\s*string/.test(CHART)).toBe(true);
    expect(/selectedMonthKey:\s*string/.test(CHART)).toBe(true);
    expect(
      /new Date\(\)\.getMonth\(\)/.test(CHART),
      'Two clocks on one screen is how the chart came to disagree with the ' +
      'vials underneath it.',
    ).toBe(false);
  });

  it('puts each month at the centre of its own slice, so the pill lines up', () => {
    expect(CHART).toContain('.padding(0.5)');
  });

  it('makes the months real buttons rather than text drawn into the SVG', () => {
    expect(CHART).toContain('onClick={() => onSelectMonth(key)}');
    expect(
      /\.text\(d\.month\.split\(' '\)\[0\]\)/.test(CHART),
      'SVG labels cannot be tapped, and d3 rebuilds them on every data change.',
    ).toBe(false);
  });

  it('marks where now is while the pill is somewhere else', () => {
    expect(CHART).toContain('isNow && !isSelected');
  });
});

describe('the selection itself', () => {
  it('is dropped when the user leaves the app, in either direction', () => {
    expect(SELECTION).toContain("CapApp.addListener('pause', resetToCurrentMonth)");
    expect(SELECTION).toContain("CapApp.addListener('resume', resetToCurrentMonth)");
    expect(SELECTION).toContain("document.addEventListener('visibilitychange'");
  });

  it('is dropped when the calendar rolls into a new month', () => {
    expect(/\[currentMonthKey,\s*resetToCurrentMonth\]/.test(SELECTION)).toBe(true);
  });

  it('is held as null-means-now, so a rollover cannot park it on last month', () => {
    expect(/useState<string \| null>\(null\)/.test(SELECTION)).toBe(true);
    expect(SELECTION).toContain('monthKey === currentMonthKey ? null : monthKey');
  });

  it('never survives as a key that is no longer on the rail', () => {
    expect(SELECTION).toContain('months.includes(selected) ? selected : currentMonthKey');
  });
});
