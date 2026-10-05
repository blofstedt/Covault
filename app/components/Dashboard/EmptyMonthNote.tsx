import React from 'react';

/**
 * What an empty month means, said once, where the emptiness is.
 *
 * A month with nothing in it is the first thing a new user sees after setup,
 * and it is indistinguishable from a month where capture is broken: seven
 * vials at zero, no list, no explanation. They have just been told purchases
 * will appear on their own, so silence reads as a failure rather than as a
 * quiet Tuesday.
 *
 * Only on the current month, and only while capture is on. On a past month the
 * MonthViewBanner already says which month is being read, and with capture off
 * the nudge above it is already saying the more urgent thing — two notices
 * stacked would push the vials down and say less than either alone.
 */
const EmptyMonthNote: React.FC = () => (
  <div className="mx-4 lg:mx-6 mb-2 px-4 py-3 rounded-2xl bg-white/60 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800/60">
    <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide leading-relaxed">
      Nothing spent this month yet.
    </p>
    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed mt-1">
      Purchases land here on their own when your bank announces them — check
      them in Review first. Cash and anything your bank stays quiet about goes
      in with the + button.
    </p>
  </div>
);

export default EmptyMonthNote;
