/**
 * The walkthrough points at things that exist, and its caption does not sit on
 * top of them.
 *
 * Both failures are invisible in a build. A step whose target has been renamed
 * still renders — it dims the whole screen and says its piece, pointing
 * nowhere — and a caption that covers the thing it describes only does so at
 * certain screen heights, which is to say on somebody else's phone. Neither
 * would ever fail CI on its own, so they are pinned here.
 *
 * The targets live on the REAL components now, because the tour spotlights
 * the real app rather than a drawing of one. That is why this scans a list of
 * files rather than a single demo screen, and why a target may appear more
 * than once: the highlight is the UNION of everything carrying the name, so
 * one step can wrap the balance figure and the label above it together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TOUR_STEPS,
  DEMO_STAGES,
  stepsForSurface,
  captionSide,
  captionTop,
  spotlightRect,
  unionRects,
} from '../tourSteps';

/** Every file allowed to carry a `data-tour` anchor. */
const TOUR_SURFACE_FILES = [
  '../../components/Dashboard.tsx',
  '../../components/BudgetSection.tsx',
  '../../components/TransactionParsing.tsx',
  '../../components/dashboard_components/DashboardBalanceSection.tsx',
  '../../components/dashboard_components/DashboardBudgetSectionsList.tsx',
  '../../components/dashboard_components/DashboardBottomBar.tsx',
  '../../components/dashboard_components/DashboardSettingsModal.tsx',
  '../../components/tour/TourDemoScreen.tsx',
];

const sources = TOUR_SURFACE_FILES.map((relative) => ({
  name: relative.replace('../../', ''),
  text: readFileSync(resolve(__dirname, relative), 'utf8'),
}));

const allSource = sources.map((file) => file.text).join('\n');

function anchorCount(text: string, target: string): number {
  // Either `data-tour="x"` or the conditional form `data-tour={cond ? 'x' ...`,
  // which is how a target that only exists while a card is open is written.
  const literal = text.split(`data-tour="${target}"`).length - 1;
  const conditional = text.split(`'${target}'`).length - 1;
  return literal + conditional;
}

describe('the tour points at real things', () => {
  it('has a real element for every step', () => {
    for (const step of TOUR_STEPS) {
      expect(
        anchorCount(allSource, step.target),
        `TOUR_STEPS names "${step.target}", which nothing in the app carries`,
      ).toBeGreaterThan(0);
    }
  });

  it('says something at every step', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });

  it('opens each screen once, in one contiguous run', () => {
    // The host is only asked to move when the stage changes, and re-entering
    // a stage means rebuilding that screen — reopening a vial, remounting the
    // review page — which replays an animation the user has already watched.
    // "home" is the exception and is meant to repeat: the tour comes back to
    // the dashboard between sections to point at the button that opens the
    // next one, and going home only closes things.
    const entered = new Set<string>();
    let previous = '';
    for (const step of TOUR_STEPS) {
      if (step.stage === previous) continue;
      if (step.stage !== 'home') {
        expect(entered.has(step.stage), `stage "${step.stage}" is entered twice`).toBe(false);
        entered.add(step.stage);
      }
      previous = step.stage;
    }
  });

  it('comes back to the dashboard before opening the next screen', () => {
    // Otherwise a screen appears with nothing having shown the user what
    // opened it, which is the one thing a walkthrough is for.
    let previous = TOUR_STEPS[0].stage;
    for (const step of TOUR_STEPS.slice(1)) {
      if (step.stage === previous) continue;
      expect(
        previous === 'home' || step.stage === 'home',
        `"${step.target}" jumps straight from ${previous} to ${step.stage}`,
      ).toBe(true);
      previous = step.stage;
    }
  });

  it('starts on the dashboard, which is what is already on screen', () => {
    expect(TOUR_STEPS[0].stage).toBe('home');
  });

  it('shows the intro only what the example screen can stand in for', () => {
    const demo = stepsForSurface('demo');
    expect(demo.length).toBeGreaterThan(0);
    expect(demo.length).toBeLessThan(TOUR_STEPS.length);
    for (const step of demo) {
      expect(DEMO_STAGES).toContain(step.stage);
    }
    // And the demo screen itself has to carry every target it is shown.
    const demoSource = sources.find((file) => file.name.endsWith('TourDemoScreen.tsx'))!;
    const mounted = [
      demoSource.text,
      ...sources
        .filter((file) => /DashboardBalanceSection|DashboardBudgetSectionsList|DashboardBottomBar|BudgetSection/.test(file.name))
        .map((file) => file.text),
    ].join('\n');
    for (const step of demo) {
      expect(
        anchorCount(mounted, step.target),
        `the intro's example screen has no way to show "${step.target}"`,
      ).toBeGreaterThan(0);
    }
  });

  it('gives the live walkthrough every step', () => {
    expect(stepsForSurface('live')).toEqual(TOUR_STEPS);
  });
});

