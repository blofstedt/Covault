import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Guards the budget expand/collapse hot path.
 *
 * Tapping a budget animates two pure-layout properties (`flex-basis` and
 * `grid-template-rows`) across a subtree that contains every transaction row of
 * every budget — they all stay mounted. Anything expensive to paint inside that
 * subtree, or overlapping it, is therefore re-evaluated on every frame of the
 * 320ms transition.
 *
 * On desktop Chrome this is invisible. On a Pixel 9 — roughly 2.8x the pixels,
 * an 8.3ms frame budget at 120Hz, and a WebView that handles `backdrop-filter`
 * and SVG filters far worse than a desktop GPU — it was the difference between
 * smooth and visibly choppy.
 *
 * `backdrop-filter` is the specific trap. Each element carrying one becomes its
 * own backdrop root: a separate render surface that must re-sample and re-blur
 * everything beneath it whenever that geometry moves. It is also completely
 * silent — nothing fails, nothing warns, the app just feels bad on a phone and
 * fine on the laptop it was developed on. This has already been the cause once.
 *
 * These files are allowed to blur a *static* backdrop (modals, sheets), which is
 * cheap and load-bearing. What they may not do is blur inside or over the
 * animating budget list.
 */

const ROOT = resolve(__dirname, '../..');

const BACKDROP_BLUR = /\bbackdrop-blur(-|\b)/;

/** Files that render inside, or directly on top of, the animating budget list. */
const HOT_PATH_FILES = [
  'components/TransactionItem.tsx',
  'components/BudgetSection.tsx',
  'components/dashboard_components/DashboardBudgetSectionsList.tsx',
  'components/dashboard_components/DashboardBottomBar.tsx',
];

describe('budget expand hot path', () => {
  for (const relPath of HOT_PATH_FILES) {
    it(`${relPath} uses no backdrop-filter`, () => {
      const source = readFileSync(join(ROOT, relPath), 'utf8');

      // Strip comments so the explanatory notes describing *why* the blur was
      // removed don't trip the check that keeps it removed.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      expect(
        BACKDROP_BLUR.test(code),
        `${relPath} renders inside or over the budget list, which animates ` +
        'layout properties. A backdrop-filter there is re-blurred on every ' +
        'frame of the expand and was the dominant cause of jank on Android. ' +
        'Raise the background alpha instead (e.g. bg-white/90).',
      ).toBe(false);
    });
  }

  it('keeps every transaction row out of layout until the expand has finished', () => {
    const source = readFileSync(join(ROOT, 'components/BudgetSection.tsx'), 'utf8');

    expect(
      /contentVisibility:\s*revealed\s*\?\s*'visible'\s*:\s*'hidden'/.test(source),
      'BudgetSection keeps collapsed transaction lists mounted on purpose, so ' +
      'the collapse animation does not drop its content. That is only ' +
      'affordable with `content-visibility: hidden`.',
    ).toBe(true);

    // Keying this on `isExpanded` is the subtle wrong answer: it does remove
    // the per-frame layout of the OTHER budgets' lists, but it forces the
    // expanding one to lay out its whole subtree on frame 1 of the animation,
    // which stalls the very motion it was meant to speed up. `revealed` flips
    // only once the 320ms transition is over.
    expect(
      /contentVisibility:\s*isExpanded/.test(source),
      'content-visibility must be keyed on `revealed`, not `isExpanded` — ' +
      'see the note beside the useState in BudgetSection.tsx.',
    ).toBe(false);
  });

  it('walls each budget row off from its siblings during the layout animation', () => {
    const source = readFileSync(
      join(ROOT, 'components/dashboard_components/DashboardBudgetSectionsList.tsx'),
      'utf8',
    );

    expect(
      /contain:\s*'layout paint'/.test(source),
      'Each row wrapper animates flex-basis and grid-template-rows. Without ' +
      '`contain: layout paint` one row relayouting dirties its siblings and ' +
      'the chart above, so the per-frame cost scales with the budget count.',
    ).toBe(true);
  });
});
