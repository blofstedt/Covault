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
// app's own components — the walkthrough points at the real screen, not at a
// drawing of one. `tourSteps.test.ts` fails the build if a target has no
// home, because a step whose target is missing is a step that silently points
// at nothing.

/**
 * Which screen a step is talking about.
 *
 * The tour does not just describe the app, it drives it: the host puts the
 * app into the step's stage before the spotlight is measured, so the expand
 * animation a step describes is the real one, and the review page and the
 * settings menu it points at are the real ones with the user's own things in
 * them. Steps are grouped by stage below so the app is only moved when the
 * story actually moves.
 */
export type TourStage = 'home' | 'budget' | 'add' | 'review' | 'settings';

export interface TourStepSpec {
  /**
   * Matches `data-tour` on one or more real components. Every match is taken
   * into the highlight, so a caption that is about two elements — the balance
   * figure and the word above it, which live in two different rows — gets one
   * rectangle around both rather than a hole through the middle of it.
   *
   * Absent means "no highlight": the screen dims evenly and the caption sits
   * in the middle of it. That is for a step that is not about a control.
   */
  target?: string;
  /** Which screen the host has to be showing before this step can be drawn. */
  stage: TourStage;
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
   * Per-side because a couple of targets sit very close to something the hole
   * must not catch — the balance figure has the search field 8px under it.
   */
  pad?: SpotlightPad;
  /**
   * Play a tap on this step's own highlight before moving on.
   *
   * The steps that open something say "let's open it", and then the screen
   * changes on its own — which reads as the app deciding to navigate rather
   * than as the button being pressed. A ripple where the finger would have
   * gone is the difference between watching a demonstration and watching a
   * screen misbehave.
   */
  tap?: boolean;
  /**
   * Where the simulated finger lands, when that is not the middle of the
   * highlight. "Let's open one" highlights the whole column of vials, and a
   * ripple in the middle of it would land on a card that is not the one that
   * opens — a small thing, and exactly the kind of small thing that makes a
   * demonstration read as wrong.
   */
  tapTarget?: string;
}

/** Padding around a highlight: one number for all four sides, or per side. */
export type SpotlightPad =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

/**
 * The walkthrough, in the order someone would actually meet the app.
 *
 * Grouped by stage — the dashboard, a budget opened, the add form, the review
 * page, the settings menu — with a step back on the dashboard between each,
 * because a screen that appears without the user seeing what opened it
 * teaches nothing. The steps that open something end with a tap where the
 * finger would have gone.
 *
 * One list, shown identically from the intro and from Settings. There used to
 * be a shorter intro version, on the grounds that a brand-new account has no
 * review page or settings worth showing — but the point of meeting the app is
 * meeting the app, and `TourDemoScreen` stands in for every screen now rather
 * than only the dashboard. It is long, and it is skippable at every step.
 */
