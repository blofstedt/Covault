import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import TourDemoScreen from './TourDemoScreen';
import {
  TOUR_STEPS,
  captionSide,
  spotlightRect,
  type TargetRect,
} from '../../lib/tourSteps';
import { useEscapeKey } from '../../lib/hooks/useEscapeKey';

/**
 * The walkthrough: a spotlight over the dashboard.
 *
 * It points at the REAL screen. It used to draw its own likeness of a
 * dashboard and spotlight that instead, and the likeness drifted — a
 * left-aligned balance where the real one is centred, a row of month names
 * where the real one has a chart, no search field at all — so someone who
 * knew the app was shown a worse copy of a screen they were already looking
 * at. A copy of a screen is a second screen to maintain, and the only thing
 * it can do is fall behind.
 *
 * So there are two surfaces and both are the actual dashboard:
 *
 *   - `surface="live"` (from Settings) dims the dashboard that is already
 *     mounted behind this overlay and cuts a hole in it. Nothing is drawn
 *     twice, and what the spotlight circles is the user's own money.
 *   - `surface="demo"` (the last step of the intro) renders
 *     `TourDemoScreen`, which is the same dashboard components fed example
 *     figures — because during the intro there is no dashboard mounted, and a
 *     brand-new one would be a row of zeroes anyway.
 *
 * Taps never reach the app underneath: this root is a full-screen element
 * with pointer events ON, so it swallows everything that is not one of its
 * own buttons. That is what stops a stray thumb writing a real transaction or
 * opening settings mid-sentence.
 *
 * The dim is one element with an enormous spread shadow rather than four
 * rectangles around the hole. Four elements have to be kept in agreement on
 * every step, and any disagreement shows as a seam of un-dimmed screen; one
 * element cannot disagree with itself. It moves on the app's own 320ms curve,
 * and only when the step changes.
 */

interface GuidedTourProps {
  /** Called when the tour is finished, skipped, or dismissed. */
  onFinish: () => void;
  /** Label for the last step's button. The intro says "Let's go". */
  finishLabel?: string;
  /**
   * What the spotlight is cut out of. "live" points at the dashboard already
   * mounted behind this overlay; "demo" draws one from example figures,
   * for the intro, where there is no dashboard yet.
   */
  surface?: 'live' | 'demo';
}

/** Used until the caption has been measured. Roughly a three-line caption. */
const CAPTION_HEIGHT_ESTIMATE = 168;
const GAP = 16;

/**
 * How long to keep re-measuring after a step changes.
 *
 * One measurement is not enough, and the reason is the dashboard itself: the
 * balance block arrives on `animate-nest`, the figure counts up to its value
 * (which changes its WIDTH as digits land), and the chart is a lazy chunk that
 * appears whenever it appears. Measuring once, on the frame the step changed,
 * pinned the hole to wherever the screen was mid-arrival — which is how the
 * first step ended up with its ring drawn through the middle of the number it
 * was pointing at.
 *
 * 900ms covers the longest of those (the count-up). The loop stops early once
 * the rectangle has held still, so on a settled screen — which is every replay
 * from Settings — it costs a handful of frames.
 */
const SETTLE_MS = 900;
const STABLE_FRAMES = 4;

