import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { getLocalToday } from '../dateUtils';

/**
 * Today's local calendar day as `YYYY-MM-DD`, kept honest while the app is
 * running.
 *
 * Everything month-scoped on the dashboard — which transactions belong to the
 * current month, which projected occurrences have "already happened" — is
 * derived from today's date. Reading the clock during render is not enough:
 * this is a Capacitor app that gets backgrounded rather than closed, and a
 * render only happens when some other state changes. Sitting on the dashboard
 * across midnight (or resuming on the 1st) would otherwise keep showing
 * yesterday's month, with last month's transactions still in the vials.
 *
 * Three triggers, because none of them is sufficient alone:
 *  - a timer armed for the next local midnight (app open the whole time),
 *  - `visibilitychange` (web tab restored),
 *  - Capacitor `resume` (Android app brought back to the foreground, where the
 *    timer may have been throttled or the process frozen).
 *
 * The state only changes identity when the day actually changes, so consumers
 * can safely use it as a `useMemo` dependency.
 */
export function useCurrentDay(): string {
  const [today, setToday] = useState<string>(getLocalToday);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const scheduleMidnight = () => {
      if (timer !== undefined) clearTimeout(timer);
      const now = new Date();
      // A few seconds past midnight, so a slightly early fire (timers are not
      // exact) still reads the new day.
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0, 0, 5, 0,
      );
      timer = setTimeout(refresh, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    };

    function refresh() {
      setToday(prev => {
        const next = getLocalToday();
        return next === prev ? prev : next;
      });
      scheduleMidnight();
    }

    scheduleMidnight();

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    let removeResume: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      const handle = CapApp.addListener('resume', refresh);
      removeResume = () => { void handle.then(h => h.remove()); };
    }

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      removeResume?.();
    };
  }, []);

  return today;
}

export default useCurrentDay;
