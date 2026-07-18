// lib/appNotifications.ts
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { BudgetCategory, Transaction } from '../types';

export interface NotificationSettingsShape {
  app_notifications_enabled?: boolean;
  smart_notifications_enabled?: boolean;
}

// LocalStorage keys to avoid spamming notifications
function makeBudgetAlertKey(userId: string, budgetId: string) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `covault_alert_budget_${userId}_${budgetId}_${month}`;
}

function makeBalanceAlertKey(userId: string) {
  // Include the month so the user is re-notified if their balance goes
  // negative again in a later month. Mirrors `makeBudgetAlertKey`.
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `covault_alert_balance_${userId}_${month}`;
}

async function ensurePermission() {
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      await LocalNotifications.requestPermissions();
    }
  } catch (e) {
    console.error('[appNotifications] permission error', e);
  }
}

// Android notification icon config.
// `smallIcon` is a monochrome drawable (white on transparent) — the
// system tints it with `iconColor` at render time. Without these, the
// status bar shows a generic "(!)" placeholder and the notification
// looks like it came from an unbranded system app.
const NOTIF_SMALL_ICON = 'ic_stat_covault_mono';
const NOTIF_ICON_COLOR = '#10B981'; // Covault emerald

async function sendNotification(title: string, body: string) {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await ensurePermission();

    await LocalNotifications.schedule({
      notifications: [
        {
          id: Date.now() % 2147483647,
          title,
          body,
          schedule: { at: new Date(Date.now() + 1000) },
          // Android-only fields — ignored on iOS.
          // See android-custom/res/drawable/ic_stat_covault_mono.xml
          // (the new monochrome status-bar vector) and
          // android-custom/res/drawable/ic_stat_covault.xml (legacy
          // raster fallback synced by scripts/sync-android.sh).
          smallIcon: NOTIF_SMALL_ICON,
          iconColor: NOTIF_ICON_COLOR,
        },
      ],
    });
  } catch (e) {
    console.error('[appNotifications] schedule error', e);
  }
}

// Compute how much is spent in a budget for the given transactions
function getSpentForBudget(budgetId: string, txs: Transaction[]): number {
  return txs.reduce((acc, tx) => {
    if (tx.is_projected) return acc; // only real transactions

    if (tx.budget_id === budgetId) {
      return acc + Number(tx.amount);
    }

    return acc;
  }, 0);
}

interface CheckArgs {
  userId: string;
  budgets: BudgetCategory[];
  transactions: Transaction[]; // current month transactions
  totalIncome: number;
  remainingMoney: number;
  settings: NotificationSettingsShape;
}

/**
 * Evaluates budget thresholds and fires local notifications.
 * Uses localStorage flags to avoid firing the same alert repeatedly.
 *
 * Alerts when a budget exceeds 90% of its limit.
 */
export async function checkAndTriggerAppNotifications({
  userId,
  budgets,
  transactions,
  totalIncome,
  remainingMoney,
  settings,
}: CheckArgs) {
  try {
    if (!Capacitor.isNativePlatform()) return;
    if (!settings?.app_notifications_enabled && !settings?.smart_notifications_enabled) return;
    if (!userId) return;

    // Check each budget for overspend
    for (const budget of budgets) {
      const limit = Number(budget.totalLimit ?? 0);
      if (!limit || limit <= 0) continue;

      const spent = getSpentForBudget(budget.id, transactions);
      const ratio = spent / limit;

      if (ratio >= 0.8) {
        const key = makeBudgetAlertKey(userId, budget.id);
        const alreadySent =
          typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
        if (!alreadySent) {
          const title = ratio >= 1 ? 'Budget exceeded' : 'Budget warning';
          const body = ratio >= 1
            ? `${budget.name} is over its limit ($${spent.toFixed(0)} of $${limit.toFixed(0)}).`
            : `${budget.name} is at ${Math.round(ratio * 100)}% of its limit ($${spent.toFixed(0)} of $${limit.toFixed(0)}).`;
          await sendNotification(title, body);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, '1');
          }
        }
      }
    }

    // Check remaining balance
    if (remainingMoney <= 0) {
      const key = makeBalanceAlertKey(userId);
      const alreadySent =
        typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
      if (!alreadySent) {
        await sendNotification(
          'Balance alert',
          `Your remaining balance ($${remainingMoney.toFixed(0)}) has gone negative.`,
        );
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, '1');
        }
      }
    }
  } catch (e) {
    console.error('[appNotifications] check error', e);
  }
}

