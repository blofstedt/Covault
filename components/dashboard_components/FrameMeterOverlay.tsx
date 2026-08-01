import React from 'react';
import type { FrameMeterReading } from '../../lib/hooks/useFrameMeter';

interface FrameMeterOverlayProps {
  reading: FrameMeterReading | null;
}

/** Short SHA of the build, injected by vite.config.ts. */
const BUILD_SHA: string =
  (import.meta as { env?: { VITE_BUILD_SHA?: string } }).env?.VITE_BUILD_SHA || 'dev';

/**
 * Diagnostic readout for the budget expand animation, shown only when the user
 * turns the frame meter on in settings.
 *
 * Exists so a report can be "worst 48ms, 22/38 dropped, build 58f7b93" instead
 * of "it's still choppy" — the latter having cost three rounds of guessing.
 * The build SHA is on the same chip on purpose: a frame number is meaningless
 * without knowing which APK produced it.
 *
 * Intentionally plain: no blur, no shadow, no transition. This element is on
 * screen *while* the thing it measures is animating, and it must not become
 * part of the cost.
 */
const FrameMeterOverlay: React.FC<FrameMeterOverlayProps> = ({ reading }) => {
  // 120Hz phones have an 8.3ms budget, 60Hz ones 16.7ms. Judge against 60Hz so
  // the meter does not cry wolf on a device that was never going to hit 120.
  const isBad = reading != null && (reading.worstMs > 33 || reading.dropped > reading.total / 4);

  return (
    <div
      className="fixed left-2 z-[60] pointer-events-none font-mono text-[10px] leading-tight px-2 py-1 rounded-md text-white"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5.5rem)',
        backgroundColor: reading == null ? 'rgba(30,41,59,0.85)' : isBad ? 'rgba(190,18,60,0.9)' : 'rgba(5,150,105,0.9)',
      }}
      aria-hidden="true"
    >
      {reading == null ? (
        <span>tap a budget to measure · {BUILD_SHA}</span>
      ) : (
        <span>
          worst {reading.worstMs}ms · {reading.dropped}/{reading.total} dropped · {BUILD_SHA}
        </span>
      )}
    </div>
  );
};

export default FrameMeterOverlay;
