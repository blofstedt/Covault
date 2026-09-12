import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import TourDemoScreen from './TourDemoScreen';
import {
  stepsForSurface,
  captionTop,
  spotlightRect,
  unionRects,
  type TargetRect,
  type TourStage,
} from '../../lib/tourSteps';
import { useEscapeKey } from '../../lib/hooks/useEscapeKey';

/**
 * The walkthrough: a spotlight over the app, driving the app as it goes.
 *
 * It points at the REAL screen. It used to draw its own likeness of a
 * dashboard and spotlight that instead, and the likeness drifted — a
 * left-aligned balance where the real one is centred, a row of month names
 * where the real one has a chart, no search field at all — so someone who
 * knew the app was shown a worse copy of a screen they were already looking
 * at. A copy of a screen is a second screen to maintain, and the only thing
 * it can do is fall behind.
 *
 * It also moves the app. Each step names a `stage`, and when the stage
 * changes the host is asked to put the app there — open a vial, open the
 * review page, open the settings menu — before the next hole is measured. So
 * the expand animation the tour describes is the real expand, and the menu it
 * walks through is the user's own, with their switches in the positions they
 * left them.
 *
 * Two surfaces, both the actual app:
 *
 *   - `surface="live"` (from Settings) dims what is already mounted behind
 *     this overlay and cuts a hole in it, and drives it through `onStage`.
 *   - `surface="demo"` (the last step of the intro) renders
 *     `TourDemoScreen` — the same dashboard components fed example figures,
 *     because during the intro there is no app behind the tour yet. It shows
 *     only the steps that screen can honestly stand in for; see `DEMO_STAGES`.
 *
 * Taps never reach the app underneath: this root is a full-screen element
 * with pointer events ON, so it swallows everything that is not one of its
 * own buttons. That is what stops a stray thumb writing a real transaction or
 * flipping a real setting mid-sentence.
 *
 * The dim is one element with an enormous spread shadow rather than four
 * rectangles around the hole. Four elements have to be kept in agreement on
 * every step, and any disagreement shows as a seam of un-dimmed screen; one
 * element cannot disagree with itself. It moves on the app's own 320ms curve.
 */

interface GuidedTourProps {
  /** Called when the tour is finished, skipped, or dismissed. */
  onFinish: () => void;
  /** Label for the last step's button. The intro says "Let's go". */
  finishLabel?: string;
  /**
   * What the spotlight is cut out of. "live" points at the app already
   * mounted behind this overlay; "demo" draws one from example figures, for
   * the intro, where there is no app yet.
   */
  surface?: 'live' | 'demo';
  /**
   * Put the app into this stage. Live surface only — the demo screen is told
   * directly. Called when the stage changes and on the first step, so the
   * host does not have to guess where the tour starts.
   */
  onStage?: (stage: TourStage) => void;
}

/** Used until the caption has been measured. Roughly a three-line caption. */
const CAPTION_HEIGHT_ESTIMATE = 168;
const GAP = 16;

/**
 * How long to keep re-measuring after a step changes.
 *
 * One measurement is not enough, and the reason is the app itself: the
 * balance block arrives on `animate-nest`, the figure counts up to its value
 * (which changes its WIDTH as digits land), the chart is a lazy chunk that
 * appears whenever it appears, a vial takes 320ms to open, and the settings
 * menu is a modal that zooms in over 500ms and then has to be scrolled to the
 * section in question. Measuring once, on the frame the step changed, pinned
 * the hole to wherever the screen happened to be mid-arrival — which is how
 * the first step ended up with its ring drawn through the middle of the
 * number it was pointing at.
 *
 * The loop stops early once the rectangle has held still, so a step that
 * changes nothing costs a handful of frames; `SETTLE_FLOOR_MS` keeps it from
 * declaring victory during the pause before a smooth scroll starts moving.
 */
const SETTLE_MS = 2200;
const SETTLE_FLOOR_MS = 900;
const STABLE_FRAMES = 4;

