// lib/tourSteps.ts
//
// What the walkthrough points at, what it says, and where the caption goes.
//
// Separate from the components for two reasons. The words are the part most
// likely to be rewritten, and rewriting them should not mean reading a
// spotlight implementation. And the geometry is the part most likely to be
// got wrong: a caption that covers the very thing it is describing is the
// classic failure of a tour like this, and it only happens at certain screen
// heights — which is to say, on somebody else's phone, where nobody is
// looking.
//
// Every `target` here must exist as a `data-tour` attribute on one of the
// dashboard's own components — the walkthrough points at the real screen now,
// not at a drawing of one. `tourSteps.test.ts` fails the build if a target has
// no home, because a step whose target is missing is a step that silently
// points at nothing.

export interface TourStepSpec {
  /**
   * Matches a `data-tour` attribute on a real dashboard component. The files
   * carrying them are listed in `tourSteps.test.ts`.
   */
  target: string;
  title: string;
  body: string;
  /**
   * Corner rounding of the highlight, in pixels, so it follows the shape it
   * is drawn around rather than boxing a round button in a square.
   */
  radius: number;
  /**
   * How far the highlight reaches past its target, per side. Defaults to 8 all
   * round, which is what makes it read as a spotlight rather than a border.
   *
   * It is per-side because the thing a caption describes is not always the
   * same as the element that holds it. The balance figure is one element and
   * the word above it ("Remaining Balance") is another, in another row
   * entirely — an even pad either cuts that label in half or, reaching far
   * enough down to balance it, swallows the search field underneath. So the
   * balance step reaches up and barely down, and the chart step barely up.
   */
  pad?: SpotlightPad;
}

/** Padding around a highlight: one number for all four sides, or per side. */
export type SpotlightPad =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

/**
 * The six things a new user has to find before the app makes sense.
 *
 * Deliberately not a feature list. Each step is somewhere they will need to
 * go — the number that tells them how they are doing, the way back to a past
 * month, the vials, the two buttons, and the drawer everything else lives in.
 * The Discretionary Shield, refunds, fuel holds and shared rules are all
 * absent on purpose: they are answers to questions nobody has on day one.
 */
export const TOUR_STEPS: readonly TourStepSpec[] = [
  {
    target: 'balance',
    title: "What's left",
    body: 'The big number is what you still have to spend this month — your income, minus everything that has gone out of it.',
    radius: 24,
    // Up far enough to take in the label above the figure, wide enough that
    // the longer shared-vault wording ("Our Remaining Balance") still fits
    // inside it, and barely down at all, because the search field is 8px
    // below the figure and must not be caught in the same hole.
    pad: { top: 32, right: 70, bottom: 4, left: 70 },
  },
  {
    target: 'months',
    title: 'Any month, not just this one',
    body: 'The chart is where your spending has been going, month by month. The row of months under it goes three back and three ahead — tap one to put the whole dashboard on it, and tap it again to come back to now.',
    radius: 24,
    // The search field sits 4px above the chart and the vials 8px below it,
    // so this one barely reaches in either direction.
    pad: { top: 2, right: 8, bottom: 4, left: 8 },
  },
  {
    target: 'vials',
    title: 'One vial per category',
    body: "Each fills as you spend. The faint dotted end is money that hasn't gone yet — subscriptions and bills Covault knows are coming. Tap a vial to see what's inside it.",
    radius: 32,
  },
  {
    target: 'add',
    title: 'Add anything by hand',
    body: 'Cash, or a purchase your bank never announced. Amount, who you paid, which vial.',
    radius: 999,
  },
  {
    target: 'review',
    title: 'Caught purchases wait here',
    body: "When your bank announces a purchase, Covault reads it and leaves it here. The number is how many you haven't looked at yet.",
    radius: 999,
  },
  {
    target: 'settings',
    title: 'Everything else is behind the cog',
    body: 'Which banks Covault listens to, your limits, sharing the vault with someone, and the home-screen widget.',
    radius: 999,
  },
];

/** A rectangle in viewport coordinates. Whatever `getBoundingClientRect` gives. */
export interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type CaptionSide = 'above' | 'below';

/**
 * Which side of the highlight the caption goes on.
 *
 * Below is preferred — reading downwards from the thing being described is
 * the way every tour of this shape works — but only when the caption actually
 * fits there. When neither side fits (a tall target on a short phone) the
 * roomier side wins and the caption is allowed to overlap the highlight
 * rather than run off the screen, because a caption half off the bottom edge
 * cannot be read at all while an overlapping one still can.
 */
export function captionSide(
  rect: TargetRect,
  viewportHeight: number,
  captionHeight: number,
  gap: number = 16,
): CaptionSide {
  const below = viewportHeight - (rect.top + rect.height) - gap;
  const above = rect.top - gap;
  if (below >= captionHeight) return 'below';
  if (above >= captionHeight) return 'above';
  return below >= above ? 'below' : 'above';
}

/**
 * The highlight's rectangle: the target, padded, and kept on screen.
 *
 * The padding is what makes it read as a spotlight rather than a border. The
 * clamping matters on the bottom bar, whose buttons sit inside the device's
 * safe-area inset — without it the ring's lower edge is drawn under the
 * phone's own gesture bar, where it looks cut off.
 */
export function spotlightRect(
  rect: TargetRect,
  viewport: { width: number; height: number },
  pad: SpotlightPad = 8,
): TargetRect {
  const sides =
    typeof pad === 'number'
      ? { top: pad, right: pad, bottom: pad, left: pad }
      : { top: pad.top ?? 8, right: pad.right ?? 8, bottom: pad.bottom ?? 8, left: pad.left ?? 8 };

  const left = Math.max(4, rect.left - sides.left);
  const top = Math.max(4, rect.top - sides.top);
  const right = Math.min(viewport.width - 4, rect.left + rect.width + sides.right);
  const bottom = Math.min(viewport.height - 4, rect.top + rect.height + sides.bottom);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
