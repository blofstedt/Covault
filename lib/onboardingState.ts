// lib/onboardingState.ts
//
// Whether this person has already been through the intro.
//
// The app had no record of it at all. `useAuthState` moved to 'onboarding'
// whenever a sign-in happened from the signed-out screen, which is not "this
// is a new account" — it is "somebody signed in", and that includes the same
// person signing back in after a sign-out. So a returning user was asked "Who
// is this for?" again, and answering it handed the app a fresh set of starter
// budgets, which replaced the ones already on screen with the defaults.
//
// Device-local on purpose. The alternative is a column on `settings`, which
// would follow the account to a new phone — but it would also have to be read
// before the decision could be made, and that read can fail. A failed read
// would then read as "never onboarded" and replay the intro over live data,
// which is the exact failure this exists to stop (see the budgets invariant in
// CLAUDE.md). What is left is a smaller promise, kept absolutely: on this
// phone, the intro is shown once.
//
// Keyed by user id so two people sharing a phone each get their own intro.

const KEY_PREFIX = 'covault_onboarded_v1:';

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/** True when this user has finished the intro on this device. */
export function hasOnboarded(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(keyFor(userId)) === '1';
  } catch {
    // Storage blocked: the worst case is the intro shown again, which is now
    // harmless — finishing it no longer overwrites anything.
    return false;
  }
}

/** Recorded as the intro is finished, however it was finished. */
export function markOnboarded(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId), '1');
  } catch {
    /* see hasOnboarded */
  }
}
