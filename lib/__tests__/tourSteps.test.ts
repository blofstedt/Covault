/**
 * The walkthrough points at things that exist, and its caption does not sit on
 * top of them.
 *
 * Both failures are invisible in a build. A step whose target has been renamed
 * still renders — it dims the whole screen and says its piece, pointing
 * nowhere — and a caption that covers the thing it describes only does so at
 * certain screen heights, which is to say on somebody else's phone. Neither
 * would ever fail CI on its own, so they are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOUR_STEPS, captionSide, spotlightRect } from '../tourSteps';

const demoScreen = readFileSync(
  resolve(__dirname, '../../components/tour/TourDemoScreen.tsx'),
  'utf8',
);

describe('the tour points at real things', () => {
  it('has a demo target for every step', () => {
    for (const step of TOUR_STEPS) {
      expect(
        demoScreen.includes(`data-tour="${step.target}"`),
        `TOUR_STEPS names "${step.target}", which TourDemoScreen.tsx does not draw`,
      ).toBe(true);
    }
  });

  it('names each target once, so a step cannot highlight the wrong one of two', () => {
    for (const step of TOUR_STEPS) {
      const matches = demoScreen.split(`data-tour="${step.target}"`).length - 1;
      expect(matches, `"${step.target}" appears ${matches} times`).toBe(1);
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
