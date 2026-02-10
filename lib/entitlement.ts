// lib/entitlement.ts
// Single source of truth for premium access checks.
// All UI and feature guards must use this module instead of checking
// subscription or trial state directly.

import type { User } from '../types';

/** Admin email that always receives premium access without paying. */
const ADMIN_EMAIL = 'itsjustmyemail@gmail.com';

/**
 * Returns true when the user has premium access — either through an active
 * subscription, because they are still inside the 14-day free trial window,
 * or because they are the admin user.
 */
export const hasPremiumAccess = (user: User | null): boolean => {
  if (!user) return false;

  // Admin always has premium
  if (user.email === ADMIN_EMAIL) return true;

  // Active subscription always grants access
  if (user.subscription_status === 'active') return true;

  // Trial window check (backend is source of truth)
  if (user.trial_ends_at) {
    const trialEnd = new Date(user.trial_ends_at).getTime();
    if (Date.now() < trialEnd) return true;
  }

  return false;
};

/**
 * Returns the number of days remaining in the trial, or 0 if expired / not started.
 * Returns 0 if the user has an active subscription (no need for trial countdown).
 */
export const trialDaysRemaining = (user: User | null): number => {
  if (!user?.trial_ends_at) return 0;
  if (user.subscription_status === 'active') return 0;
  const ms = new Date(user.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
};

/**
 * Returns true when the user's trial has expired and they don't have an active
 * subscription (and they are not the admin). Used to trigger the "Upgrade now!"
 * prompt on every app open.
 */
export const shouldShowUpgradePrompt = (user: User | null): boolean => {
  if (!user) return false;
  if (user.email === ADMIN_EMAIL) return false;
  if (user.subscription_status === 'active') return false;

  // Trial expired or never started
  if (user.trial_ends_at) {
    const trialEnd = new Date(user.trial_ends_at).getTime();
    if (Date.now() >= trialEnd) return true;
  }

  // No trial data and no subscription — prompt
  if (!user.trial_ends_at && user.subscription_status !== 'active') return true;

  return false;
};

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
