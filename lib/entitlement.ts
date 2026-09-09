// lib/entitlement.ts
//
// The single place that decides whether this account gets to use the app:
// a permanent tester exemption, a real Google Play subscription, or still
// inside the one-month trial every new signup starts with. See
// `getEntitlementStatus` for the rule and `App.tsx` for where it's applied
// (the whole app locks, not individual features — see docs/ARCHITECTURE.md).
//
// This used to gate individual "premium" features (see PREMIUM_FEATURE_*
// below) with everything hardcoded open. That per-feature split doesn't fit
// a single $6.99/month whole-app plan, so it's left in place but unused
// rather than wired up — the check below is the one that actually runs.

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

export function getEntitlementStatus(user: EntitlementUser | null | undefined): EntitlementStatus {
  if (!user) return 'checking';
  if (isUnloaded(user)) return 'checking';

  if (user.is_tester) return 'active';
  if (user.subscription_status === 'active') return 'active';

  if (user.trial_ends_at) {
    const endsAt = new Date(user.trial_ends_at).getTime();
    if (Number.isFinite(endsAt) && Date.now() < endsAt) return 'active';
  }

  return 'locked';
}

// ---------------------------------------------------------------------------
// Legacy per-feature labels — unused by the check above, kept only because
// SubscribeModal/PremiumGate still reference them. See the note at the top.

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
