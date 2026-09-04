import React from 'react';
import { longMonthLabel, type MonthRelation } from '../../lib/monthWindow';

interface MonthViewBannerProps {
  monthKey: string;
  relation: MonthRelation;
  onReturnToCurrentMonth: () => void;
}

/**
 * The line that says you are not looking at this month.
 *
 * Every figure below it — the vials, the amounts left, the headline balance —
 * is drawn exactly as it is for the current month, because it is the same
 * screen. That is the point of browsing back, and it is also the danger: a
 * March vial that says "$210 left" is a fact about a month that ended, and
 * nothing in the bar itself says so.
 *
 * So the banner is deliberately in the flow rather than floating: it takes a
 * row of its own directly above the vials, where it cannot be read past. It is
 * also the way back, because the two things a user wants here are "what is
 * this?" and "get me out", and they should not be in different places.
 *
 * Slate, not amber. Nothing is wrong — the user asked for this month — and the
 * app's amber is what a bank going quiet looks like.
 */
const MonthViewBanner: React.FC<MonthViewBannerProps> = ({
  monthKey,
  relation,
  onReturnToCurrentMonth,
}) => {
  const isPast = relation === 'past';

  return (
    <div className="mx-4 lg:mx-6 mb-2 flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-100/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/50">
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[11px] font-bold tracking-wide text-slate-600 dark:text-slate-200 truncate">
          {longMonthLabel(monthKey)}
        </p>
        <p className="text-[10px] font-semibold tracking-wide text-slate-400 dark:text-slate-500 truncate">
          {isPast ? 'Finished — nothing here is still moving' : 'Charges Covault expects, not money spent'}
        </p>
      </div>

      <button
        type="button"
        onClick={onReturnToCurrentMonth}
        className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-500/15 dark:bg-emerald-400/15 active:scale-[0.97] transition-all duration-200"
      >
        Back to now
      </button>
    </div>
  );
};

export default MonthViewBanner;
