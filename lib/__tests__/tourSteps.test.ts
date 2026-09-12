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
 * The targets live on the REAL dashboard components now, because the tour
 * spotlights the real screen rather than a drawing of one. That is why this
 * scans a list of files rather than a single demo screen — and why a target is
 * allowed to appear in two of them: `TourDemoScreen` mounts the same
 * components for the intro, where no dashboard exists yet, and reproduces the
 * dashboard's own chart wrapper. Twice in ONE file is still a failure: only
 * one of those two screens is ever mounted at a time, but two matches inside
 * one of them means the spotlight could land on either.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOUR_STEPS, captionSide, spotlightRect } from '../tourSteps';

/** Every file allowed to carry a `data-tour` anchor. */
const TOUR_SURFACE_FILES = [
  '../../components/Dashboard.tsx',
  '../../components/dashboard_components/DashboardBalanceSection.tsx',
  '../../components/dashboard_components/DashboardBudgetSectionsList.tsx',
  '../../components/dashboard_components/DashboardBottomBar.tsx',
  '../../components/tour/TourDemoScreen.tsx',
];

const sources = TOUR_SURFACE_FILES.map((relative) => ({
  name: relative.replace('../../', ''),
  text: readFileSync(resolve(__dirname, relative), 'utf8'),
}));

function countIn(text: string, target: string): number {
  return text.split(`data-tour="${target}"`).length - 1;
}

describe('the tour points at real things', () => {
  it('has a real element for every step', () => {
    for (const step of TOUR_STEPS) {
      const total = sources.reduce((sum, file) => sum + countIn(file.text, step.target), 0);
      expect(
        total,
        `TOUR_STEPS names "${step.target}", which nothing in the app carries`,
      ).toBeGreaterThan(0);
    }
  });

  it('names each target at most once per screen, so a step cannot highlight the wrong one of two', () => {
    for (const step of TOUR_STEPS) {
      for (const file of sources) {
        const matches = countIn(file.text, step.target);
        expect(
          matches,
          `"${step.target}" appears ${matches} times in ${file.name}`,
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers the demo screen the intro shows, which has no dashboard behind it', () => {
    const demo = sources.find((file) => file.name.endsWith('TourDemoScreen.tsx'))!;
    const dashboardOwned = sources.filter((file) => !file.name.endsWith('TourDemoScreen.tsx'));
    for (const step of TOUR_STEPS) {
      // Either the demo screen carries the anchor itself, or it mounts the
      // component that does. Both are checked by hand here rather than
      // inferred, because "it renders the real component" is exactly the
      // property that would rot silently.
      const inDemo = countIn(demo.text, step.target) > 0;
      const owner = dashboardOwned.find((file) => countIn(file.text, step.target) > 0);
      const mounted =
        owner !== undefined &&
        (owner.name.endsWith('Dashboard.tsx') ||
          demo.text.includes(owner.name.split('/').pop()!.replace('.tsx', '')));
      expect(
        inDemo || mounted,
        `the intro's demo screen has no way to show "${step.target}"`,
      ).toBe(true);
    }
  });

  it('says something at every step', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
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

describe('spotlightRect', () => {
  const viewport = { width: 400, height: 800 };

  it('pads the target so the highlight reads as a spotlight, not a border', () => {
    const out = spotlightRect({ top: 100, left: 50, width: 200, height: 40 }, viewport, 8);
    expect(out).toEqual({ top: 92, left: 42, width: 216, height: 56 });
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
