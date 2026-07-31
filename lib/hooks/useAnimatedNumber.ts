// lib/hooks/useAnimatedNumber.ts
import { useEffect, useRef, useState } from 'react';

/**
 * Tween a number toward its new value instead of snapping.
 *
 * Used for the balance, remaining, and budget totals — the figures that change
 * when a transaction lands. A number that counts is the cheapest way to make a
 * data change feel like something happened rather than a re-render.
 *
 * Deliberately not a spring: money should arrive at its value and stop, not
 * overshoot past it. Overshooting $412.60 to $418 and back reads as a glitch.
 */

/** Ease-out cubic — fast start, gentle landing. */
export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Value at `elapsed` ms into a tween. Pure, so the timing curve is testable
 * without a DOM or a clock.
 */
export function tweenValue(from: number, to: number, elapsed: number, durationMs: number): number {
  if (durationMs <= 0 || elapsed >= durationMs) return to;
  if (elapsed <= 0) return from;
  return from + (to - from) * easeOutCubic(elapsed / durationMs);
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface UseAnimatedNumberOptions {
  durationMs?: number;
  /**
   * Skip the tween below this delta. Without it, a rounding-level change
   * triggers a 600ms animation nobody asked for, and rapid small updates queue
   * up into visible stutter.
   */
  minDelta?: number;
}

/**
 * Returns a value that animates toward `target`.
 *
 * Snaps instantly on first render (no count-up from zero when a screen opens —
 * that reads as a loading state), when reduced motion is set, and for changes
 * below `minDelta`.
 */
export function useAnimatedNumber(
  target: number,
  { durationMs = 600, minDelta = 0.01 }: UseAnimatedNumberOptions = {},
): number {
  const [value, setValue] = useState(target);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef(target);
  const startedRef = useRef(false);

  useEffect(() => {
    const safeTarget = Number.isFinite(target) ? target : 0;

    // First value, tiny change, or reduced motion → straight there.
    if (
      !startedRef.current ||
      prefersReducedMotion() ||
      Math.abs(safeTarget - fromRef.current) < minDelta
    ) {
      startedRef.current = true;
      fromRef.current = safeTarget;
      setValue(safeTarget);
      return;
    }

    const from = fromRef.current;
    const startedAt = performance.now();

    const step = () => {
      const elapsed = performance.now() - startedAt;
      const next = tweenValue(from, safeTarget, elapsed, durationMs);
      setValue(next);
      if (elapsed < durationMs) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        frameRef.current = null;
        fromRef.current = safeTarget;
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      // Hand the next tween a truthful starting point even if this one was
      // interrupted mid-flight, so a fast sequence of updates stays continuous
      // instead of jumping back to the last settled value.
      fromRef.current = value;
    };
    // `value` is deliberately not a dependency — it changes every frame, and
    // depending on it would restart the tween on each one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs, minDelta]);

  return value;
}
