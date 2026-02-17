// lib/appNotifications.ts
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { BudgetCategory, Transaction } from '../types';

// Settings shape
interface NotificationSettingsShape {
  app_notifications_enabled?: boolean;
}

// LocalStorage keys to avoid spamming notifications
function makeBudgetAlertKey(userId: string, budgetId: string) {
  return `covault_alert_budget_${userId}_${budgetId}`;
}

function makeBalanceAlertKey(userId: string) {
  return `covault_alert_balance_${userId}`;
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
    if (!settings?.app_notifications_enabled) return;
    if (!userId) return;

    // Check each budget for overspend
    for (const budget of budgets) {
      const limit = Number(budget.totalLimit ?? 0);
      if (!limit || limit <= 0) continue;

      const spent = getSpentForBudget(budget.id, transactions);
      const ratio = spent / limit;

      if (ratio >= 0.9) {
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