function sameRect(a: TargetRect | null, b: TargetRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

const GuidedTour: React.FC<GuidedTourProps> = ({
  onFinish,
  finishLabel = 'Done',
  surface = 'demo',
}) => {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [captionHeight, setCaptionHeight] = useState(CAPTION_HEIGHT_ESTIMATE);

  const rootRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  useEscapeKey(onFinish);

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root || !step) return;
    // In live mode the target is the dashboard behind this overlay, which is
    // a sibling rather than a child — so the search starts at the document.
    // In demo mode it is inside this root, and scoping to the root is what
    // stops a step matching the real dashboard by accident if both are ever
    // mounted at once.
    const scope: ParentNode = surface === 'live' ? document : root;
    const target = scope.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!target) {
      // A step pointing at nothing still has to read as something. Dropping
      // the rect dims the whole screen and centres the caption, which says
      // the words without claiming to point anywhere. `tourSteps.test.ts`
      // exists so this is never reached in a shipped build.
      setRect(null);
      return;
    }
    const box = target.getBoundingClientRect();
    const next = spotlightRect(
      { top: box.top, left: box.left, width: box.width, height: box.height },
      { width: window.innerWidth, height: window.innerHeight },
      step.pad,
    );
    // Only commit a real change: the settle loop below measures every frame,
    // and re-rendering on each of them would put the hole's own 320ms
    // transition back to the start of its curve on every one.
    setRect((previous) => (sameRect(previous, next) ? previous : next));
  }, [step, surface]);

  // After layout, not after paint: measuring in `useEffect` lets one frame
  // through with the hole in its previous place, which reads as the spotlight
  // lagging a step behind the words.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Then keep measuring until the screen underneath has stopped moving. See
  // SETTLE_MS.
  useEffect(() => {
    let frame = 0;
    let stable = 0;
    let last: DOMRect | null = null;
    const started = performance.now();

    const tick = () => {
      const root = rootRef.current;
      const target = root && step
        ? (surface === 'live' ? document : root).querySelector<HTMLElement>(
            `[data-tour="${step.target}"]`,
          )
        : null;
      const box = target?.getBoundingClientRect() ?? null;

      const held =
        box !== null &&
        last !== null &&
        box.top === last.top &&
        box.left === last.left &&
        box.width === last.width &&
        box.height === last.height;
      stable = held ? stable + 1 : 0;
      last = box;

      measure();

      if (stable < STABLE_FRAMES && performance.now() - started < SETTLE_MS) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [measure, step, surface]);

  useEffect(() => {
    // A phone rotating, or the keyboard opening and closing, moves everything
    // this file has measured.
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [measure]);

  // The caption's own height decides which side of the hole it can sit on, so
  // it has to be measured rather than guessed. Only committed when it has
  // actually changed, or this would re-render on every pass.
  useLayoutEffect(() => {
    const node = captionRef.current;
    if (!node) return;
    const height = node.getBoundingClientRect().height;
    setCaptionHeight((previous) => (Math.abs(previous - height) > 1 ? height : previous));
  }, [index]);

  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
  const side = rect ? captionSide(rect, viewportHeight, captionHeight, GAP) : 'below';

  const captionPosition: React.CSSProperties = !rect
    ? { top: '50%', transform: 'translateY(-50%)' }
    : side === 'below'
      ? { top: Math.round(rect.top + rect.height + GAP) }
      : { bottom: Math.round(viewportHeight - rect.top + GAP) };

  const advance = () => {
    if (isLast) onFinish();
    else setIndex((i) => i + 1);
  };

  if (!step) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="How Covault works"
      className={`fixed inset-0 z-[300] overflow-hidden ${
        surface === 'live' ? '' : 'bg-slate-50 dark:bg-slate-950'
      }`}
    >
      {surface === 'demo' && <TourDemoScreen />}

      {/* The dim, with the hole in it. */}
      {rect ? (
        <div
          className="absolute pointer-events-none motion-safe:transition-all motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)]"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            borderRadius: step.radius,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.78)',
            outline: '2px solid rgba(16, 185, 129, 0.55)',
            outlineOffset: '2px',
          }}
        />
      ) : (
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundColor: 'rgba(2, 6, 23, 0.78)' }} />
      )}

      {/* The caption. */}
      <div
        ref={captionRef}
        style={captionPosition}
        className="absolute left-4 right-4 lg:left-1/2 lg:right-auto lg:w-[26rem] lg:-translate-x-1/2 motion-safe:transition-all motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)]"
      >
        <div className="rounded-[2rem] bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/60 ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] shadow-2xl p-6 space-y-3">
          {/* The demo screen's figures are invented, and something on screen
              has to say so. It rides on the caption because every corner of
              the dashboard it draws is already occupied. Absent in live mode,
              where the numbers behind the hole are the user's own. */}
          {surface === 'demo' && (
            <span className="inline-block px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Example figures
            </span>
          )}
          <h2 className="text-lg font-bold tracking-tight text-slate-700 dark:text-slate-100">
            {step.title}
          </h2>
          <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            {step.body}
          </p>

          <div className="flex items-center justify-between pt-2">
            <div className="flex space-x-2" aria-hidden="true">
              {TOUR_STEPS.map((s, i) => (
                <div
                  key={s.target}
                  className={`h-1.5 rounded-full motion-safe:transition-all motion-safe:duration-[320ms] ${
                    i === index ? 'w-6 bg-slate-300 dark:bg-slate-700' : 'w-1.5 bg-slate-200 dark:bg-slate-800'
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {index > 0 && (
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  className="px-4 py-2.5 rounded-2xl text-[12px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 active:scale-[0.97] transition-all duration-200"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={advance}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl text-[12px] font-semibold tracking-wide shadow-lg shadow-emerald-500/30 active:scale-[0.97] transition-all duration-200"
              >
                {isLast ? finishLabel : 'Next'}
              </button>
            </div>
          </div>
        </div>

        {!isLast && (
          <div className="text-center pt-3">
            <button
              type="button"
              onClick={onFinish}
              className="text-[11px] font-medium tracking-wide text-white/60 hover:text-white/90 transition-colors"
            >
              Skip the tour
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GuidedTour;
