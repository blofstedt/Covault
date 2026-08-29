import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The widget's layout is inflated by the launcher, in the launcher's process,
 * and Android will only inflate the handful of view classes the framework
 * marks as remotable. Everything else throws.
 *
 * There is no build error for getting this wrong, no lint in this project that
 * would catch it, and no test that runs the app. What the user gets is the
 * whole widget replaced by "Can't load widget" — which is what happened when a
 * plain `<View>` was added as a tap target, `View` being the one obvious
 * choice that is not on the list.
 *
 * The list is from android.widget.RemoteViews' own documentation.
 */

const REMOTABLE = new Set([
  // Layouts
  'FrameLayout', 'LinearLayout', 'RelativeLayout', 'GridLayout',
  // Widgets
  'AnalogClock', 'Button', 'Chronometer', 'ImageButton', 'ImageView',
  'ProgressBar', 'TextView', 'ViewFlipper', 'ListView', 'GridView',
  'StackView', 'AdapterViewFlipper', 'ViewStub',
  // Since API 31
  'CheckBox', 'RadioButton', 'RadioGroup', 'Switch',
]);

const LAYOUT = resolve(__dirname, '../../android-custom/res/layout/widget_covault.xml');

describe('the widget layout', () => {
  const source = readFileSync(LAYOUT, 'utf8');

  // Element names only: opening tags, ignoring comments and attributes.
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  const elements = [...withoutComments.matchAll(/<([A-Za-z][\w.]*)/g)].map(m => m[1]);

  it('uses only view types RemoteViews can inflate', () => {
    const offenders = elements.filter(name => !REMOTABLE.has(name));
    expect(
      offenders,
      `Not inflatable by a launcher: ${offenders.join(', ')}. ` +
      `A widget using one shows "Can't load widget" instead of anything at all.`,
    ).toEqual([]);
  });

  it('is actually reading elements', () => {
    // A regex that matched nothing would pass the check above forever.
    expect(elements).toContain('FrameLayout');
    expect(elements).toContain('ImageView');
  });

  it('keeps the ids the provider addresses', () => {
    // setViewVisibility / setOnClickPendingIntent against a missing id is a
    // silent no-op, so the pill would simply stop being tappable.
    for (const id of ['widget_root', 'widget_canvas', 'widget_review_hit', 'widget_remaining_hit']) {
      expect(source).toContain(`@+id/${id}`);
    }
  });
});
