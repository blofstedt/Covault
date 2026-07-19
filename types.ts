export interface User {
  id: string;
  name: string;
  email: string;
  partnerId?: string;
  partnerEmail?: string;
  partnerName?: string;
  hasJointAccounts: boolean;
  budgetingSolo: boolean;
  monthlyIncome: number;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_consumed?: boolean;
  subscription_status?: 'none' | 'active' | 'expired';
}

export interface BudgetCategory {
  id: string;
  name: string;
  totalLimit: number;
  externalDeduction?: number;
}

// New: Pending transaction awaiting approval
export interface PendingTransaction {
  id: string;
  user_id: string;
  app_package: string;
  app_name: string;
  notification_timestamp: number;
  posted_at: string;
  extracted_vendor: string;
  extracted_amount: number;
  extracted_timestamp: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason?: string;
  created_at: string;
  reviewed_at?: string;
}


// Ignored transaction rule type removed — table deleted from backend

export enum Recurrence {
  ONE_TIME = 'One-time',
  BIWEEKLY = 'Biweekly',
  MONTHLY = 'Monthly',
}

export enum TransactionLabel {
  AUTOMATIC = 'Automatic',
  MANUAL = 'Manual',
}

/** Where a transaction came from. Used by the dedup logic to distinguish
 *  "two real charges in the same month" from "same charge, different day". */
export type TransactionSource = 'executor' | 'notification' | 'manual' | 'import';

export interface Transaction {
  id: string;
  user_id: string;
  vendor: string;
  amount: number;
  date: string;
  budget_id: string | null;
  recurrence?: Recurrence | 'One-time' | 'Biweekly' | 'Monthly';
  label?: 'Automatic' | 'Manual';
  is_projected: boolean;
  is_income?: boolean;
  caught_cleared?: boolean;
  /**
   * True when this expense was refunded by a matched refund notification.
   * The renderer applies strikethrough; the budget reduce excludes the
   * amount from the spent total. No separate refund row is inserted.
   */
  refunded?: boolean;
  userName?: string;
  created_at: string;
  /** Origin of this row. Populated by the writer (executor/AI/manual/import).
   *  Not persisted on the in-memory type for projected/legacy rows. */
  source?: TransactionSource;
  /** Set by the AI pipeline when the new transaction looks like a soft duplicate
   *  of an existing one (same vendor, different amount). The UI shows a badge.
   *  This is an in-memory only field — never persisted to DB. */
  softDuplicateOf?: {
    id: string;
    vendor: string;
    amount: number;
    date: string;
  };

}

export interface Settings {
  userId: string;
  name: string;
  email: string;
  partnerId?: string;
  partnerEmail?: string;
  partnerName?: string;
  hasJointAccounts?: boolean;
  budgetingSolo?: boolean;
  monthlyIncome?: number;
  rolloverEnabled?: boolean;
  rolloverOverspend?: boolean;
  useLeisureAsBuffer?: boolean;
  showSavingsInsight?: boolean;
  theme?: 'light' | 'dark';
}

export interface AppState {
  user: User | null;
  budgets: BudgetCategory[];
  transactions: Transaction[];
  pendingTransactions?: PendingTransaction[]; // New: pending transactions awaiting approval
  settings: {
    rolloverEnabled: boolean;
    rolloverOverspend: boolean;
    useLeisureAsBuffer: boolean;
    showSavingsInsight: boolean;
    theme: 'light' | 'dark';
    notificationsEnabled: boolean;
    hiddenCategories: string[]; // IDs of hidden budget categories
    app_notifications_enabled: boolean;
    smart_notifications_enabled: boolean;
  };
}


