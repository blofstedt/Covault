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

// Household link from database
export interface HouseholdLink {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
  user1_name?: string;
  user2_name?: string;
}

// New: Link code for household linking
export interface LinkCode {
  code: string;
  user_id: string;
  expires_at: string;
  created_at: string;
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


// Ignored transaction rule (user-defined ignore patterns)
export interface IgnoredTransaction {
  id: string;
  user_id: string;
  vendor_name: string;
  amount?: number;
  bank_app_id?: string;
  expires_at?: string;
  reason: string;
  created_at: string;
}


export enum Recurrence {
  ONE_TIME = 'One-time',
  BIWEEKLY = 'Biweekly',
  MONTHLY = 'Monthly',
}

export enum TransactionLabel {
  AUTO_ADDED = 'Auto-Added',
  MANUAL = 'Manual',
  EDITED = 'Auto-Added + Edited',
  AI = 'AI',
}

export interface Transaction {
  id: string;
  user_id: string;
  vendor: string;
  amount: number;
  date: string;
  budget_id: string | null;
  recurrence?: Recurrence | 'One-time' | 'Biweekly' | 'Monthly';
  label?: TransactionLabel | 'Auto-Added' | 'Manual' | 'Auto-Added + Edited' | 'AI';
  is_projected: boolean;
  userName?: string;
  description?: string;
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
  };
}


