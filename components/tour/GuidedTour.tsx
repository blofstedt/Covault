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
 * The walkthrough: a spotlight moving over a demo dashboard.
 *
 * Two jobs, deliberately kept apart from the screen it points at. This file
 * measures a target, draws the hole, places the caption and moves between
 * steps; `TourDemoScreen` decides what is under the hole; `lib/tourSteps.ts`
 * holds the words and the geometry rules. None of the three knows anything
 * about the real dashboard, which is why the tour cannot break capture, write
 * a transaction, or go stale when the dashboard's internals change.
 *
 * It covers the whole screen rather than sitting over the live app. That is
 * what lets it be shown from two completely different places — the last step
 * of the intro, and a button in Settings — with no arrangement between them.
 *
 * The dim is one element with an enormous spread shadow rather than four
 * rectangles around the hole. Four elements have to be kept in agreement on
 * every step, and any disagreement shows as a seam of un-dimmed screen; one
 * element cannot disagree with itself. It moves on the app's own 320ms curve,
 * and only when the step changes — the screen underneath it is completely
 * static, so nothing is being animated over.
 */

interface GuidedTourProps {
  /** Called when the tour is finished, skipped, or dismissed. */
  onFinish: () => void;
  /** Label for the last step's button. The intro says "Let's go". */
  finishLabel?: string;
}

/** Used until the caption has been measured. Roughly a three-line caption. */
const CAPTION_HEIGHT_ESTIMATE = 168;
const GAP = 16;

const GuidedTour: React.FC<GuidedTourProps> = ({ onFinish, finishLabel = 'Done' }) => {
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
    const target = root.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!target) {
      // A step pointing at nothing still has to read as something. Dropping
      // the rect dims the whole screen and centres the caption, which says
      // the words without claiming to point anywhere. `tourSteps.test.ts`
      // exists so this is never reached in a shipped build.
      setRect(null);
      return;
    }
    const box = target.getBoundingClientRect();
    setRect(
      spotlightRect(
        { top: box.top, left: box.left, width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [step]);

  // After layout, not after paint: measuring in `useEffect` lets one frame
  // through with the hole in its previous place, which reads as the spotlight
  // lagging a step behind the words.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

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
      className="fixed inset-0 z-[300] overflow-hidden bg-slate-50 dark:bg-slate-950"
    >
      <TourDemoScreen />

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
