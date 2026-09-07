// lib/firstCapture.ts
//
// The moment the app proves itself, and the one chance to explain it.
//
// Everything before a user's first captured purchase is a promise: they have
// granted a frightening-sounding permission, picked their banks, and been told
// that purchases will now appear on their own. The first one that actually
// lands is when that becomes real — and it lands silently, as a number on an
// icon they have no reason to have looked at yet. A walkthrough on day one
// cannot cover this, because on day one there is nothing to point at.
//
// So this is the one interruption the app allows itself: shown once, ever, per
// person per phone, at the moment there is something true to say.
//
// Device-local, and keyed by user id, for the same reason
// `lib/onboardingState.ts` is: a column on `settings` would have to be READ
// before the decision could be made, and a failed read would read as "never
// shown" and interrupt somebody who had already seen it. What is left is a
// smaller promise, kept absolutely — on this phone, once.

const SEEN_PREFIX = 'covault_first_capture_seen_v1:';

function keyFor(userId: string): string {
  return `${SEEN_PREFIX}${userId}`;
}

/** True once this person has been shown the first-capture note on this phone. */
export function hasSeenFirstCapture(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(keyFor(userId)) === '1';
  } catch {
    // Storage blocked. The worst case is the note shown again, which is a
    // small annoyance; the alternative — treating an unreadable store as
    // "already seen" — silently removes the one explanation that matters.
    return false;
  }
}

/** Recorded as it is shown, not as it is dismissed: it has been seen either way. */
export function markFirstCaptureSeen(userId: string | null | undefined): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId), '1');
  } catch {
    /* see hasSeenFirstCapture */
  }
}

export interface FirstCaptureFacts {
  userId: string | null | undefined;
  /** How many captures are waiting in Review right now. */
  waitingCount: number;
  /** Whether this person has already been shown the note on this phone. */
  seen: boolean;
}

/**
 * Whether to show the note now.
 *
 * The rule is "exactly one waiting, and never shown before", and the exactness
 * is doing real work. The obvious rule — any capture at all — fires for
 * everybody already using the app the first time they open a build with this
 * in it, telling a user of six months that their first purchase has just been
 * caught. A brand-new user's first capture is, by definition, one.
 *
 * It deliberately does NOT require watching the count change from zero. The
 * common case is the alert arriving while the app is closed: the user opens
 * Covault to find the badge already at one, and a transition-watching rule
 * would miss exactly the case it exists for.
 *
 * The cost of the heuristic is bounded and one-directional: an established
 * user who happens to have exactly one item waiting sees a friendly card once.
 * Nothing is recorded, nothing is filed, nothing is lost.
 */
export function shouldShowFirstCapture(facts: FirstCaptureFacts): boolean {
  if (!facts.userId) return false;
  if (facts.seen) return false;
  return facts.waitingCount === 1;
}
