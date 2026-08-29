import React from 'react';
import type { AppUpdate } from '../lib/hooks/useAppUpdate';

/**
 * "A new version is ready" — as a pill above the bottom bar rather than a
 * modal.
 *
 * An update is never urgent enough to stand between someone and their money,
 * so it takes the same shape as the navigation pill it sits above: same width,
 * same radius, same surface, same emerald. Deliberately no `backdrop-blur` —
 * it is `fixed` over the budget list, and blurring through a `rounded-full`
 * clip is recomputed on every frame the list moves.
 *
 * Progress fills the pill from the left using `scaleX`, not `width`: a width
 * transition is a layout property and re-lays out the row on every frame.
 */
const UpdateBanner: React.FC<AppUpdate> = ({
  update,
  phase,
  percent,
  error,
  install,
  dismiss,
  webUpdateReady,
  applyWebUpdate,
  apkReady,
}) => {
  // Two things wear this pill. An APK update, which costs a download and
  // Android's own confirmation, and a web bundle that is already on the phone
  // and one tap from being live. The APK takes precedence: it is the rarer
  // one, and it is the one that cannot happen by itself.
  const waiting = !update && webUpdateReady !== null;

  if (!update && !waiting) return null;

  const busy = phase !== 'idle';
  // The APK is already on the phone, so the tap is the whole of what is left:
  // Android's confirmation and nothing else. Promising a download that has
  // already happened is how a one-second action gets put off for a week.
  const downloaded = !!update && apkReady === update.versionCode;

  const title = waiting
    ? `Covault 1.0.${webUpdateReady} is ready`
    : phase === 'installing'
      ? 'Opening the installer'
      : phase === 'downloading'
        ? `Downloading ${percent}%`
        : `Covault ${update!.versionName} is ready`;

  const subtitle =
    error ??
    (waiting
      ? 'Tap restart to switch to it now'
      : phase === 'installing'
        ? 'Confirm the update when Android asks'
        : phase === 'downloading'
          ? 'Keep Covault open until it finishes'
          : downloaded
            ? 'Downloaded — one tap and Android takes it from here'
            : update!.notes || 'Tap update to install the newest build');

  return (
    <div
      className="fixed left-0 right-0 z-[110] px-6 flex justify-center pointer-events-none bottom-[calc(env(safe-area-inset-bottom,0px)+5.75rem)]"
      role="status"
    >
      <div className="relative w-4/5 lg:w-1/3 overflow-hidden rounded-full border pointer-events-auto shadow-2xl ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] bg-white/95 dark:bg-slate-900/95 border-slate-100 dark:border-slate-800/60 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-300">
        {/* The fill sits behind the row and only exists mid-download. */}
        {phase === 'downloading' && (
          <div
            aria-hidden="true"
            className="absolute inset-0 origin-left bg-emerald-500/10 dark:bg-emerald-400/10 motion-safe:transition-transform motion-safe:duration-[320ms] motion-safe:ease-[cubic-bezier(0.32,0.72,0.24,1)]"
            style={{ transform: `scaleX(${Math.max(0, Math.min(100, percent)) / 100})` }}
          />
        )}

        <div className="relative flex items-center gap-3 px-4 py-2.5 lg:px-5 lg:py-3">
          <div className="w-9 h-9 shrink-0 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
            <svg
              className={`w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400 ${busy ? 'motion-safe:animate-pulse' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <polyline points="21 3 21 9 15 9" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-slate-600 dark:text-slate-100 tracking-tight truncate">
              {title}
            </p>
            <p
              className={`text-[11px] font-medium truncate ${
                error
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              {subtitle}
            </p>
          </div>

          {!busy && (
            <>
              <button
                type="button"
                onClick={waiting ? applyWebUpdate : install}
                className="shrink-0 px-3.5 py-2 rounded-full bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-600 text-white text-xs font-semibold tracking-wide active:scale-[0.97] transition-all duration-200 shadow-lg shadow-emerald-500/20"
              >
                {waiting ? 'Restart' : downloaded ? 'Install' : 'Update'}
              </button>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Not now"
                className="shrink-0 p-1.5 rounded-full text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors duration-200"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default UpdateBanner;
