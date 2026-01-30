// lib/appNotifications.ts
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { BudgetCategory, Transaction } from '../types';

// Settings shape – we only care about app_notifications_enabled
interface NotificationSettingsShape {
  app_notifications_enabled?: boolean;
}

// LocalStorage keys to avoid spamming notifications
function makeBudgetKey(userId: string, budgetId: string, level: '75' | '100') {
  return `covault_alert_budget_${userId}_${budgetId}_${level}`;
}

function makeRemainingKey(userId: string, level: '25' | '0') {
  return `covault_alert_remaining_${userId}_${level}`;
}

async function ensurePermission() {
  const perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') {
    await LocalNotifications.requestPermissions();
  }
}

async function sendNotification(title: string, body: string) {
  if (!Capacitor.isNativePlatform()) return;

  await ensurePermission();

  await LocalNotifications.schedule({
    notifications: [
      {
        id: Date.now() % 2147483647, // simple unique-ish id
        title,
        body,
        schedule: { at: new Date(Date.now() + 1000) },
      },
    ],
  });
}

// Compute how much is spent in a budget for the given transactions
function getSpentForBudget(budgetId: string, txs: Transaction[]): number {
  return txs.reduce((acc, tx) => {
    if (tx.is_projected) return acc; // only real transactions

    if (tx.splits && tx.splits.length > 0) {
      const split = tx.splits.find((s: any) => s.budget_id === budgetId);
      return acc + (split ? Number(split.amount) : 0);
    }

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
 * Checks thresholds and fires local notifications if:
 * - A budget crosses 75% used
 * - A budget reaches/exceeds 100% used
 * - Remaining money <= 25% of income
 * - Remaining money <= 0
 *
 * Uses localStorage flags to avoid firing the same alert repeatedly.
 */
export async function checkAndTriggerAppNotifications({
  userId,
  budgets,
  transactions,
  totalIncome,
  remainingMoney,
  settings,
}: CheckArgs) {
  if (!Capacitor.isNativePlatform()) return;
  if (!settings.app_notifications_enabled) return;
  if (!userId) return;

  // ----- Budget alerts -----
  for (const budget of budgets) {
    const limit = Number((budget as any).totalLimit ?? 0);
    if (!limit || limit <= 0) continue;

    const spent = getSpentForBudget(budget.id, transactions);
    const ratio = spent / limit;

    // 75% alert
    if (ratio >= 0.75 && ratio < 1) {
      const key75 = makeBudgetKey(userId, budget.id, '75');
      const already75 = localStorage.getItem(key75) === '1';
      if (!already75) {
        await sendNotification(
          'Budget warning',
          `${budget.name} has reached 75% of its limit ($${spent.toFixed(0)} of $${limit.toFixed(0)}).`,
        );
        localStorage.setItem(key75, '1');
      }
    }

    // 100% alert (limit reached or exceeded)
    if (spent >= limit) {
      const key100 = makeBudgetKey(userId, budget.id, '100');
      const already100 = localStorage.getItem(key100) === '1';
      if (!already100) {
        await sendNotification(
          'Budget reached',
          `${budget.name} is fully used ($${spent.toFixed(0)} of $${limit.toFixed(0)}).`,
        );
        localStorage.setItem(key100, '1');
      }
    }
  }

  // ----- Remaining money alerts -----
  if (totalIncome > 0) {
    const threshold25 = totalIncome * 0.25;

    // 25% remaining
    if (remainingMoney <= threshold25 && remainingMoney > 0) {
      const key25 = makeRemainingKey(userId, '25');
      const already25 = localStorage.getItem(key25) === '1';
      if (!already25) {
        await sendNotification(
          'Spending warning',
          `Only 25% of your monthly money remains ($${remainingMoney.toFixed(0)}).`,
        );
        localStorage.setItem(key25, '1');
      }
    }

    // 0 remaining (or below)
    if (remainingMoney <= 0) {
      const key0 = makeRemainingKey(userId, '0');
      const already0 = localStorage.getItem(key0) === '1';
      if (!already0) {
        await sendNotification(
          'Spending limit reached',
          'You have fully used your remaining monthly money.',
        );
        localStorage.setItem(key0, '1');
      }
    }
  }
}
