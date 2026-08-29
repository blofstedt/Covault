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

import { hasOnboarded, markOnboarded } from '../onboardingState';

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
  it('checks the record before sending anyone into it', () => {
    // The whole bug in one line: the transition alone is not evidence of a new
    // account.
    const decision = /setAuthState\(prev =>[\s\S]*?\);/.exec(AUTH_STATE)?.[0] ?? '';
    expect(decision).toContain("prev === 'unauthenticated'");
    expect(decision).toContain('hasOnboarded');
  });

  it('writes the record down when the intro finishes', () => {
    expect(APP_TSX).toContain('markOnboarded(');
  });

  it('counts everyone who was already signed in as past it', () => {
    // Otherwise every existing user gets the intro exactly once more, on the
    // first sign-in after this shipped — which is the bug, one last time.
    const cold = AUTH_STATE.slice(AUTH_STATE.indexOf('supabase.auth.getSession()'));
    expect(cold.slice(0, cold.indexOf('onAuthStateChange'))).toContain('markOnboarded(');
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
