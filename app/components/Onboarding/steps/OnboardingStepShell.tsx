import React from 'react';

interface OnboardingStepShellProps {
  title: string;
  subtitle?: string;
  /** How far through, for the dots. 1-based. */
  stepNumber: number;
  stepCount: number;
  children: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** Omitted on a step there is nothing to skip past. */
  onSkip?: () => void;
  skipLabel?: string;
}

/**
 * The frame every setup step in the intro is drawn in.
 *
 * Three things it exists to guarantee, none of which the old intro needed:
 *
 *  - **A body that scrolls.** The budget step is seven rows plus a header and
 *    does not fit a small phone. The intro was three centred slides and had no
 *    provision for content taller than the screen.
 *  - **A footer that clears the home bar.** Sticky, and offset by the device's
 *    safe-area inset, so the primary action is never under the gesture bar.
 *  - **A way past.** Every step that asks for something can be skipped, and
 *    says where to find it later. A first-run flow that can trap somebody is
 *    worse than no first-run flow at all: today the intro is three harmless
 *    slides, and it must not become the thing standing between a new user and
 *    their app.
 */
const OnboardingStepShell: React.FC<OnboardingStepShellProps> = ({
  title,
  subtitle,
  stepNumber,
  stepCount,
  children,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  onSkip,
  skipLabel = 'Skip for now',
}) => (
  <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors relative overflow-hidden">
    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-8 pt-12 pb-4">
      <div className="animate-nest space-y-2 text-center">
        <h2 className="text-3xl font-bold text-slate-600 dark:text-slate-100 tracking-tighter leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-slate-400 dark:text-slate-500 font-medium text-sm tracking-wide leading-relaxed max-w-xs mx-auto">
            {subtitle}
          </p>
        )}
      </div>

      <div className="mt-8 animate-nest" style={{ animationDelay: '0.1s' }}>
        {children}
      </div>
    </div>

    <div className="shrink-0 px-8 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] bg-slate-50 dark:bg-slate-950 space-y-3">
      <div className="flex justify-center space-x-2">
        {Array.from({ length: stepCount }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i === stepNumber - 1 ? 'w-8 bg-emerald-600' : 'w-1.5 bg-slate-200 dark:bg-slate-800'
            }`}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="w-full py-5 bg-emerald-600 text-white rounded-[2rem] font-semibold text-base shadow-2xl shadow-emerald-500/20 active:scale-[0.97] disabled:opacity-30 transition-all duration-200 tracking-wide"
      >
        {primaryLabel}
      </button>

      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="w-full text-slate-400 dark:text-slate-600 font-medium text-[11px] tracking-wide hover:text-emerald-500 transition-colors"
        >
          {skipLabel}
        </button>
      )}

      <p className="text-center text-slate-300 dark:text-slate-700 font-medium text-[10px] tracking-wide">
        You can always change this in Settings.
      </p>
    </div>
  </div>
);

export default OnboardingStepShell;
