import type { AppState, User, BudgetCategory, Transaction, PendingTransaction } from '../types';
import { SYSTEM_CATEGORIES } from '../constants';

const FAKE_USER_ID = 'dev-user-00000000-0000-0000-0000-000000000000';
const FAKE_PARTNER_ID = 'dev-partner-00000000-0000-0000-0000-000000000000';

const today = new Date();
const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

function fakeUser(solo: boolean): User {
  return {
    id: FAKE_USER_ID,
    name: 'Dev User',
    email: 'dev@covault.test',
    budgetingSolo: solo,
    hasJointAccounts: !solo,
    monthlyIncome: 5000,
    partnerId: solo ? undefined : FAKE_PARTNER_ID,
    partnerEmail: solo ? undefined : 'partner@covault.test',
    partnerName: solo ? undefined : 'Dev Partner',
    subscription_status: 'active',
  };
}

function fakeBudgets(): BudgetCategory[] {
  return SYSTEM_CATEGORIES.map((c) => ({ ...c }));
}

function fakeTransactions(budgets: BudgetCategory[]): Transaction[] {
  const vendors = [
    { vendor: 'Whole Foods', budgetName: 'Groceries', amount: 87.42 },
    { vendor: 'Shell Gas', budgetName: 'Transport', amount: 55.0 },
    { vendor: 'Netflix', budgetName: 'Leisure', amount: 15.99 },
    { vendor: 'Electric Co', budgetName: 'Utilities', amount: 120.0 },
    { vendor: 'Landlord', budgetName: 'Housing', amount: 1200.0 },
    { vendor: 'Barber Shop', budgetName: 'Services', amount: 25.0 },
    { vendor: 'Amazon', budgetName: 'Other', amount: 34.99 },
    { vendor: 'Trader Joe\'s', budgetName: 'Groceries', amount: 62.15 },
    { vendor: 'Spotify', budgetName: 'Leisure', amount: 9.99 },
    { vendor: 'Water Utility', budgetName: 'Utilities', amount: 45.0 },
  ];

  return vendors.map((v, i) => {
    const budget = budgets.find((b) => b.name === v.budgetName) || budgets[0];
    const day = String(Math.min(i + 1, 28)).padStart(2, '0');
    return {
      id: `dev-tx-${i}`,
      user_id: FAKE_USER_ID,
      vendor: v.vendor,
      amount: v.amount,
      date: `${ym}-${day}T00:00:00.000Z`,
      budget_id: budget.id,
      is_projected: false,
      label: i < 3 ? 'Auto-Added' as const : 'Manual' as const,
      recurrence: i === 2 || i === 4 ? 'Monthly' as const : 'One-time' as const,
      created_at: new Date().toISOString(),
    };
  });
}

function fakePendingTransactions(): PendingTransaction[] {
  return [
    {
      id: 'dev-pending-1',
      user_id: FAKE_USER_ID,
      app_package: 'com.chase.mobile',
      app_name: 'Chase',
      notification_title: 'Transaction Alert',
      notification_text: 'You made a $42.50 purchase at Target',
      notification_timestamp: Date.now(),
      posted_at: new Date().toISOString(),
      extracted_vendor: 'Target',
      extracted_amount: 42.5,
      extracted_timestamp: new Date().toISOString(),
      confidence: 0.95,
      validation_reasons: 'Amount and vendor extracted successfully',
      needs_review: true,
      pattern_id: 'demo-pattern',
      created_at: new Date().toISOString(),
    },
    {
      id: 'dev-pending-2',
      user_id: FAKE_USER_ID,
      app_package: 'com.chase.mobile',
      app_name: 'Chase',
      notification_title: 'Transaction Alert',
      notification_text: 'You made a $18.75 purchase at Starbucks',
      notification_timestamp: Date.now() - 3600000,
      posted_at: new Date(Date.now() - 3600000).toISOString(),
      extracted_vendor: 'Starbucks',
      extracted_amount: 18.75,
      extracted_timestamp: new Date(Date.now() - 3600000).toISOString(),
      confidence: 0.88,
      validation_reasons: 'Amount and vendor extracted successfully',
      needs_review: true,
      pattern_id: 'demo-pattern',
      created_at: new Date(Date.now() - 3600000).toISOString(),
    },
  ];
}

/**
 * Build a complete fake AppState for developer mode.
 */
export function buildDevState(options: {
  solo: boolean;
  notificationsEnabled: boolean;
}): AppState {
  const budgets = fakeBudgets();
  return {
    user: fakeUser(options.solo),
    budgets,
    transactions: fakeTransactions(budgets),
    pendingTransactions: fakePendingTransactions(),
    settings: {
      rolloverEnabled: true,
      rolloverOverspend: false,
      useLeisureAsBuffer: true,
      showSavingsInsight: true,
      theme: 'light',
      hasSeenTutorial: true,
      notificationsEnabled: options.notificationsEnabled,
      app_notifications_enabled: false,
      hiddenCategories: [],
    },
  };
}
