// lib/entitlement.ts
// Premium feature identifiers and their upgrade-prompt labels.
//
// NOTE: premium gating is currently stubbed to always-on — every user gets
// all premium features free (the gates in Dashboard.tsx pass
// `hasPremium={true}` directly). The entitlement-check helpers that used to
// live here were unused and were removed; re-add an access check here and
// wire it into those gates if/when the app starts enforcing paywalls.

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