/**
 * Send a push notification when a partner adds a transaction.
 */
export async function sendPartnerActivityNotification(
  partnerName: string,
  vendor: string,
  amount: number,
  settings: NotificationSettingsShape,
) {
  if (!Capacitor.isNativePlatform()) return;
  if (!settings?.smart_notifications_enabled) return;

  await sendNotification(
    'Partner Activity',
    `${partnerName} added $${Math.abs(amount).toFixed(2)} at ${vendor}.`,
  );
}

/**
 * Send a local notification when the recurring executor auto-inserts
 * one or more due instances. Helps the user notice missed recurrences
 * got caught up without having to dig through their transaction list.
 */
export async function sendRecurringCatchUpNotification(
  inserted: Array<{ vendor: string; amount: number; date: string }>,
) {
  if (!Capacitor.isNativePlatform()) return;
  if (!inserted || inserted.length === 0) return;

  const total = inserted.reduce((acc, t) => acc + Math.abs(t.amount), 0);
  const summary =
    inserted.length === 1
      ? `Added ${inserted[0].vendor} ($${Math.abs(inserted[0].amount).toFixed(2)}) for ${inserted[0].date}.`
      : `Added ${inserted.length} recurring transactions totaling $${total.toFixed(2)}.`;

  await sendNotification('Recurring transactions caught up', summary);
}

/**
 * Send a local notification when Covault AI auto-captures an expense
 * from a bank notification. Helps the user notice charges got logged
 * without them having to open the app.
 *
 * Gated on `app_notifications_enabled` so users who turned off
 * app-level notifications don't get surprised. The notification is
 * tagged with the transaction ID as its system notification ID so
 * that:
 *   - Re-firing for the same transaction (e.g. from a manual rescan
 *     that won the race-recovery) overwrites the existing
 *     notification instead of stacking.
 *   - Tapping the notification can be associated back to the
 *     transaction in future deep-linking work.
 */
export async function sendExpenseCapturedNotification(
  transactionId: string,
  vendor: string,
  amount: number,
  categoryName: string | null,
  settings: NotificationSettingsShape,
) {
  if (!Capacitor.isNativePlatform()) return;
  if (!settings?.app_notifications_enabled) return;

  // Negative amounts are refunds/income — the user said they prefer
  // to be notified about "captured" expenses, which is the common
  // case. Refunds also get a notification but with a different title
  // so the user knows it's money coming back, not going out.
  const isIncome = amount < 0;
  const absAmount = Math.abs(amount);
  const categorySuffix = categoryName ? ` → ${categoryName}` : '';
  const body = isIncome
    ? `+$${absAmount.toFixed(2)} at ${vendor}${categorySuffix}.`
    : `$${absAmount.toFixed(2)} at ${vendor}${categorySuffix}.`;
  const title = isIncome ? 'Income captured!' : 'Expense captured!';

  try {
    await ensurePermission();
    // Use a stable, deterministic ID derived from the transaction UUID.
    // LocalNotifications ID is a 32-bit int, so we hash the UUID and
    // mask to the positive int range. This means the same transaction
    // always reuses the same system notification ID, preventing the
    // same charge from generating multiple notifications if the
    // pipeline runs twice (e.g. on app restart with a stale listener).
    let id = 0;
    for (let i = 0; i < transactionId.length; i++) {
      id = ((id * 31) + transactionId.charCodeAt(i)) | 0;
    }
    id = Math.abs(id);

    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          schedule: { at: new Date(Date.now() + 1000) },
          smallIcon: NOTIF_SMALL_ICON,
          iconColor: NOTIF_ICON_COLOR,
        },
      ],
    });
  } catch (e) {
    console.error('[appNotifications] expense-captured schedule error', e);
  }
}
