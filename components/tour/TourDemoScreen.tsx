import React from 'react';
import { getBudgetIcon } from '../dashboard_components/getBudgetIcon';
import { getBudgetColor } from '../../lib/budgetColors';
import { buildMonthWindow, shortMonthName } from '../../lib/monthWindow';
import { getLocalMonthKey, getLocalToday } from '../../lib/dateUtils';

/**
 * A dashboard that has been used for a while, drawn from constants.
 *
 * The walkthrough needs something to point at, and the real dashboard is the
 * wrong thing to point at twice over. On the day someone meets this it is
 * EMPTY — every vial at zero, no months on the rail, nothing in the tray — so
 * a spotlight over the real screen would circle a row of blanks and explain
 * what would have been there. And a tour that lets taps through to live
 * controls is one stray thumb away from writing a real transaction or opening
 * a real settings screen mid-sentence.
 *
 * So this is a likeness: the same shapes, the same category colours, the same
 * typography, filled with a month that never happened. It is inert by
 * construction — no handlers, `pointer-events-none` at the root, and
 * `aria-hidden` because the captions carry the meaning for a screen reader.
 *
 * The figures are invented and the screen says so, in a chip at the top. That
 * is the same rule the home-screen widget preview follows in
 * `HomeScreenWidgetSection`: a preview that could be mistaken for the user's
 * own money is worse than no preview. The one thing NOT invented is the month
 * rail, which is built from the real calendar through `buildMonthWindow` — a
 * hardcoded set of month names would be wrong for most of the year, and being
 * wrong about which month it is, in a budget app, is not a small thing.
 */

interface DemoVial {
  name: string;
  spent: number;
  limit: number;
  /** Fraction of the bar that is still expected rather than spent. */
  projected: number;
}

const DEMO_VIALS: DemoVial[] = [
  { name: 'Groceries', spent: 342, limit: 600, projected: 0 },
  { name: 'Transport', spent: 118, limit: 250, projected: 0.12 },
  { name: 'Leisure', spent: 205, limit: 300, projected: 0 },
  { name: 'Utilities', spent: 160, limit: 220, projected: 0.18 },
];

/** Invented, and labelled as such on the screen. */
const DEMO_REMAINING_DOLLARS = '1,284';
const DEMO_REMAINING_CENTS = '.60';
const DEMO_REVIEW_COUNT = 3;

const Vial: React.FC<{ vial: DemoVial; index: number }> = ({ vial, index }) => {
  const color = getBudgetColor(vial.name, index);
  const spentWidth = Math.max(0, Math.min(100, (vial.spent / vial.limit) * 100));
  const projectedWidth = Math.max(0, Math.min(100 - spentWidth, vial.projected * 100));

  return (
    <div className="flex-1 min-h-0 overflow-hidden rounded-[2rem] relative flex flex-col bg-white/70 dark:bg-slate-900/70 shadow-sm border border-slate-200/40 dark:border-slate-700/30">
      {/* The fill, and the dotted band of what has not gone yet. Both are the
          same shapes BudgetSection draws; neither animates here, because
          nothing on this screen changes. */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div
          className="absolute inset-0 origin-left"
          style={{
            transform: `scaleX(${spentWidth / 100})`,
            background: `linear-gradient(90deg, ${color}55 0%, ${color}70 100%)`,
          }}
        />
        {spentWidth > 0 && spentWidth < 100 && (
          <div
            className="absolute top-0 h-full w-[3px] -ml-[3px]"
            style={{
              left: `${spentWidth}%`,
              background: color,
              boxShadow: `0 0 6px ${color}50, 0 0 12px ${color}20`,
            }}
          />
        )}
        {projectedWidth > 0 && (
          <div
            className="absolute top-0 h-full"
            style={{ left: `${spentWidth}%`, width: `${projectedWidth}%` }}
          >
            <div className="absolute inset-0" style={{ backgroundColor: `${color}12` }} />
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `radial-gradient(circle, ${color}30 1px, transparent 1px)`,
                backgroundSize: '6px 6px',
              }}
            />
          </div>
        )}
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-between py-2 px-4">
        <div className="flex items-center space-x-3">
          <div className="rounded-2xl flex items-center justify-center shrink-0 p-1.5" style={{ color }}>
            {getBudgetIcon(vial.name)}
          </div>
          <div className="flex flex-col text-left">
            <h3 className="text-sm font-bold tracking-tight leading-none text-slate-600 dark:text-slate-100">
              {vial.name}
            </h3>
            <span className="text-[11px] font-bold tracking-wide mt-1 text-slate-400 dark:text-slate-500">
              ${vial.limit - vial.spent} left
            </span>
          </div>
        </div>
        <span className="text-sm font-black tracking-tight text-slate-500 dark:text-slate-100">
          ${vial.limit}
        </span>
      </div>
    </div>
  );
};

