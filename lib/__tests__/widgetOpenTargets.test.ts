import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Three of the widget's tap targets stand for no category at all: the month's
 * total in the middle of the ring, the "+N more" row that holds whatever did
 * not fit in the legend, and the "left to spend" figure at the top of the
 * right-hand column. All three open the app.
 *
 * The renderer says so by recording the target with an empty category name,
 * and the provider decides what to launch by checking for exactly that. The
 * two files are the only places that know it, nothing in the type system holds
 * them together, and getting it wrong is silent: the provider would hand the
 * empty name to the "open this budget" intent and the app would open on a
 * budget that does not exist.
 *
 * Nothing in CI runs the widget, so this reads the source.
 */

const RENDERER = resolve(__dirname, '../../android-custom/WidgetRenderer.java');
const PROVIDER = resolve(__dirname, '../../android-custom/CovaultWidgetProvider.java');

describe('the widget targets that open the app', () => {
  const renderer = readFileSync(RENDERER, 'utf8');
  const provider = readFileSync(PROVIDER, 'utf8');

  it('records the three targets that belong to no category without a name', () => {
    // new HitRect("", ...) — the marker itself.
    const anonymous = renderer.match(/new HitRect\(\s*""\s*,/g) ?? [];
    expect(
      anonymous.length,
      'WidgetRenderer should record exactly three nameless hit targets: the '
        + "month's total in the ring, the legend's \"+N more\" row, and the "
        + '"left to spend" figure above the legend',
    ).toBe(3);
  });

  it('gives the remaining balance a target of its own', () => {
    // The figure the widget exists to answer. It is painted into the bitmap
    // like everything else, so it is only tappable if the renderer records
    // where it landed and the provider lays a view over it.
    expect(
      renderer,
      'WidgetRenderer should record where the "left to spend" figure was drawn',
    ).toMatch(/static HitRect lastRemainingHit\(\)/);
    expect(
      provider,
      'the provider should read that geometry and place a target on it',
    ).toMatch(/WidgetRenderer\.lastRemainingHit\(\)/);
    // And it must open the app rather than a budget: the balance is the whole
    // month, not one category.
    const place = provider.slice(provider.indexOf('private static void placeRemainingHit('));
    const body = place.slice(0, place.indexOf('\n    }'));
    expect(body).toContain('openIntent(context)');
    expect(body).not.toContain('budgetIntent(');
  });

  it('hides the remaining target on a frame that is still moving', () => {
    // Every other target is hidden mid-morph because the figures underneath
    // them are travelling. One left visible would sit over whatever the next
    // frame draws there.
    const hide = provider.slice(provider.indexOf('private static void hideAllHits('));
    expect(hide.slice(0, hide.indexOf('\n    }'))).toContain('R.id.widget_remaining_hit');
  });

  it('never files a nameless target under a budget', () => {
    // Both call sites branch before reaching budgetIntent.
    expect(
      provider,
      'the legend row that stands for the categories which did not fit has no '
        + 'budget to open, so the provider must check for the empty name first',
    ).toMatch(/hit\.category\.isEmpty\(\)/);
    expect(
      provider,
      'the middle of the ring opens the app when nothing is focused and closes '
        + 'the category when something is',
    ).toMatch(/centre\.category\.isEmpty\(\)/);
  });

  it('has an intent that opens the app on nothing in particular', () => {
    expect(provider).toMatch(/private static PendingIntent openIntent\(Context context\)/);
    // A request code of its own, or it silently reuses the review intent and
    // lands on Review instead of the dashboard. Codes only have to be unique
    // among intents of the same kind, so broadcasts are counted separately.
    const activityCodes = [...provider.matchAll(/PendingIntent\.getActivity\(context,\s*([^,]+),/g)]
      .map(m => m[1].trim())
      .filter(code => /^\d+$/.test(code));
    expect(
      new Set(activityCodes).size,
      `two launch intents share a request code (${activityCodes.join(', ')}), `
        + 'so the second quietly reuses the first and opens the wrong place',
    ).toBe(activityCodes.length);
  });
});
