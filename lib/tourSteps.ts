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
// Every `target` here must exist as a `data-tour` attribute on the demo
// screen. `tourSteps.test.ts` fails the build if one doesn't, because a step
// whose target is missing is a step that silently points at nothing.

export interface TourStepSpec {
  /** Matches a `data-tour` attribute in components/tour/TourDemoScreen.tsx. */
  target: string;
  title: string;
  body: string;
  /**
   * Corner rounding of the highlight, in pixels, so it follows the shape it
   * is drawn around rather than boxing a round button in a square.
   */
  radius: number;
}

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
  },
  {
    target: 'months',
    title: 'Any month, not just this one',
    body: 'Three months back, three ahead. Tap one to read it; tap it again to come back to now.',
    radius: 20,
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
  pad: number = 8,
): TargetRect {
  const left = Math.max(4, rect.left - pad);
  const top = Math.max(4, rect.top - pad);
  const right = Math.min(viewport.width - 4, rect.left + rect.width + pad);
  const bottom = Math.min(viewport.height - 4, rect.top + rect.height + pad);
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
