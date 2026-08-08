import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A light that runs once around a row to say "this one".
 *
 * Two places need to point at rows the user cannot see yet: "Today" in an
 * expanded budget, and arriving at Review from the widget or a capture
 * notification. Both used to just scroll, which answers "where" but not
 * "which" — after a smooth scroll the eye has nothing to land on, and with
 * several rows dated today there was no way to tell which ones were meant.
 *
 * Deliberately not a colour change or a persistent ring. The rows already
 * carry meaning in their colour, and anything that stays on screen becomes a
 * second kind of selection the user then has to dismiss. A light that travels
 * the edge once and leaves says the same thing and takes nothing with it.
 */

/**
 * How long a highlight lives, in milliseconds. Must match the CSS: the class
 * is removed on this timer, and removing it early would cut the fade off.
 *
 * Longer than the app's 320ms interaction clock on purpose — this is not part
 * of a gesture. It has to survive a smooth scroll that has not finished when
 * the tap is released, or it plays somewhere the user is not looking yet.
 */
export const SPIN_HIGHLIGHT_MS = 2200;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface SpinHighlight {
  /** Transaction ids currently lit. */
  spinning: ReadonlySet<string>;
  /** Light these rows, replacing whatever was lit before. */
  spin: (ids: readonly string[]) => void;
  /** True while anything is lit — for callers that want to hold a scroll. */
  active: boolean;
}

export function useSpinHighlight(): SpinHighlight {
  const [spinning, setSpinning] = useState<ReadonlySet<string>>(() => new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  const spin = useCallback((ids: readonly string[]) => {
    clearTimer();

    // Reduced motion turns this off rather than substituting a static ring.
    // The point of it is the movement; a ring that simply appears and vanishes
    // is a flash, which is the specific thing that setting exists to avoid.
    if (ids.length === 0 || prefersReducedMotion()) {
      setSpinning(new Set());
      return;
    }

    // Restart cleanly when the same rows are asked for twice — tapping "Today"
    // again should replay the light, and re-adding a class the element already
    // has does not restart a CSS animation. One empty frame in between is what
    // makes the second tap do something.
    setSpinning(new Set());
    const next = new Set(ids);
    requestAnimationFrame(() => {
      setSpinning(next);
      timerRef.current = setTimeout(() => {
        setSpinning(new Set());
        timerRef.current = null;
      }, SPIN_HIGHLIGHT_MS);
    });
  }, []);

  return { spinning, spin, active: spinning.size > 0 };
}

/**
 * Ids of everything dated today, for the "Today" button.
 *
 * Every row that matches, not just the one the scroll lands on: several
 * purchases can share a day, and lighting only the first would say the others
 * are not today's.
 */
export function idsForDay<T extends { id: string }>(
  transactions: readonly T[],
  day: string,
  dayOf: (transaction: T) => string,
): string[] {
  if (!day) return [];
  return transactions.filter((t) => dayOf(t) === day).map((t) => t.id);
}

/**
 * Ids of whatever the "Today" button actually scrolled to.
 *
 * Not the same question as "what is dated today", and answering that one was
 * the bug: on any day with no spending in this budget — most days, in most
 * budgets — there were no matching rows, so the button scrolled somewhere and
 * lit nothing, which reads exactly like a broken animation.
 *
 * The button lands on the first row dated today or later, and on the last row
 * when everything is in the past. This lights whatever that is: today's rows
 * when there are some, otherwise the single row the scroll came to rest on, so
 * the light always has something to point at.
 */
export function idsForTodayJump<T extends { id: string }>(
  transactions: readonly T[],
  today: string,
  dayOf: (transaction: T) => string,
): string[] {
  if (transactions.length === 0) return [];

  const exact = idsForDay(transactions, today, dayOf);
  if (exact.length > 0) return exact;

  const upcoming = transactions.findIndex((t) => dayOf(t) >= today);
  const landed = upcoming >= 0 ? transactions[upcoming] : transactions[transactions.length - 1];
  return landed ? [landed.id] : [];
}
