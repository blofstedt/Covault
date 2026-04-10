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
  userName?: string;
  created_at: string;

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
    smart_cards_enabled: boolean;
    smart_notifications_enabled: boolean;
  };
}


