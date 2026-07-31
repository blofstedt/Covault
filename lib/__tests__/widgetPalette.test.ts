import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUDGET_CATEGORY_COLORS } from '../budgetColors';

/**
 * The widget is a second implementation of a chart the app already draws.
 * That is forced: a home-screen widget is RemoteViews — no WebView, no
 * JavaScript — so d3 and BudgetFlowChart.tsx are unreachable from it and the
 * donut has to be drawn on an Android Canvas instead.
 *
 * What can be kept honest is the palette, and it's the drift that would be most
 * visible: add a category to the app, forget the widget, and its arc silently
 * renders in the fallback grey. This parses the table out of the Java and
 * asserts it matches, so that fails the build instead of shipping.
 */

const JAVA = resolve(__dirname, '../../android-custom/WidgetRenderer.java');

/** Pull the entries between the CATEGORY_COLORS_BEGIN/END markers. */
function parseJavaPalette(): Record<string, string> {
  const source = readFileSync(JAVA, 'utf8');
  const begin = source.indexOf('// CATEGORY_COLORS_BEGIN');
  const end = source.indexOf('// CATEGORY_COLORS_END');
  expect(begin, 'CATEGORY_COLORS_BEGIN marker missing from WidgetRenderer.java').toBeGreaterThan(-1);
  expect(end, 'CATEGORY_COLORS_END marker missing from WidgetRenderer.java').toBeGreaterThan(begin);

  const block = source.slice(begin, end);
  const out: Record<string, string> = {};
  const entry = /\{\s*"([^"]+)"\s*,\s*"(#[0-9a-fA-F]{6})"\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(block)) !== null) {
    out[match[1]] = match[2].toLowerCase();
  }
  return out;
}

describe('widget palette', () => {
  it('parses a non-empty table out of the Java', () => {
    // Guards the test itself: a regex that silently matches nothing would make
    // every assertion below vacuously pass.
    expect(Object.keys(parseJavaPalette()).length).toBeGreaterThan(0);
  });

  it('covers exactly the categories the app defines', () => {
    expect(Object.keys(parseJavaPalette()).sort())
      .toEqual(Object.keys(BUDGET_CATEGORY_COLORS).sort());
  });

  it('uses the same hex as the app for every category', () => {
    const java = parseJavaPalette();
    const app = Object.fromEntries(
      Object.entries(BUDGET_CATEGORY_COLORS).map(([k, v]) => [k, v.toLowerCase()]),
    );
    expect(java).toEqual(app);
  });
});
