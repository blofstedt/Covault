import type React from 'react';

/**
 * Where the ⋮ is on the App info page.
 *
 * The two notification-access steps land on the exact toggle they are talking
 * about, so they need no picture. This step cannot: "Allow restricted settings"
 * lives inside Android's own overflow menu, and no intent, extra or flag opens
 * a menu or points at an item inside one — the platform simply does not expose
 * it. A drawing of where to tap is the whole of what any app can do here, which
 * is why every app that asks for this permission draws one.
 *
 * Deliberately a sketch and not a screenshot: it has to be right on a phone
 * whose Settings look nothing like the one this was written on, and a wrong
 * screenshot is more confusing than an obviously schematic one.
 */
const AppInfoSketch: React.FC = () => (
  <div
    aria-hidden="true"
    className="mt-2 rounded-xl border border-amber-200/80 dark:border-amber-800/50 bg-white/70 dark:bg-slate-900/40 p-2"
  >
    <div className="flex items-center justify-between">
      <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 tracking-wide">
        App info
      </span>
      <span className="relative flex items-center justify-center w-5 h-5">
        {/* The same pulse the app uses elsewhere to say "here", on the app's
            own clock rather than a faster one of its own. */}
        <span className="absolute inset-0 rounded-full bg-amber-400/40 motion-safe:animate-ping" />
        <span className="relative flex flex-col items-center justify-center gap-[2px] w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/50 ring-1 ring-amber-400 dark:ring-amber-600">
          <span className="w-[2px] h-[2px] rounded-full bg-amber-700 dark:bg-amber-300" />
          <span className="w-[2px] h-[2px] rounded-full bg-amber-700 dark:bg-amber-300" />
          <span className="w-[2px] h-[2px] rounded-full bg-amber-700 dark:bg-amber-300" />
        </span>
      </span>
    </div>
    <div className="mt-1.5 ml-auto w-[70%] rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-800/40 px-2 py-1">
      <span className="text-[9px] font-semibold text-amber-800 dark:text-amber-200">
        Allow restricted settings
      </span>
    </div>
  </div>
);

export default AppInfoSketch;
