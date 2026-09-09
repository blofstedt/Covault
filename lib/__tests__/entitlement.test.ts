import { describe, it, expect } from 'vitest';
import { getEntitlementStatus, type EntitlementUser } from '../entitlement';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

describe('getEntitlementStatus', () => {
  it('is "checking" for a null user', () => {
    expect(getEntitlementStatus(null)).toBe('checking');
    expect(getEntitlementStatus(undefined)).toBe('checking');
  });

  it('is "checking" for a freshly-mapped auth user with no DB fields loaded yet', () => {
    // Mirrors useAuthState.ts's mapUser(): no trial/subscription/tester
    // fields at all, not even explicit nulls.
    const freshlyAuthed: EntitlementUser = {};
    expect(getEntitlementStatus(freshlyAuthed)).toBe('checking');
  });

  it('is "active" for a tester regardless of trial/subscription state', () => {
    const user: EntitlementUser = {
      is_tester: true,
      subscription_status: 'expired',
      trial_ends_at: hoursFromNow(-1000),
    };
    expect(getEntitlementStatus(user)).toBe('active');
  });

  it('is "active" for an active subscription even with a lapsed trial', () => {
    const user: EntitlementUser = {
      is_tester: false,
      subscription_status: 'active',
      trial_ends_at: hoursFromNow(-1000),
    };
    expect(getEntitlementStatus(user)).toBe('active');
  });

  it('is "active" while still inside the trial window', () => {
    const user: EntitlementUser = {
      is_tester: false,
      subscription_status: 'none',
      trial_ends_at: hoursFromNow(1),
    };
    expect(getEntitlementStatus(user)).toBe('active');
  });

  it('is "locked" once the trial has passed with no subscription', () => {
    const user: EntitlementUser = {
      is_tester: false,
      subscription_status: 'none',
      trial_ends_at: hoursFromNow(-1),
    };
    expect(getEntitlementStatus(user)).toBe('locked');
  });

  it('is "locked" for an explicitly expired subscription with no trial left', () => {
    const user: EntitlementUser = {
      is_tester: false,
      subscription_status: 'expired',
      trial_ends_at: hoursFromNow(-1),
    };
    expect(getEntitlementStatus(user)).toBe('locked');
  });

  it('is "locked" for a loaded user with no trial_ends_at at all and no subscription', () => {
    // A settings row loaded from the DB always resolves subscription_status
    // to at least 'none' (never undefined) — see loadUserSettings — so this
    // is a genuinely loaded, genuinely unentitled user, not a "still loading" one.
    const user: EntitlementUser = {
      is_tester: false,
      subscription_status: 'none',
      trial_ends_at: null,
    };
    expect(getEntitlementStatus(user)).toBe('locked');
  });

  it('treats an unparsable trial_ends_at as not entitled rather than throwing', () => {
    const user: EntitlementUser = {
      is_tester: false,
      subscription_status: 'none',
      trial_ends_at: 'not-a-date',
    };
    expect(getEntitlementStatus(user)).toBe('locked');
  });
});
