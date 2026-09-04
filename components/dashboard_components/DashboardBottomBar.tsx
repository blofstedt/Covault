import React, { useEffect, useRef, useState } from 'react';

interface DashboardBottomBarProps {
  onGoHome: () => void;
  onAddTransaction: () => void;
  onOpenParsing: () => void;
  activeView?: 'home' | 'parsing';
  pendingCount?: number;
}

const DashboardBottomBar: React.FC<DashboardBottomBarProps> = ({
  onGoHome,
  onAddTransaction,
  onOpenParsing,
  activeView = 'home',
  pendingCount = 0,
}) => {
  // Pop the badge when the count goes UP only. Popping on the way down would
  // celebrate the user clearing their queue by drawing their eye back to it.
  const [pop, setPop] = useState(false);
  const previousCount = useRef(pendingCount);
  useEffect(() => {
    const rose = pendingCount > previousCount.current;
    previousCount.current = pendingCount;
    if (!rose) return;
    setPop(true);
    // Matches the badge-pop keyframe duration in tailwind.config.js. Clearing
    // the class is what lets it re-trigger on the next arrival.
    const t = setTimeout(() => setPop(false), 450);
    return () => clearTimeout(t);
  }, [pendingCount]);

  return (
    <div
      id="bottom-bar"
      className="fixed bottom-0 left-0 right-0 z-40 h-[calc(env(safe-area-inset-bottom,0px)+5rem)] px-6 flex items-center justify-center pointer-events-none"
    >
      <div
        // No `backdrop-blur` here either. This pill is `fixed` and overlaps
        // the budget list, so a 64px backdrop-filter through a `rounded-full`
        // clip had to be recomputed on every frame that the list beneath it
        // moved — i.e. for the whole budget expand. /90 -> /95 keeps the same
        // frosted reading. `transition-all duration-700` is narrowed to the
        // colour properties it actually animates (theme changes).
        className={`w-4/5 lg:w-1/3 border rounded-full px-3 py-1.5 lg:px-6 lg:py-2.5 pointer-events-auto shadow-2xl ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] transition-[background-color,border-color] duration-700 bg-white/95 dark:bg-slate-900/95 border-slate-100 dark:border-slate-800/60`}
      >
        <div className="flex items-center justify-evenly gap-3 lg:gap-0 w-full">
          {/* Home Button */}
          <button
            onClick={onGoHome}
            className={`p-3 rounded-full transition-all duration-200 active:scale-[0.97] ${
              activeView === 'home'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400'
            }`}
            aria-label="Go to home"
          >
            {/* Selected is a HIGHLIGHT, never a fill: the same drawing, in the
                accent colour, one weight heavier and a touch larger — exactly
                what the review icon on the other side does. Filling one of the
                two made them read as two different sets of icons. */}
            <svg
              className={`w-6 h-6 motion-safe:transition-transform motion-safe:duration-[350ms] motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)] ${activeView === 'home' ? 'scale-110' : 'scale-100'}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={activeView === 'home' ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-slate-200/60 dark:bg-slate-700/40" />

          {/* Add Transaction Button */}
          <button
            id="add-transaction-button"
            onClick={onAddTransaction}
            className="p-3 mx-1 text-white rounded-full shadow-lg flex items-center justify-center active:scale-[0.97] transition-all duration-200 bg-emerald-600 dark:bg-emerald-500 hover:bg-emerald-700 dark:hover:bg-emerald-600 shadow-emerald-500/20"
            aria-label="Add transaction"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Divider */}
          <div className="w-px h-6 bg-slate-200/60 dark:bg-slate-700/40" />

          {/* Parsing Button */}
          <button
            onClick={onOpenParsing}
            className={`relative p-3 rounded-full transition-all duration-200 active:scale-[0.97] ${
              activeView === 'parsing'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400'
            }`}
            aria-label="Open review"
          >
            <svg
              className={`w-6 h-6 motion-safe:transition-transform motion-safe:duration-[350ms] motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)] ${activeView === 'parsing' ? 'scale-110' : 'scale-100'}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={activeView === 'parsing' ? 2.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
            {pendingCount > 0 && (
              <span className={`absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-600 text-white text-[11px] font-black flex items-center justify-center ${pop ? 'motion-safe:animate-badge-pop' : ''}`}>
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DashboardBottomBar;
