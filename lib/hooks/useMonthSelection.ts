import { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { buildMonthWindow, monthRelation, type MonthRelation } from '../monthWindow';

/**
 * Which of the seven months on the rail the dashboard is showing.
 *
 * The selection is deliberately NOT durable. Browsing back to July is a
 * question ("what did that month look like?"), not a setting, and a dashboard
 * that opens on a month four back — with a headline balance from a month that
 * finished long ago — is a dashboard lying about the money. So the selection
 * lives only in memory and is dropped the moment the user's attention leaves:
 *
 *  - the app goes to the background or comes back (Capacitor `pause`/`resume`),
 *  - the tab is hidden or restored on the web (`visibilitychange`),
 *  - the calendar rolls into a new month, which moves the whole rail,
 *  - and, from the caller, the home button and a second tap on the current
 *    month.
 *
 * Held as null-means-now rather than as a copy of the current key, so a
 * rollover at midnight cannot leave the dashboard parked on what has quietly
 * become last month.
 */
export interface MonthSelection {
  /** The seven keys on the rail, oldest first. */
  months: string[];
  /** The month actually on screen. */
  viewMonthKey: string;
  /** The month we are really in. */
  currentMonthKey: string;
  /** True while the dashboard is showing now, which is the resting state. */
  isCurrentMonth: boolean;
  /** past / current / future, for the wording and the styling. */
  relation: MonthRelation;
  /** Show a month. Passing the current one is the way back. */
  selectMonth: (monthKey: string) => void;
  /** Back to now. */
  resetToCurrentMonth: () => void;
}

export function useMonthSelection(currentMonthKey: string): MonthSelection {
  const [selected, setSelected] = useState<string | null>(null);

  const resetToCurrentMonth = useCallback(() => {
    // A functional update, so a reset while already on the current month is a
    // no-op React can bail out of rather than a render.
    setSelected((prev) => (prev === null ? prev : null));
  }, []);

  // The rail moved: whatever was selected is no longer where the user left it.
  useEffect(() => {
    resetToCurrentMonth();
  }, [currentMonthKey, resetToCurrentMonth]);

  useEffect(() => {
    const onVisibilityChange = () => resetToCurrentMonth();
    document.addEventListener('visibilitychange', onVisibilityChange);

    let removeNative: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      // Both halves: `pause` covers leaving, so the dashboard is already back
      // on this month behind the user's back, and `resume` covers a process
      // that was frozen rather than paused.
      const pause = CapApp.addListener('pause', resetToCurrentMonth);
      const resume = CapApp.addListener('resume', resetToCurrentMonth);
      removeNative = () => {
        void pause.then((h) => h.remove());
        void resume.then((h) => h.remove());
      };
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      removeNative?.();
    };
  }, [resetToCurrentMonth]);

  const months = useMemo(() => buildMonthWindow(currentMonthKey), [currentMonthKey]);

  // A selection that is not on the rail any more (a stale key, or a month that
  // scrolled off it) reads as now rather than as a month with nothing in it.
  const viewMonthKey = selected && months.includes(selected) ? selected : currentMonthKey;

  const selectMonth = useCallback(
    (monthKey: string) => {
      setSelected(monthKey === currentMonthKey ? null : monthKey);
    },
    [currentMonthKey],
  );

  return {
    months,
    viewMonthKey,
    currentMonthKey,
    isCurrentMonth: viewMonthKey === currentMonthKey,
    relation: monthRelation(viewMonthKey, currentMonthKey),
    selectMonth,
    resetToCurrentMonth,
  };
}

export default useMonthSelection;