export const TOUR_STEPS: readonly TourStepSpec[] = [
  {
    target: 'balance',
    stage: 'home',
    title: "What's left",
    body: 'The big number is what you still have to spend this month — your income, minus everything that has gone out of it.',
    radius: 20,
    // The search field sits 8px below the figure and must not be caught in
    // the same hole.
    pad: { top: 8, right: 14, bottom: 5, left: 14 },
  },
  {
    target: 'months',
    stage: 'home',
    title: 'Any month, not just this one',
    body: 'The chart is where your spending has been going, month by month. The row of months under it goes three back and three ahead — tap one to put the whole dashboard on it, and tap it again to come back to now.',
    radius: 24,
    // The search field is 4px above the chart and the vials 8px below it, so
    // this one barely reaches in either direction.
    pad: { top: 2, right: 8, bottom: 4, left: 8 },
  },
  {
    target: 'vials',
    stage: 'home',
    title: 'One vial per category',
    body: "Each fills as you spend. The faint dotted end is money that hasn't gone yet — subscriptions and bills Covault knows are coming. Let's open one.",
    radius: 32,
    tap: true,
    tapTarget: 'vial-first',
  },

  {
    target: 'budget-card',
    stage: 'budget',
    title: 'A vial, opened',
    body: 'The card grows into the space the others were using, and they shrink rather than scroll — everything on screen stays on screen.',
    radius: 32,
  },
  {
    target: 'budget-total',
    stage: 'budget',
    title: 'Spent, and the limit',
    body: 'The small figure is what has gone out of this category this month; the big one is the limit you set for it. "Vault Capacity" is the phrase for that limit.',
    radius: 20,
  },
  {
    target: 'budget-list',
    stage: 'budget',
    title: 'Everything in that category',
    body: 'Every purchase filed here this month, newest at the bottom. Tap one to change its category, fix the name, correct the amount, or delete it.',
    radius: 24,
  },

  {
    target: 'add',
    stage: 'home',
    title: 'Adding something by hand',
    body: "Cash, or a purchase your bank never announced. Let's add one.",
    radius: 999,
    tap: true,
  },
  {
    target: 'form-amount',
    stage: 'add',
    title: 'How much',
    body: 'The amount, and whether it went out or came back — the second tab turns the entry into a refund, which gives money back to the category rather than taking more from it.',
    radius: 24,
  },
  {
    target: 'form-vendor',
    stage: 'add',
    title: 'Who you paid',
    body: 'Start typing and Covault offers merchants you have used before. Picking one also picks the category you filed it under last time.',
    radius: 20,
  },
  {
    target: 'form-budget',
    stage: 'add',
    title: 'Which vial it comes out of',
    body: 'One tap. Only the categories you have switched on appear here, and the entry comes out of that vial the moment it is saved.',
    radius: 20,
  },
  {
    target: 'form-recurrence',
    stage: 'add',
    title: 'Does it come back?',
    body: 'One-time is an ordinary purchase. The other three tell Covault the charge repeats, so it can show it coming before it arrives — the dotted end of the vial — and not mistake the real charge for a second one.',
    radius: 20,
  },
  {
    target: 'form-save',
    stage: 'add',
    title: 'And save it',
    body: 'That is the whole form. This walkthrough will not actually save this one — nothing you have seen in here has been written down.',
    radius: 20,
    tap: true,
  },

  {
    target: 'review',
    stage: 'home',
    title: 'Caught purchases wait here',
    body: "When your bank announces a purchase, Covault reads it and leaves it here. The number is how many you haven't looked at yet. Let's open it.",
    radius: 999,
    tap: true,
  },
  {
    target: 'review-banks',
    stage: 'review',
    title: 'Where purchases come from',
    body: 'The apps Covault is allowed to read alerts from, and when each was last heard from. Untick one and it stops being read; if a bank goes quiet for a long time, this is where it says so.',
    radius: 24,
  },
  {
    target: 'review-caught',
    stage: 'review',
    title: 'The purchases themselves',
    body: 'Each one shows the merchant, the amount and a guess at the category. Change the category if the guess is wrong, then accept it — and Covault remembers that merchant for next time.',
    radius: 24,
  },
  {
    target: 'review-rules',
    stage: 'review',
    title: 'What it has learned',
    body: 'Every merchant you have filed, and where it goes from now on. Correcting one here changes where its future purchases land; deleting one makes Covault ask again.',
    radius: 24,
  },
  {
    target: 'home',
    stage: 'review',
    title: 'Home, from anywhere',
    body: 'Home puts the screen back to how it looks when you arrive: any open vial closes, a search clears, and the dashboard returns to this month.',
    radius: 999,
    tap: true,
  },

  {
    target: 'settings',
    stage: 'home',
    title: 'Everything else is behind the cog',
    body: "Top right, on the dashboard. Let's open it.",
    radius: 999,
    tap: true,
  },
  {
    target: 'settings-faq',
    stage: 'settings',
    title: 'Frequently Asked',
    body: 'The written answers — what happens if a purchase is captured twice, why a charge landed in Other, how a refund is matched. Worth a look before writing in.',
    radius: 20,
  },
  {
    target: 'settings-walkthrough',
    stage: 'settings',
    title: 'This walkthrough',
    body: 'The button you are looking at is the way back to what you are watching now. It starts from the top, any time.',
    radius: 20,
  },
  {
    target: 'settings-income',
    stage: 'settings',
    title: 'Your monthly income',
    body: 'The figure the whole dashboard counts down from. The big number on the home screen is this, minus everything spent this month.',
    radius: 24,
  },
  {
    target: 'settings-limits',
    stage: 'settings',
    title: 'Limits, and which categories you keep',
    body: 'A limit per category — that is the number on the right of each vial. The eye beside one switches it off: it leaves the dashboard, and nothing new is filed into it.',
    radius: 24,
  },
  {
    target: 'settings-theme',
    stage: 'settings',
    title: 'Light or dark',
    body: 'Which way the app is painted. It changes immediately, and it is remembered on this phone.',
    radius: 24,
  },
  {
    target: 'settings-capture',
    stage: 'settings',
    title: 'Capture — the reason for the app',
    body: 'The main switch for reading bank alerts, plus whether a merchant Covault already knows gets filed without asking you, and whether a capture buzzes the phone.',
    radius: 24,
  },
  {
    target: 'settings-rules',
    stage: 'settings',
    title: 'Shared rules',
    body: 'Whether to use what other households have already worked out about a merchant, and whether to contribute yours back. Category names only — no amounts, no dates, nothing about you.',
    radius: 24,
  },
  {
    target: 'settings-widget',
    stage: 'settings',
    title: 'The home-screen widget',
    body: "What is left this month, on your home screen, without opening anything. This adds it — or tells you how, if your launcher won't let an app do it for you.",
    radius: 24,
  },
  {
    target: 'settings-rollover',
    stage: 'settings',
    title: 'Rollover',
    body: 'On, and whatever a category did not spend this month is added to its limit next month. Off, and every category starts each month at the limit you set.',
    radius: 24,
  },
  {
    target: 'settings-ai',
    stage: 'settings',
    title: 'The reading model',
    body: 'Most bank alerts are read by pattern, on the phone, instantly. This is the fallback for the ones worded strangely — a small model that lives on your device.',
    radius: 24,
  },
  {
    target: 'settings-smart',
    stage: 'settings',
    title: 'Smart notifications',
    body: 'Whether Covault tells you things about your own spending — nearing a limit, going over one — rather than only about purchases it has caught.',
    radius: 24,
  },
  {
    target: 'settings-shield',
    stage: 'settings',
    title: 'The Discretionary Shield',
    body: 'When one category goes over, Leisure covers the difference instead of showing you a vial in the red. The money left the month either way; this is about which vial wears it.',
    radius: 24,
  },
  {
    target: 'settings-sharing',
    stage: 'settings',
    title: 'Sharing the vault',
    body: 'Invite someone by email and you keep one set of budgets between you: both phones capture, and both see the same money.',
    radius: 24,
  },
  {
    target: 'settings-data',
    stage: 'settings',
    title: 'Your history, in and out',
    body: 'Export any date range as a spreadsheet, or bring history in from another app as one. Your data is yours, and it leaves in a format anything can open.',
    radius: 24,
  },
  {
    target: 'settings-report',
    stage: 'settings',
    title: 'The monthly report',
    body: 'A month, summarised — what each category took, what was left, and how it compares with the months around it.',
    radius: 24,
  },
  {
    target: 'settings-support',
    stage: 'settings',
    title: 'Support and feedback',
    body: 'Report something that went wrong, or ask for something that is missing. A bank Covault is not reading properly is worth sending in — that is usually a fix rather than an answer.',
    radius: 24,
  },
  {
    target: 'settings-account',
    stage: 'settings',
    title: 'Signing out, and leaving',
    body: 'Sign out keeps everything and asks for your password next time. The row under it deletes the account and everything in it, and there is no undo on that one.',
    radius: 24,
  },

  {
    // No target. This is not about a control, and pointing at one would be a
    // lie; the screen dims evenly and the words sit in the middle of it.
    stage: 'home',
    title: 'One last thing: you are not the product',
    body: 'Covault is paid for by subscriptions. That is the whole business — we do not sell or share your information, we do not sell advertising against it, and no third party is handed what you spend. What the app knows about your money exists to show it back to you, and to the person you share a vault with if you choose to. Nowhere else.',
    radius: 32,
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
 * Where the top of the caption goes, in viewport pixels.
 *
 * Picking a side is not enough on its own, and the walkthrough proved it the
 * moment it started highlighting whole cards. A target that fills most of the
 * screen — the review page's list of caught purchases, a settings section
 * near the bottom of a scrolled modal — leaves too little room on EITHER
 * side, and `captionSide`'s "take the roomier one and overlap" then placed the
 * caption partly off the top of the screen in one case and off the bottom in
 * the other. Half a caption over the thing it describes is the compromise
 * that was intended; half a caption past the edge of the phone is just gone.
 *
 * So the side is chosen first and the result is then clamped to stay wholly
 * on screen. Overlapping the highlight is allowed, leaving the screen is not.
 */
export function captionTop(
  rect: TargetRect,
  viewportHeight: number,
  captionHeight: number,
  gap: number = 16,
): number {
  const side = captionSide(rect, viewportHeight, captionHeight, gap);
  const desired =
    side === 'below' ? rect.top + rect.height + gap : rect.top - gap - captionHeight;
  // `Math.max` on the ceiling as well as the floor: a caption taller than the
  // screen has no position that fits, and the top edge is the half worth
  // keeping — it carries the title.
  const highest = gap;
  const lowest = Math.max(gap, viewportHeight - captionHeight - gap);
  return Math.round(Math.min(Math.max(desired, highest), lowest));
}

/**
 * The highlight's rectangle: the target, padded, and kept on screen.
 *
 * The padding is what makes it read as a spotlight rather than a border. The
 * clamping matters on the bottom bar, whose buttons sit inside the device's
 * safe-area inset — without it the ring's lower edge is drawn under the
 * phone's own gesture bar, where it looks cut off.
 */
/**
 * The smallest rectangle containing all of them, or null if none has any area.
 *
 * This is what lets one step point at two elements. "Remaining Balance" and
 * the figure under it are in separate rows of the header — the label is
 * absolutely positioned so it can centre on the screen while the settings cog
 * sits to its right — so no single element contains both. Padding one of them
 * far enough to reach the other either swallowed the search field below or
 * cut the label in half, depending on the phone.
 */
export function unionRects(rects: readonly TargetRect[]): TargetRect | null {
  if (rects.length === 0) return null;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    // A hidden element measures 0x0 at the origin, which would drag the union
    // to the top-left corner of the screen. Anything with no area is not on
    // screen and has nothing to contribute.
    if (rect.width <= 0 || rect.height <= 0) continue;
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  if (top === Infinity) return null;
  return { top, left, width: right - left, height: bottom - top };
}

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