const TourDemoScreen: React.FC = () => {
  const currentMonthKey = getLocalMonthKey(getLocalToday());
  const months = buildMonthWindow(currentMonthKey);

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 flex flex-col overflow-hidden pointer-events-none select-none"
    >
      {/* Header: the figure, and the cog beside it. */}
      <div className="shrink-0 px-6 pt-8 pb-1 flex items-start justify-between gap-4">
        <div data-tour="balance" className="flex flex-col items-start">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-slate-400 dark:text-slate-500">
            Left this month
          </span>
          <div className="flex items-baseline mt-1.5">
            <span className="text-xl font-bold leading-none text-slate-300 dark:text-slate-600">$</span>
            <span className="text-3xl font-extrabold font-mono tracking-tighter leading-none text-slate-700 dark:text-slate-100">
              {DEMO_REMAINING_DOLLARS}
            </span>
            <span className="text-xl font-extrabold font-mono tracking-tighter leading-none text-slate-700 dark:text-slate-100">
              {DEMO_REMAINING_CENTS}
            </span>
          </div>
        </div>

        <div
          data-tour="settings"
          className="shrink-0 p-2.5 rounded-full bg-white/70 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800/60 text-slate-400 dark:text-slate-500"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
      </div>

      {/* An example, and it says so. */}
      <div className="shrink-0 px-6 pb-3">
        <span className="inline-block px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-slate-800/70 text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Example figures
        </span>
      </div>

      {/* The month rail, in the shape the chart's own rail takes. */}
      <div data-tour="months" className="shrink-0 mx-4 mb-3 px-2 py-2 rounded-2xl bg-white/60 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
        {months.map((key) => {
          const isCurrent = key === currentMonthKey;
          return (
            <span
              key={key}
              className={`flex-1 text-center text-[11px] tracking-wide ${
                isCurrent
                  ? 'font-black text-emerald-600 dark:text-emerald-400'
                  : 'font-bold text-slate-300 dark:text-slate-600'
              }`}
            >
              {shortMonthName(key)}
            </span>
          );
        })}
      </div>

      {/* The vials. */}
      <div data-tour="vials" className="flex-1 min-h-0 px-4 flex flex-col gap-3 pb-3">
        {DEMO_VIALS.map((vial, i) => (
          <Vial key={vial.name} vial={vial} index={i} />
        ))}
      </div>

      {/* The bar, drawn where the real one sits. */}
      <div className="shrink-0 h-[calc(env(safe-area-inset-bottom,0px)+5rem)] px-6 flex items-center justify-center">
        <div className="w-4/5 lg:w-1/3 border rounded-full px-3 py-1.5 shadow-2xl bg-white/95 dark:bg-slate-900/95 border-slate-100 dark:border-slate-800/60">
          <div className="flex items-center justify-evenly gap-3">
            <div className="p-3 rounded-full text-emerald-600 dark:text-emerald-400">
              <svg className="w-6 h-6 scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>

            <div className="w-px h-6 bg-slate-200/60 dark:bg-slate-700/40" />

            <div data-tour="add" className="p-3 mx-1 text-white rounded-full shadow-lg flex items-center justify-center bg-emerald-600 dark:bg-emerald-500 shadow-emerald-500/20">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>

            <div className="w-px h-6 bg-slate-200/60 dark:bg-slate-700/40" />

            <div data-tour="review" className="relative p-3 rounded-full text-slate-400 dark:text-slate-500">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-amber-600 text-white text-[11px] font-black flex items-center justify-center">
                {DEMO_REVIEW_COUNT}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TourDemoScreen;
