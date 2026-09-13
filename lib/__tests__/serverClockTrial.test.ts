import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const callRpcMock = vi.fn();
vi.mock('../apiHelpers', () => ({
  callRpc: (...args: unknown[]) => callRpcMock(...args),
  restFetch: vi.fn(),
  REST_BASE: 'https://example.test/rest/v1',
  getAuthHeaders: async () => ({}),
}));

import { serverNow, syncServerClock, resetServerClock, serverClockSynced } from '../serverClock';
import { getEntitlementStatus, type EntitlementUser } from '../entitlement';

/**
 * The trial is a date, and it was being compared against the phone's clock —
 * which belongs to the person being charged. Winding the phone back a month
 * extended the trial for ever and nothing downstream noticed.
 *
 * What this fixes is the CLOCK, not the entitlement. Whether someone has paid
 * is still a column the client reads; that needs Play Billing and a verified
 * purchase record before the server can be called authoritative about it.
 */

const HOUR = 60 * 60 * 1000;

const user = (over: Partial<EntitlementUser> = {}): EntitlementUser => ({
  is_tester: false,
  subscription_status: 'none',
  trial_ends_at: new Date(Date.now() + 24 * HOUR).toISOString(),
  ...over,
});

describe('the clock the trial is judged against', () => {
  beforeEach(() => {
    callRpcMock.mockReset();
    resetServerClock();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetServerClock();
  });

  it('uses the database clock once it has been asked', async () => {
    // The database says it is a year later than this phone believes.
    const serverTime = new Date(Date.now() + 365 * 24 * HOUR).toISOString();
    callRpcMock.mockResolvedValue({ ok: true, data: serverTime });

    await syncServerClock();

    expect(serverClockSynced()).toBe(true);
    expect(serverNow()).toBeGreaterThan(Date.now() + 364 * 24 * HOUR);
  });

  it('ends a trial the phone has been wound back to keep alive', async () => {
    // A trial that ended a week ago, on a phone whose clock says otherwise.
    const endedAWeekAgo = new Date(Date.now() - 7 * 24 * HOUR).toISOString();
    const stillTrialing = user({ trial_ends_at: new Date(Date.now() + 24 * HOUR).toISOString() });

    // Against the phone: still inside the trial.
    expect(getEntitlementStatus(stillTrialing)).toBe('active');

    // Against the database, which says the trial date is long past.
    const serverTime = new Date(Date.now() + 30 * 24 * HOUR).toISOString();
    callRpcMock.mockResolvedValue({ ok: true, data: serverTime });
    await syncServerClock();

    expect(getEntitlementStatus(user({ trial_ends_at: endedAWeekAgo }), serverNow())).toBe('locked');
    expect(getEntitlementStatus(stillTrialing, serverNow())).toBe('locked');
  });

  it('fails OPEN when the database cannot be asked', async () => {
    // No network, or a database without the function. A household locked out
    // of its own budget because a round trip failed is far worse than a trial
    // running long, so the offset stays zero and nothing changes.
    callRpcMock.mockResolvedValue({ ok: false, message: 'Network error' });
    await syncServerClock();

    expect(serverClockSynced()).toBe(false);
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(1000);
    expect(getEntitlementStatus(user(), serverNow())).toBe('active');
  });

  it('ignores an answer it cannot read rather than jumping to 1970', async () => {
    callRpcMock.mockResolvedValue({ ok: true, data: 'not a date' });
    await syncServerClock();
    expect(Math.abs(serverNow() - Date.now())).toBeLessThan(1000);
  });

  it('does not count the round trip as clock drift', async () => {
    // A slow request must not read as the database being seconds ahead. The
    // answer describes an instant inside the request, so the midpoint is what
    // it is matched against.
    const serverTime = new Date(Date.now() + 2000).toISOString();
    callRpcMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, data: serverTime };
    });
    await syncServerClock();
    // Roughly two seconds, not two seconds plus the trip.
    expect(serverNow() - Date.now()).toBeGreaterThan(1500);
    expect(serverNow() - Date.now()).toBeLessThan(2500);
  });

  it('still lets a tester and a subscriber through whatever the clock says', async () => {
    const serverTime = new Date(Date.now() + 365 * 24 * HOUR).toISOString();
    callRpcMock.mockResolvedValue({ ok: true, data: serverTime });
    await syncServerClock();

    expect(getEntitlementStatus(user({ is_tester: true }), serverNow())).toBe('active');
    expect(getEntitlementStatus(user({ subscription_status: 'active' }), serverNow())).toBe('active');
  });
});
