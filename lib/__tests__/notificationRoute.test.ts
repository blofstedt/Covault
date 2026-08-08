import { describe, it, expect, vi } from 'vitest';
import {
  consumePendingRoute,
  parseNotificationRoute,
  type CovaultNotificationPlugin,
} from '../covaultNotification';
import { idsForDay } from '../hooks/useSpinHighlight';

/**
 * Tapping a capture notification has to land on the Review page — it says
 * "tap to review". The native listener posts these, and it outlives the
 * WebView, so on a cold start there is no JS to receive an event; the
 * destination is parked in SharedPreferences and collected here instead.
 *
 * The property worth pinning down is that it fires *once*. The native side
 * clears the value as it hands it over, and this wrapper must not turn a
 * cleared/absent value into a navigation — otherwise every ordinary launch
 * after a tapped notification would yank the user to Review.
 */

function stubPlugin(over: Partial<CovaultNotificationPlugin>): CovaultNotificationPlugin {
  return over as CovaultNotificationPlugin;
}

describe('consumePendingRoute', () => {
  it('returns null with no plugin (web build)', async () => {
    expect(await consumePendingRoute(null)).toBeNull();
  });

  it("returns 'review' when a tap parked one", async () => {
    const plugin = stubPlugin({
      consumePendingRoute: vi.fn(async () => ({ route: 'review' })),
    });
    expect(await consumePendingRoute(plugin)).toBe('review');
  });

  it('returns null for an ordinary launch', async () => {
    // Native resolves '' rather than null, since a Capacitor JSObject can't
    // carry a null string.
    const plugin = stubPlugin({
      consumePendingRoute: vi.fn(async () => ({ route: '' })),
    });
    expect(await consumePendingRoute(plugin)).toBeNull();
  });

  it('only navigates once — the second read comes back empty', async () => {
    // Mirrors the native take-and-clear: first call yields the route, every
    // call after it yields nothing.
    let stored = 'review';
    const plugin = stubPlugin({
      consumePendingRoute: vi.fn(async () => {
        const route = stored;
        stored = '';
        return { route };
      }),
    });
    expect(await consumePendingRoute(plugin)).toBe('review');
    expect(await consumePendingRoute(plugin)).toBeNull();
    expect(await consumePendingRoute(plugin)).toBeNull();
  });

  it('ignores an unrecognised destination rather than guessing', async () => {
    const plugin = stubPlugin({
      consumePendingRoute: vi.fn(async () => ({ route: 'settings' })),
    });
    expect(await consumePendingRoute(plugin)).toBeNull();
  });

  it('returns null when the native method is missing (older APK)', async () => {
    const plugin = stubPlugin({
      consumePendingRoute: vi.fn(async () => {
        throw new Error('not implemented');
      }),
    });
    expect(await consumePendingRoute(plugin)).toBeNull();
  });
});

/**
 * Where a tap from outside the app lands.
 *
 * Three things can send the user somewhere: a capture notification, the
 * widget's review pill, and a category row on the widget. All three arrive as
 * one string parked by the native side, so this is the only place that decides
 * what a destination means — and the thing it must never do is act on one it
 * does not recognise. A snapshot on the home screen can be older than the app
 * that reads it, so an unknown route is a real possibility rather than a
 * theoretical one, and navigating somewhere arbitrary on a tap the user did
 * make is worse than doing nothing.
 */
describe('parseNotificationRoute', () => {
  it('reads the review destination', () => {
    expect(parseNotificationRoute('review')).toBe('review');
  });

  it('reads a budget destination and keeps its name', () => {
    expect(parseNotificationRoute('budget:Groceries')).toEqual({ budget: 'Groceries' });
  });

  it('keeps spaces inside a budget name', () => {
    // "Eating Out" is one budget, not a malformed route.
    expect(parseNotificationRoute('budget:Eating Out')).toEqual({ budget: 'Eating Out' });
  });

  it('trims the surrounding whitespace the intent extra can carry', () => {
    expect(parseNotificationRoute('  review ')).toBe('review');
    expect(parseNotificationRoute('budget:  Leisure  ')).toEqual({ budget: 'Leisure' });
  });

  it('refuses a budget route with no budget in it', () => {
    expect(parseNotificationRoute('budget:')).toBeNull();
    expect(parseNotificationRoute('budget:   ')).toBeNull();
  });

  it('refuses anything it does not recognise', () => {
    expect(parseNotificationRoute('settings')).toBeNull();
    expect(parseNotificationRoute('')).toBeNull();
    expect(parseNotificationRoute(null)).toBeNull();
    expect(parseNotificationRoute(undefined)).toBeNull();
    expect(parseNotificationRoute(42)).toBeNull();
  });
});

/**
 * Which rows the "Today" light runs around.
 *
 * Every row dated today, not just the one the scroll stops at. Several
 * purchases can share a day, and lighting only the first would quietly say the
 * others are not today's.
 */
describe('idsForDay', () => {
  const rows = [
    { id: 'a', date: '2026-08-07' },
    { id: 'b', date: '2026-08-08' },
    { id: 'c', date: '2026-08-08' },
    { id: 'd', date: '2026-08-09' },
  ];
  const dayOf = (t: { id: string; date: string }) => t.date;

  it('returns every row on that day', () => {
    expect(idsForDay(rows, '2026-08-08', dayOf)).toEqual(['b', 'c']);
  });

  it('returns nothing when the day has no rows', () => {
    expect(idsForDay(rows, '2026-08-10', dayOf)).toEqual([]);
  });

  it('lights nothing rather than everything when the day is unknown', () => {
    // An empty day string must not be read as "matches the rows with no date".
    expect(idsForDay(rows, '', dayOf)).toEqual([]);
  });
});
