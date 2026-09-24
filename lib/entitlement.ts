// lib/entitlement.ts
//
// The current whole-app access decision. `App.tsx` applies this result after
// passing the database clock from `lib/serverClock.ts`.

/** The fields `getEntitlementStatus` reads, from `types.ts`'s `User`. */
export interface EntitlementUser {
  is_tester?: boolean;
  subscription_status?: 'none' | 'active' | 'expired' | null;
  trial_ends_at?: string | null;
}

export type EntitlementStatus =
  /** These fields haven't been loaded from the DB yet — show a loader, never the lock screen. */
  | 'checking'
  | 'active'
  | 'locked';

/**
 * `undefined` on every one of these three fields means `loadUserSettings`
 * hasn't returned yet — the auth layer's freshly-mapped user object never
 * sets them (see `mapUser` in `useAuthState.ts`), only the DB load does, and
 * that load is asynchronous and happens after `authState` is already
 * 'authenticated'. Treating "not loaded" as "not entitled" would flash the
 * lock screen at every single sign-in while data is still in flight.
 */
function isUnloaded(user: EntitlementUser): boolean {
  return (
    user.is_tester === undefined &&
    user.subscription_status === undefined &&
    user.trial_ends_at === undefined
  );
}

/**
 * @param nowMs What "now" is. Callers pass `serverNow()` from lib/serverClock,
 *   which is the database's clock rather than the phone's: the trial is a
 *   date, and a date compared against a clock the person being charged can
 *   set is not a limit. It defaults to the local clock so a caller that has
 *   not synced behaves as this always did rather than failing shut.
 */
export function getEntitlementStatus(
  user: EntitlementUser | null | undefined,
  nowMs: number = Date.now(),
): EntitlementStatus {
  if (!user) return 'checking';
  if (isUnloaded(user)) return 'checking';

  if (user.is_tester) return 'active';
  if (user.subscription_status === 'active') return 'active';

  if (user.trial_ends_at) {
    const endsAt = new Date(user.trial_ends_at).getTime();
    if (Number.isFinite(endsAt) && nowMs < endsAt) return 'active';
  }

  return 'locked';
}

// ---------------------------------------------------------------------------
// Labels used by SubscribeModal and PremiumGate.

/**
 * Premium feature identifiers used for gating.
 */
export type PremiumFeature =
  | 'custom_notifications'
  | 'bank_notification_parsing'
  | 'spending_chart'
  | 'priority_help'
  | 'feature_requests'
  | 'discretionary_shield';

/**
 * Human-readable labels for each premium feature (used in upgrade prompts).
 */
export const PREMIUM_FEATURE_LABELS: Record<PremiumFeature, string> = {
  custom_notifications: 'Custom Notifications',
  bank_notification_parsing: 'Automatic Bank Notification Parsing',
  spending_chart: 'Spending Chart Access',
  priority_help: 'Priority Help',
  feature_requests: 'Ability to Request Features',
  discretionary_shield: 'Discretionary Shield',
};
