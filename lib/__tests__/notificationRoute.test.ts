import { describe, it, expect, vi } from 'vitest';
import { consumePendingRoute, type CovaultNotificationPlugin } from '../covaultNotification';

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
