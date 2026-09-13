import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The widget's right-hand column has one vertical rhythm, and three files have
 * to agree on it.
 *
 * The month used to be a title in the card's top-left corner, with a row of
 * height reserved for it and the review pill parked at the far end of that row.
 * That cost the widget twice: the donut was centred in what was left UNDER the
 * title rather than in the card, so it sat low with a band of empty card above
 * it, and the column's own block was hung off its top edge with the category
 * rows centred in the remainder — a wide gap above the balance figure and
 * almost none below the last row.
 *
 * The month is now the label over the balance figure, the pill sits at the end
 * of that line, and the whole block is centred. Nothing in CI renders the
 * widget, so this reads the source.
 */

const RENDERER = resolve(__dirname, '../../android-custom/WidgetRenderer.java');
const PROVIDER = resolve(__dirname, '../../android-custom/CovaultWidgetProvider.java');
const LAYOUT = resolve(__dirname, '../../android-custom/res/layout/widget_covault.xml');

const renderer = readFileSync(RENDERER, 'utf8');
const provider = readFileSync(PROVIDER, 'utf8');
const layout = readFileSync(LAYOUT, 'utf8');

function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} should exist`).toBeGreaterThan(-1);
  const end = source.indexOf('\n    }', start);
  return source.slice(start, end);
}

describe('the widget column vertical rhythm', () => {
  it('reserves a header row only where there is no column to hold the month', () => {
    // A wide widget draws no title, so the ring centres on the card. Losing
    // this is how the donut ends up sitting low again, with empty card above
    // it and none below.
    expect(renderer).toMatch(/float availTop = wide \? pad : pad \+ headerSize/);
    expect(
      renderer,
      'the donut centres in whatever is left after the header row, so that row '
        + 'existing at all is what decides whether the ring is centred',
    ).toContain('float cy = availTop + (availH / 2f);');
  });

  it('decides the layout against the card, not against a row that may not exist', () => {
    // `wide` chooses whether there is a header at all, so it cannot be
    // measured against a height the header has already been taken out of.
    const render = renderer.slice(renderer.indexOf('static Bitmap render('));
    const wide = render.slice(render.indexOf('boolean wide ='));
    expect(wide.slice(0, wide.indexOf(';'))).toContain('fullH');
  });

  it('centres the column block rather than hanging it off the top', () => {
    const measure = body(renderer, 'private static Column measureColumn(');
    expect(measure).toContain('(height - blockH) / 2f');
    // The block is the month, the figure, its caption and the rows together —
    // centring only what is under the figure is the arrangement this replaced.
    expect(measure).toContain('float blockH = c.headH + (rows * c.rowH);');
  });

  it('puts the month above the balance figure, not beside the donut', () => {
    const measure = body(renderer, 'private static Column measureColumn(');
    // The figure starts exactly one month-label-and-gap below the block's top.
    expect(measure).toContain('c.balanceTop = c.blockTop + c.monthH;');
    expect(renderer).toContain('drawMonthLabel(canvas, column, month, monthRoom, legendLeft, dp, p);');
    const draw = body(renderer, 'private static void drawMonthLabel(');
    expect(draw).toContain('col.monthBaseline');
  });

  it('keeps the month on screen while a category is open on the widget', () => {
    // The label says WHICH month every figure on the card belongs to. The
    // legend and the recent-purchases list cross-fade; the month does not, or
    // an opened category shows a month's numbers with nothing naming the
    // month.
    const render = renderer.slice(renderer.indexOf('if (column != null) {'));
    const monthCall = render.indexOf('drawMonthLabel(');
    const legendCall = render.indexOf('if (monthText > 0f) {');
    expect(monthCall).toBeGreaterThan(-1);
    expect(
      monthCall < legendCall,
      'drawMonthLabel must sit outside the alpha-gated branches that fade the '
        + 'rest of the column',
    ).toBe(true);
  });

  it('swaps the recent list into the same box the categories occupy', () => {
    expect(renderer).toContain('column.contentTop, column.contentHeight, dp, p, focusedText);');
    const recent = body(renderer, 'private static void drawRecent(');
    expect(recent).toContain('(height - blockH) / 2f');
  });

  it('lays the review target over wherever the pill was actually drawn', () => {
    // The pill follows the month's line, which moves with how much the column
    // has to say, so a target pinned to a corner in the layout file would
    // cover empty card while the pill itself did nothing.
    expect(renderer).toMatch(/static RectF lastReviewHit\(\)/);
    expect(provider).toContain('WidgetRenderer.lastReviewHit()');
    expect(provider).toMatch(/private static void placeReviewHit\(/);

    const reviewHit = layout.slice(layout.indexOf('@+id/widget_review_hit'));
    const decl = reviewHit.slice(0, reviewHit.indexOf('/>'));
    expect(
      decl,
      'the review target is positioned at runtime like every other one, so it '
        + 'must not be pinned to the end of the card here',
    ).not.toContain('top|end');
  });

  it('measures the month first and lets the pill take what is left', () => {
    // The label naming the month is the one thing on the widget that must not
    // be abbreviated away; the pill already falls back to the bare number.
    const render = renderer.slice(renderer.indexOf('float monthRoom = legendWidth;'));
    const pill = render.slice(0, render.indexOf('float ringStroke'));
    expect(pill).toContain('legendWidth - column.monthWidth');
    expect(pill).toContain('pillLeft - legendLeft');
  });
});
