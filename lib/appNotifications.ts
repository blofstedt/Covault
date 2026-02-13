// lib/appNotifications.ts
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { BudgetCategory, Transaction, NotificationRule } from '../types';

// Settings shape
interface NotificationSettingsShape {
  app_notifications_enabled?: boolean;
  notification_rules?: NotificationRule[];
}

// LocalStorage keys to avoid spamming notifications
function makeRuleKey(userId: string, ruleId: string) {
  return `covault_alert_rule_${userId}_${ruleId}`;
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

function evaluateBudgetRule(
  rule: NotificationRule,
  budgets: BudgetCategory[],
  transactions: Transaction[],
): { triggered: boolean; title: string; body: string } {
  const targetBudgets =
    rule.subjectType === 'specific_budget'
      ? budgets.filter((b) => b.id === rule.subjectId)
      : budgets;

  for (const budget of targetBudgets) {
    const limit = Number(budget.totalLimit ?? 0);
    if (!limit || limit <= 0) continue;

    const spent = getSpentForBudget(budget.id, transactions);
    const ratio = spent / limit;

    const thresholdVal = rule.budgetThresholdValue ?? 0;
    const isPercent = rule.budgetThresholdType === 'percent';
    const thresholdRatio = isPercent ? thresholdVal / 100 : thresholdVal / limit;
    const thresholdLabel = isPercent ? `${thresholdVal}%` : `$${thresholdVal}`;

    switch (rule.budgetCondition) {
      case 'within':
        if (ratio >= 1 - thresholdRatio && ratio < 1) {
          return {
            triggered: true,
            title: 'Budget warning',
            body: `${budget.name} is within ${thresholdLabel} of its limit ($${spent.toFixed(0)} of $${limit.toFixed(0)}).`,
          };
        }
        break;
      case 'over':
        if (isPercent ? ratio >= 1 + thresholdRatio : spent >= limit + thresholdVal) {
          return {
            triggered: true,
            title: 'Budget exceeded',
            body: `${budget.name} is over its limit by ${thresholdLabel} ($${spent.toFixed(0)} of $${limit.toFixed(0)}).`,
          };
        }
        break;
      case 'under':
        if (isPercent ? ratio <= thresholdRatio : spent <= thresholdVal) {
          return {
            triggered: true,
            title: 'Budget update',
            body: `${budget.name} is under ${thresholdLabel} ($${spent.toFixed(0)} spent).`,
          };
        }
        break;
    }
  }

  return { triggered: false, title: '', body: '' };
}

function evaluateBalanceRule(
  rule: NotificationRule,
  remainingMoney: number,
): { triggered: boolean; title: string; body: string } {
  const threshold = rule.balanceThresholdValue ?? 0;

  if (rule.balanceCondition === 'falls_below' && remainingMoney <= threshold) {
    return {
      triggered: true,
      title: 'Balance alert',
      body: `Your remaining balance ($${remainingMoney.toFixed(0)}) has fallen below $${threshold}.`,
    };
  }

  if (rule.balanceCondition === 'is_over' && remainingMoney >= threshold) {
    return {
      triggered: true,
      title: 'Balance update',
      body: `Your remaining balance ($${remainingMoney.toFixed(0)}) is over $${threshold}.`,
    };
  }

  return { triggered: false, title: '', body: '' };
}

/**
 * Evaluates custom notification rules and fires local notifications.
 * Uses localStorage flags to avoid firing the same rule alert repeatedly.
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

    const rules = settings.notification_rules || [];

    for (const rule of rules) {
      if (!rule.enabled) continue;

      let result = { triggered: false, title: '', body: '' };

      if (rule.subjectType === 'specific_budget' || rule.subjectType === 'all_budgets') {
        result = evaluateBudgetRule(rule, budgets, transactions);
      } else if (rule.subjectType === 'remaining_balance') {
        result = evaluateBalanceRule(rule, remainingMoney);
      }
      // Recurring transaction rules are timing-based and evaluated elsewhere

      if (result.triggered) {
        const key = makeRuleKey(userId, rule.id);
        const alreadySent =
          typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
        if (!alreadySent) {
          await sendNotification(result.title, result.body);
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, '1');
          }
        }
      }
    }
  } catch (e) {
    console.error('[appNotifications] check error', e);
  }
}
