import { describe, it, expect, vi } from 'vitest';

/**
 * What the native listener is told to stay quiet about.
 *
 * The listener posts "$X at Y — captured" the instant a bank alert lands, with
 * the WebView dead — long before the pipeline that knows this charge is already
 * on the books gets a look. This is the list that lets it decline, so the shape
 * of the payload is a contract with NotificationListener.matchesRecurringCharge
 * on the Java side: a JSON array of {vendor, amount}.
 */

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: vi.fn(() => null),
}));

import { pushRecurringCharges } from '../covaultNotification';

function fakePlugin() {
  return { setRecurringCharges: vi.fn().mockResolvedValue(undefined) } as any;
}

function sentCharges(plugin: any) {
  return JSON.parse(plugin.setRecurringCharges.mock.calls[0][0].charges);
}

describe('pushRecurringCharges', () => {
  it('sends the vendor and amount, which is all the Java matcher reads', async () => {
    const plugin = fakePlugin();
    await pushRecurringCharges([{ vendor: 'Netflix*', amount: 20.33 }], plugin);
    expect(sentCharges(plugin)).toEqual([{ vendor: 'Netflix*', amount: 20.33 }]);
  });

  it('drops entries the matcher could only misuse', async () => {
    // A blank name would match every alert; a zero or negative amount is not a
    // subscription. Either would silence captures that should be announced.
    const plugin = fakePlugin();
    await pushRecurringCharges(
      [
        { vendor: '   ', amount: 20.33 },
        { vendor: 'Netflix', amount: 0 },
        { vendor: 'Netflix', amount: -20.33 },
        { vendor: 'Netflix', amount: Number.NaN },
        { vendor: 'Spotify', amount: 12.69 },
      ],
      plugin,
    );
    expect(sentCharges(plugin)).toEqual([{ vendor: 'Spotify', amount: 12.69 }]);
  });

  it('sends an empty list rather than nothing when there are no subscriptions', async () => {
    // The native copy has to be CLEARED when the last recurring charge is
    // deleted, or the listener goes on silencing a charge that is no longer on
    // the books.
    const plugin = fakePlugin();
    await pushRecurringCharges([], plugin);
    expect(sentCharges(plugin)).toEqual([]);
  });

  it('stays quiet on an APK that has never heard of the method', async () => {
    const plugin = {
      setRecurringCharges: vi.fn().mockRejectedValue(new Error('not implemented')),
    } as any;
    await expect(pushRecurringCharges([{ vendor: 'Netflix', amount: 20.33 }], plugin))
      .resolves.toBeUndefined();
  });

  it('does nothing on web, where there is no listener to tell', async () => {
    await expect(pushRecurringCharges([{ vendor: 'Netflix', amount: 20.33 }], null))
      .resolves.toBeUndefined();
  });
});
