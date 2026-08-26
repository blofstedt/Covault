import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { splitCurrency } from '../formatCurrency';

/**
 * The widget printed the remaining balance with its cents and the app rounded
 * it away, so the home screen and the dashboard showed two different numbers
 * for the same figure.
 *
 * Both now print the cents, always. The two halves of that are in different
 * languages and neither can see the other, so this file holds them together:
 * the split the dashboard renders is exercised directly, and the native
 * formatter is read out of the Java and behaviourally compared against it.
 *
 * What cannot be tested here is how it looks. Nothing in CI renders the
 * dashboard or draws the widget.
 */

const RENDERER_JAVA = readFileSync(
  resolve(__dirname, '../../android-custom/WidgetRenderer.java'),
  'utf-8',
);
const BALANCE_TSX = readFileSync(
  resolve(__dirname, '../../components/dashboard_components/DashboardBalanceSection.tsx'),
  'utf-8',
);

/** The app's balance, as one string, the way the widget prints it. */
function appBalance(n: number): string {
  const { sign, dollars, cents } = splitCurrency(n);
  return `${sign}$${dollars}.${cents}`;
}

/**
 * A JS stand-in for the Java `%,.2f`, used to check the two agree on the same
 * figures. The Java source itself is asserted separately below, so this cannot
 * quietly drift into testing only itself.
 */
function widgetBalance(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const FIGURES = [0, 0.05, 7.5, 342.17, 999.99, 1000, 6432.48, 7100, 12345.6, 0.004];

describe('the balance the dashboard prints', () => {
  it('keeps the cents on a round figure', () => {
    expect(appBalance(7100)).toBe('$7,100.00');
  });

  it('groups the thousands', () => {
    expect(appBalance(6432.48)).toBe('$6,432.48');
  });

  it('rounds once, to the cent, before splitting', () => {
    // The failure this prevents: rounding the halves separately, which prints
    // "6,432" beside ".100" for a figure a thousandth under the next dollar.
    const { dollars, cents } = splitCurrency(6432.999);
    expect(dollars).toBe('6,433');
    expect(cents).toBe('00');
  });

  it('does not put a minus in front of nothing', () => {
    // A balance a fraction of a cent under zero rounds to $0.00, and "-$0.00"
    // reads as being over budget when nothing is.
    expect(appBalance(-0.004)).toBe('$0.00');
    expect(splitCurrency(-0.004).sign).toBe('');
  });

  it('still marks a genuinely negative balance', () => {
    expect(splitCurrency(-12.5).sign).toBe('-');
    expect(appBalance(-12.5)).toBe('-$12.50');
  });
});

describe('the two sides agree', () => {
  it.each(FIGURES)('prints %s the same in the app and the widget', (n) => {
    expect(appBalance(n)).toBe(widgetBalance(n));
  });

  it('formats the widget balance with cents, whatever its size', () => {
    // money() drops the cents past $1000 to keep a category row short. The
    // balance must not inherit that, which is the whole of this fix.
    const begin = RENDERER_JAVA.indexOf('// BALANCE_MONEY_BEGIN');
    const end = RENDERER_JAVA.indexOf('// BALANCE_MONEY_END');
    expect(begin, 'BALANCE_MONEY_BEGIN marker missing').toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);

    const block = RENDERER_JAVA.slice(begin, end);
    expect(block).toContain('%s$%,.2f');
    expect(block).not.toContain('>= 1000');
    expect(block).not.toContain('%,.0f');
  });

  it('draws the widget balance through that formatter, not money()', () => {
    // Both places the widget prints it: the footnote under the donut on a
    // narrow widget, and the column heading on a wide one.
    const drawn = RENDERER_JAVA.match(/balanceMoney\(/g) ?? [];
    expect(drawn.length).toBeGreaterThanOrEqual(4); // the definition plus three call sites
    expect(RENDERER_JAVA).not.toMatch(/money\(-?remaining\)/);
  });
});

describe('the dashboard renders both halves', () => {
  it('uses the shared split rather than rounding', () => {
    expect(BALANCE_TSX).toContain('splitCurrency');
    expect(BALANCE_TSX).toContain('{balance.dollars}');
    expect(BALANCE_TSX).toContain('.{balance.cents}');
    // The rounding that caused this.
    expect(BALANCE_TSX).not.toContain('Math.round(animatedRemaining)');
  });

  it('counts every change the cents can show', () => {
    // The old 50c floor skipped the tween for changes that moved nothing while
    // only dollars showed. With cents on screen that same change is visible, so
    // the hook's own one-cent default has to be what applies.
    expect(BALANCE_TSX).toContain('useAnimatedNumber(remainingMoney)');
    expect(BALANCE_TSX).not.toContain('minDelta: 0.5');
  });
});