describe('unionRects', () => {
  it('wraps two separated elements in one rectangle', () => {
    // The balance label sits above the figure, and neither contains the other.
    const label = { top: 22, left: 132, width: 128, height: 15 };
    const figure = { top: 50, left: 131, width: 131, height: 30 };
    expect(unionRects([label, figure])).toEqual({ top: 22, left: 131, width: 131, height: 58 });
  });

  it('ignores an element with no area, which is one that is not on screen', () => {
    const real = { top: 100, left: 50, width: 200, height: 40 };
    expect(unionRects([{ top: 0, left: 0, width: 0, height: 0 }, real])).toEqual(real);
  });

  it('is null when there is nothing to wrap', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ top: 0, left: 0, width: 0, height: 0 }])).toBeNull();
  });
});

describe('captionSide', () => {
  const rect = { top: 100, left: 0, width: 300, height: 80 };

  it('reads downwards from the highlight when there is room', () => {
    expect(captionSide(rect, 800, 160)).toBe('below');
  });

  it('goes above when the caption would run off the bottom', () => {
    // Highlight ends at 180; a 700px-tall phone leaves 520 below, so shrink it.
    expect(captionSide({ ...rect, top: 500 }, 700, 160)).toBe('above');
  });

  it('picks the roomier side when the caption fits on neither', () => {
    // A tall target on a short screen: 40 above, 120 below.
    const tall = { top: 56, left: 0, width: 300, height: 300 };
    expect(captionSide(tall, 500, 400)).toBe('below');
  });
});

describe('captionTop', () => {
  const viewportHeight = 852;
  const captionHeight = 280;

  it('reads downwards from the highlight when there is room', () => {
    const rect = { top: 50, left: 0, width: 300, height: 60 };
    expect(captionTop(rect, viewportHeight, captionHeight)).toBe(126);
  });

  it('goes above when the caption would run off the bottom', () => {
    const rect = { top: 600, left: 0, width: 300, height: 60 };
    expect(captionTop(rect, viewportHeight, captionHeight)).toBe(304);
  });

  it('never places the caption off the top, however tall the highlight', () => {
    // A card filling most of the screen: neither side fits, and "above" would
    // put the caption at -104.
    const rect = { top: 176, left: 0, width: 380, height: 620 };
    const top = captionTop(rect, viewportHeight, captionHeight);
    expect(top).toBeGreaterThanOrEqual(16);
    expect(top + captionHeight).toBeLessThanOrEqual(viewportHeight - 16);
  });

  it('never places the caption off the bottom either', () => {
    const rect = { top: 110, left: 0, width: 380, height: 640 };
    const top = captionTop(rect, viewportHeight, captionHeight);
    expect(top).toBeGreaterThanOrEqual(16);
    expect(top + captionHeight).toBeLessThanOrEqual(viewportHeight - 16);
  });

  it('keeps the title on screen when the caption is taller than the phone', () => {
    const rect = { top: 100, left: 0, width: 300, height: 60 };
    expect(captionTop(rect, 400, 500)).toBe(16);
  });
});

describe('spotlightRect', () => {
  const viewport = { width: 400, height: 800 };

  it('pads the target so the highlight reads as a spotlight, not a border', () => {
    const out = spotlightRect({ top: 100, left: 50, width: 200, height: 40 }, viewport, 8);
    expect(out).toEqual({ top: 92, left: 42, width: 216, height: 56 });
  });

  it('takes a different pad per side, for a target with something just below it', () => {
    const out = spotlightRect({ top: 100, left: 50, width: 200, height: 40 }, viewport, {
      top: 30,
      bottom: 4,
    });
    expect(out).toEqual({ top: 70, left: 42, width: 216, height: 74 });
  });

  it('never draws past the bottom of the screen, where the gesture bar is', () => {
    const out = spotlightRect({ top: 760, left: 50, width: 200, height: 40 }, viewport, 8);
    expect(out.top + out.height).toBeLessThanOrEqual(viewport.height);
  });

  it('never draws past the left edge', () => {
    const out = spotlightRect({ top: 100, left: 0, width: 200, height: 40 }, viewport, 8);
    expect(out.left).toBeGreaterThanOrEqual(0);
  });
});
