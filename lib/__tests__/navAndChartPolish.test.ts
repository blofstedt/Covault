import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Two pieces of the visual language that have each been got wrong once, and
 * that nothing else in the build can notice: nothing here renders, so a filled
 * icon or a resurrected hover card would ship green.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const BOTTOM_BAR = read('components/dashboard_components/DashboardBottomBar.tsx');
const CHART = read('components/dashboard_components/BudgetFlowChart.tsx');

describe('the bottom bar', () => {
  it('marks the selected tab by highlighting it, never by filling it', () => {
    // Home was the only filled icon in the app. Beside an outlined inbox that
    // highlights instead, the two read as icons borrowed from two different
    // apps rather than one pair with one selected.
    expect(
      /fill=\{activeView/.test(BOTTOM_BAR),
      'Selection must not switch an icon to a solid fill.',
    ).toBe(false);
    expect(BOTTOM_BAR.match(/fill="none"/g) || []).toHaveLength(3);

    // Both tabs say "selected" the same way: accent colour, a heavier stroke
    // and the same nudge in size.
    expect(BOTTOM_BAR).toContain("strokeWidth={activeView === 'home' ? 2.5 : 2}");
    expect(BOTTOM_BAR).toContain("strokeWidth={activeView === 'parsing' ? 2.5 : 2}");
  });
});

describe('the spending chart', () => {
  it('has no scrub-and-read card, now that a month can just be tapped', () => {
    expect(/createPortal/.test(CHART), 'the hover card was portaled to body').toBe(false);
    expect(/hoveredMonthIdx|screenCoords|activeCategory/.test(CHART)).toBe(false);
  });

  it('lets a swipe that starts on it scroll the page', () => {
    // `touch-action: none` existed only so the scrub could own the gesture.
    // Left behind, it eats every vertical swipe begun over the chart — which
    // is most of them, given where the chart sits on the dashboard.
    expect(/touchAction/.test(CHART)).toBe(false);
    expect(/addEventListener\('touch/.test(CHART)).toBe(false);
  });
});