function sameRect(a: TargetRect | null, b: TargetRect | null): boolean {
  if (!a || !b) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

const GuidedTour: React.FC<GuidedTourProps> = ({
  onFinish,
  finishLabel = 'Done',
  surface = 'demo',
  onStage,
}) => {
  const steps = useMemo(() => stepsForSurface(surface), [surface]);

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [captionHeight, setCaptionHeight] = useState(CAPTION_HEIGHT_ESTIMATE);

  const rootRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  /** Which step we have already scrolled for, so a smooth scroll is not
   *  restarted on every frame of the settle loop. */
  const scrolledFor = useRef(-1);

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const stage: TourStage = step?.stage ?? 'home';

  useEscapeKey(onFinish);

  // Move the app to where this step is talking about. Before measuring, and
  // only when the stage actually CHANGES — asking for "home" again on every
  // home step would close a vial the user is being shown, and the host's
  // callback is rebuilt whenever its own data reloads, which would otherwise
  // reset the screen under the user mid-step.
  const onStageRef = useRef(onStage);
  onStageRef.current = onStage;
  const appliedStage = useRef<TourStage | null>(null);
  useEffect(() => {
    if (surface !== 'live') return;
    if (appliedStage.current === stage) return;
    appliedStage.current = stage;
    onStageRef.current?.(stage);
  }, [surface, stage]);

  const findTargets = useCallback((): HTMLElement[] => {
    const root = rootRef.current;
    if (!root || !step) return [];
    // In live mode the targets are in the app behind this overlay, which is a
    // sibling rather than a child — so the search starts at the document. In
    // demo mode they are inside this root, and scoping to the root is what
    // stops a step matching the real dashboard by accident.
    const scope: ParentNode = surface === 'live' ? document : root;
    return Array.from(scope.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`));
  }, [step, surface]);

  const measure = useCallback(
    (clearIfMissing: boolean) => {
      if (!step) return;
      const targets = findTargets();
      if (targets.length === 0) {
        // A step pointing at nothing still has to read as something. Dropping
        // the rect dims the whole screen and centres the caption, which says
        // the words without claiming to point anywhere.
        //
        // But not straight away: a stage change unmounts one screen and mounts
        // another, and clearing on the frame in between makes the whole screen
        // flash black between every section. The settle loop only allows the
        // clear once it has given the new screen its full window to appear.
        if (clearIfMissing) setRect(null);
        return;
      }

      const union = unionRects(
        targets.map((target) => {
          const box = target.getBoundingClientRect();
          return { top: box.top, left: box.left, width: box.width, height: box.height };
        }),
      );
      if (!union) {
        if (clearIfMissing) setRect(null);
        return;
      }

      const next = spotlightRect(
        union,
        { width: window.innerWidth, height: window.innerHeight },
        step.pad,
      );
      // Only commit a real change: the settle loop below measures every frame,
      // and re-rendering on each of them would put the hole's own 320ms
      // transition back to the start of its curve on every one.
      setRect((previous) => (sameRect(previous, next) ? previous : next));
    },
    [findTargets, step],
  );

  // After layout, not after paint: measuring in `useEffect` lets one frame
  // through with the hole in its previous place, which reads as the spotlight
  // lagging a step behind the words.
  useLayoutEffect(() => {
    measure(false);
  }, [measure]);

  // Then keep measuring until the screen underneath has stopped moving, and
  // bring the target into view if it is off screen — the settings menu is a
  // long scroller and most of what the tour names there starts below the fold.
  useEffect(() => {
    let frame = 0;
    let stable = 0;
    let last: TargetRect | null = null;
    let scrolled = false;
    const started = performance.now();

    const tick = () => {
      const targets = findTargets();
      const union = unionRects(
        targets.map((target) => {
          const box = target.getBoundingClientRect();
          return { top: box.top, left: box.left, width: box.width, height: box.height };
        }),
      );

      if (union && !scrolled && scrolledFor.current !== index) {
        const offScreen = union.top < GAP || union.top + union.height > window.innerHeight - GAP;
        if (offScreen) {
          targets[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        scrolled = true;
        scrolledFor.current = index;
      }

      const held = sameRect(union, last);
      stable = held ? stable + 1 : 0;
      last = union;

      const elapsed = performance.now() - started;
      const settled = stable >= STABLE_FRAMES && elapsed >= SETTLE_FLOOR_MS;
      const expired = elapsed >= SETTLE_MS;

      measure(settled || expired);

      if (!settled && !expired) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [measure, findTargets, index]);

  useEffect(() => {
    // A phone rotating, or the keyboard opening and closing, moves everything
    // this file has measured.
    const onResize = () => measure(true);
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

  const captionPosition: React.CSSProperties = !rect
    ? { top: '50%', transform: 'translateY(-50%)' }
    : { top: captionTop(rect, viewportHeight, captionHeight, GAP) };

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
      {surface === 'demo' && <TourDemoScreen stage={stage} />}

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

          {/* Progress on its own line, the controls under it.

              "Skip the tour" used to float on the dim below the card. That
              worked while every highlight was a button; once the walkthrough
              started pointing at whole cards the caption had to be allowed to
              overlap them, and a line of white-on-nothing text landed on top
              of a lit-up row of purchases, where it could not be read at all.
              Inside the card it is legible wherever the card goes. */}
          <div className="pt-2 space-y-3">
            {/* A bar rather than a dot per step. The walkthrough replayed from
                Settings is twenty steps long — twenty dots do not fit beside
                the buttons on a phone, and even if they did, nobody counts
                dots. A bar says how far along you are at any length. */}
            <div className="flex items-center gap-2" aria-hidden="true">
              <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-slate-300 dark:bg-slate-700 motion-safe:transition-[width] motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)]"
                  style={{ width: `${((index + 1) / steps.length) * 100}%` }}
                />
              </div>
              <span className="shrink-0 text-[10px] font-bold tracking-wide text-slate-300 dark:text-slate-600 tabular-nums">
                {index + 1}/{steps.length}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              {isLast ? (
                <span />
              ) : (
                <button
                  type="button"
                  onClick={onFinish}
                  className="px-1 py-2.5 text-[11px] font-medium tracking-wide text-slate-400 dark:text-slate-500 active:scale-[0.97] transition-all duration-200"
                >
                  Skip the tour
                </button>
              )}

              <div className="flex items-center gap-2 shrink-0">
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
        </div>
      </div>
    </div>
  );
};

export default GuidedTour;
