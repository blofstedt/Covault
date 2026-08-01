// lib/hooks/useFrameMeter.ts
//
// Measures how many frames the app actually drops during an animation, and
// shows the answer inside the app.
//
// Why this exists: the budget expand was reported as choppy on a Pixel 9 and
// smooth on desktop, and three rounds of fixes were shipped on reasoning alone
// because there was no way to measure it. `chrome://inspect` needs a laptop and
// a USB cable, and `log.debug` is compiled out of release builds
// (`import.meta.env.PROD` — see lib/log.ts), so the phone could not report a
// frame time by any route.
//
// Deliberately NOT always on. An idle requestAnimationFrame loop is itself a
// cost on a battery-powered device, and one running during the animation it is
// measuring would skew the result. `arm()` starts a loop that stops on its own.

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'covault_frame_meter';

/** A 120Hz display gives 8.33ms per frame; 60Hz gives 16.67ms. */
const SMOOTH_FRAME_MS = 16.7;

export interface FrameMeterReading {
  /** Longest single gap between frames, in ms. The headline number. */
  worstMs: number;
  /** Frames that took longer than one 60Hz frame. */
  dropped: number;
  /** Total frames observed while armed. */
  total: number;
  /** Wall-clock length of the measured window, in ms. */
  durationMs: number;
}

/** Whether the user has switched the meter on. Read from localStorage. */
export function isFrameMeterEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setFrameMeterEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / storage disabled. The meter is a diagnostic; losing the
    // preference is not worth throwing over.
  }
}

/**
 * Returns `[reading, arm]`. Call `arm()` at the start of an interaction; the
 * loop samples for `windowMs` and then publishes a reading.
 *
 * When `enabled` is false this is inert — no loop is ever scheduled — so it is
 * safe to call unconditionally from a component.
 */
export function useFrameMeter(
  enabled: boolean,
  windowMs = 600,
): [FrameMeterReading | null, () => void] {
  const [reading, setReading] = useState<FrameMeterReading | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    runningRef.current = false;
  }, []);

  const arm = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return;
    // Re-arming mid-measurement restarts the window rather than running two
    // loops — tapping budgets quickly should not compound the cost.
    stop();

    runningRef.current = true;
    const startedAt = performance.now();
    let last = startedAt;
    let worstMs = 0;
    let dropped = 0;
    let total = 0;

    const step = (now: number) => {
      if (!runningRef.current) return;

      const delta = now - last;
      last = now;
      total += 1;
      if (delta > worstMs) worstMs = delta;
      if (delta > SMOOTH_FRAME_MS) dropped += 1;

      if (now - startedAt < windowMs) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      rafRef.current = null;
      runningRef.current = false;
      setReading({
        worstMs: Math.round(worstMs),
        dropped,
        total,
        durationMs: Math.round(now - startedAt),
      });
    };

    rafRef.current = requestAnimationFrame(step);
  }, [enabled, windowMs, stop]);

  // Never leave a loop running behind an unmounted component.
  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  return [reading, arm];
}
