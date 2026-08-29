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
const REQUIRED_PREFIX = 'covault_onboarding_required_v1:';

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function requiredKeyFor(userId: string): string {
  return `${REQUIRED_PREFIX}${userId}`;
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function write(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* see hasOnboarded */
  }
}

/** True when this user has finished the intro on this device. */
export function hasOnboarded(userId: string | null | undefined): boolean {
  if (!userId) return false;
  // Storage blocked: the worst case is the intro shown again, which is now
  // harmless — finishing it no longer overwrites anything.
  return read(keyFor(userId));
}

/** Recorded as the intro is finished, however it was finished. */
export function markOnboarded(userId: string | null | undefined): void {
  if (!userId) return;
  write(keyFor(userId), true);
  write(requiredKeyFor(userId), false);
}

/**
 * A first sign-on that has not been seen through to the end.
 *
 * Set the moment a brand-new account is recognised and cleared only by
 * finishing, so an intro that is interrupted — the app killed, the phone
 * restarted, the user wandering off half way — resumes on the next launch
 * instead of being skipped. Without it, "is this person new?" would have to be
 * decided afresh every time, and the answer goes stale as soon as the account
 * is a few minutes old.
 */
export function isOnboardingRequired(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return read(requiredKeyFor(userId));
}

/** Set when a first sign-on is recognised, before the intro is shown. */
export function markOnboardingRequired(userId: string | null | undefined): void {
  if (!userId) return;
  write(requiredKeyFor(userId), true);
}

/**
 * How long after an account is created a sign-in still counts as the first one.
 *
 * The trip out to Google's sign-in page and back can involve the browser, a
 * deep link and — on a phone under memory pressure — the app being killed and
 * cold-started, so "the account was made moments ago" has to allow for minutes
 * rather than seconds. Only ever used once per account: the flag above takes
 * over the instant this says yes.
 */
const FIRST_SIGN_IN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Whether this session is somebody's first ever sign-in.
 *
 * Read from the account's creation time rather than from how the session
 * arrived. The transition "signed out, now signed in" was the old test and it
 * misses the case that matters most: the OAuth round trip can restart the app,
 * and the session is then simply *there* at launch with no transition to
 * observe — so a genuinely new user could reach the dashboard having never been
 * shown the intro at all.
 *
 * Compared as an absolute difference so that a device clock running behind the
 * server does not read a brand-new account as an old one. A badly wrong clock
 * can still get this wrong in both directions; neither outcome is damaging —
 * the intro shown once more cannot overwrite anything, and an intro missed
 * leaves the app on its defaults, which is where it starts anyway.
 */
export function isFirstSignIn(
  createdAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return Math.abs(nowMs - created) <= FIRST_SIGN_IN_WINDOW_MS;
}

/**
 * The one decision: does this person see the intro now?
 *
 * Called from both routes into a signed-in app, because which of the two a
 * session arrives on says nothing about who the user is. It also settles the
 * question permanently as it answers it — an established account is written
 * down as past the intro, a new one is written down as owing it — so the
 * account's age is only ever consulted once, in the minutes when it is a
 * reliable signal.
 */
export function shouldShowOnboarding(
  user: { id?: string | null; created_at?: string | null } | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const userId = user?.id;
  if (!userId) return false;
  if (hasOnboarded(userId)) return false;
  if (isOnboardingRequired(userId)) return true;

  if (isFirstSignIn(user?.created_at, nowMs)) {
    markOnboardingRequired(userId);
    return true;
  }

  // An account that has been around: either it has been through the intro on
  // another device, or it predates this record entirely. Either way, replaying
  // the intro over live data is the failure this exists to prevent.
  markOnboarded(userId);
  return false;
}
