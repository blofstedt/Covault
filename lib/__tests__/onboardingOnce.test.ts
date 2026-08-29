import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
vi.stubGlobal('localStorage', new MemoryStorage());

import {
  hasOnboarded,
  markOnboarded,
  isFirstSignIn,
  isOnboardingRequired,
  shouldShowOnboarding,
} from '../onboardingState';

/**
 * The intro was shown on every sign-in, not on the first one.
 *
 * `useAuthState` read one thing: signed out a moment ago, signed in now. That
 * is also exactly what happens when the same person signs back in after a
 * sign-out — so a returning user was asked "Who is this for?" again, and
 * answering it handed the app the starter categories, which replaced the
 * budgets already on screen with the defaults. The limits shown are what the
 * settings screen writes back, so those defaults sat one tap away from being
 * saved over the real ones. Same shape as the failed-budgets-read bug that
 * budgetsSurviveFailedRead.test.ts pins.
 *
 * Both halves are held here: the intro is shown once per person per device,
 * and finishing it can no longer overwrite data that has already loaded.
 */
const APP_TSX = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf-8');
const AUTH_STATE = readFileSync(resolve(__dirname, '../hooks/useAuthState.ts'), 'utf-8');
const ONBOARDING = readFileSync(resolve(__dirname, '../../components/Onboarding.tsx'), 'utf-8');

describe('the record that the intro has been seen', () => {
  beforeEach(() => localStorage.clear());

  it('starts unset and holds once marked', () => {
    expect(hasOnboarded('user-a')).toBe(false);
    markOnboarded('user-a');
    expect(hasOnboarded('user-a')).toBe(true);
  });

  it('is per person, so a shared phone still introduces the second one', () => {
    markOnboarded('user-a');
    expect(hasOnboarded('user-b')).toBe(false);
  });

  it('answers no for a missing user rather than throwing', () => {
    expect(hasOnboarded(null)).toBe(false);
    expect(hasOnboarded(undefined)).toBe(false);
    expect(() => markOnboarded(null)).not.toThrow();
  });

  it('survives storage being unavailable', () => {
    const blocked = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
    };
    vi.stubGlobal('localStorage', blocked);
    try {
      expect(hasOnboarded('user-a')).toBe(false);
      expect(() => markOnboarded('user-a')).not.toThrow();
    } finally {
      vi.stubGlobal('localStorage', new MemoryStorage());
    }
  });
});

describe('who gets the intro', () => {
  beforeEach(() => localStorage.clear());

  const NOW = Date.parse('2026-08-29T12:00:00Z');
  const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

  it('runs it for an account made moments ago', () => {
    expect(shouldShowOnboarding({ id: 'new', created_at: minutesAgo(1) }, NOW)).toBe(true);
  });

  it('keeps running it until it is finished', () => {
    // The requirement in one test: start to end, across however many launches
    // that takes. An intro abandoned half way — the app killed, the phone
    // restarted — resumes rather than being skipped, even once the account is
    // no longer new enough to be recognised by its age.
    expect(shouldShowOnboarding({ id: 'new', created_at: minutesAgo(1) }, NOW)).toBe(true);
    expect(isOnboardingRequired('new')).toBe(true);

    const muchLater = NOW + 3 * 24 * 60 * 60 * 1000;
    expect(shouldShowOnboarding({ id: 'new', created_at: minutesAgo(1) }, muchLater)).toBe(true);

    markOnboarded('new');
    expect(shouldShowOnboarding({ id: 'new', created_at: minutesAgo(1) }, muchLater)).toBe(false);
    expect(isOnboardingRequired('new')).toBe(false);
  });

  it('never runs it for an established account', () => {
    // The bug this started as: a returning user sent back through setup, whose
    // answers replaced their real budgets with the starter ones.
    expect(shouldShowOnboarding({ id: 'old', created_at: minutesAgo(60 * 24 * 90) }, NOW))
      .toBe(false);
    // And settles it, so the account's age is never consulted again.
    expect(hasOnboarded('old')).toBe(true);
  });

  it('allows for the round trip through Google and back', () => {
    // Signing in leaves the app for a browser and returns through a deep link,
    // and a phone under memory pressure kills the app in between. Seconds is
    // not a wide enough window for that.
    expect(isFirstSignIn(minutesAgo(3), NOW)).toBe(true);
    expect(isFirstSignIn(minutesAgo(45), NOW)).toBe(false);
  });

  it('does not read a new account as an old one when the phone clock is off', () => {
    // created_at is the server's time; Date.now() is the phone's.
    expect(isFirstSignIn(new Date(NOW + 4 * 60_000).toISOString(), NOW)).toBe(true);
  });

  it('is asked on both routes into a signed-in app, not just the transition', () => {
    // A first session frequently arrives at launch with no transition to see,
    // because the OAuth round trip restarted the app. Asking only on the
    // transition let a brand-new user reach the dashboard having never been
    // shown the intro.
    const cold = AUTH_STATE.slice(
      AUTH_STATE.indexOf('supabase.auth.getSession()'),
      AUTH_STATE.indexOf('onAuthStateChange'),
    );
    expect(cold).toContain('shouldShowOnboarding(');
    const live = AUTH_STATE.slice(AUTH_STATE.indexOf('onAuthStateChange'));
    expect(live).toContain('shouldShowOnboarding(');
  });

  it('writes the record down when the intro finishes', () => {
    expect(APP_TSX).toContain('markOnboarded(');
  });

  it('does not close the intro under someone when the token refreshes', () => {
    // Every refresh and user update runs through the same handler.
    const decision = /setAuthState\(prev => \{[\s\S]*?\}\);/.exec(AUTH_STATE)?.[0] ?? '';
    expect(decision).toContain("if (prev === 'onboarding') return 'onboarding';");
  });
});

describe('finishing the intro', () => {
  it('never replaces budgets that have already loaded', () => {
    // The damaging half. The starter categories are an answer to an empty
    // list and to nothing else.
    const handler = APP_TSX.slice(
      APP_TSX.indexOf('const handleOnboardingComplete'),
      APP_TSX.indexOf('const handleSignOut'),
    );
    expect(handler).toContain('prev.budgets.length > 0 ? prev.budgets : budgets');
  });

  it('saves the solo-or-together answer instead of only remembering it', () => {
    const handler = APP_TSX.slice(
      APP_TSX.indexOf('const handleOnboardingComplete'),
      APP_TSX.indexOf('const handleSignOut'),
    );
    expect(handler).toContain("saveSettingToDb('budgeting_solo'");
  });
});

describe('the partner step', () => {
  it('links the two accounts rather than promising an email it never sends', () => {
    // It said "Send Invite" and sent nothing: the address was kept in memory,
    // no email was composed, and the partner was never told. Whoever used it
    // believed their household was shared and it was not.
    expect(ONBOARDING).toContain('onLinkPartner');
    // The button now says what happens, and does it.
    expect(ONBOARDING).toContain("'Linking…' : 'Link Partner'");
    expect(ONBOARDING).toContain('await onLinkPartner(email)');
  });

  it('stays on the step and says why when the link fails', () => {
    // The common failure is a partner who has not signed up yet, and that has
    // to be readable — a toast behind a full-screen step is not.
    expect(ONBOARDING).toContain('linkError');
  });

  it('still lets the user past it without a partner', () => {
    expect(ONBOARDING).toContain('Skip for now');
  });
});
