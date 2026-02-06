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
}

export interface BudgetCategory {
  id: string;
  name: string;
  totalLimit: number;
  externalDeduction?: number;
}

export interface TransactionSplit {
  budget_id: string;
  amount: number;
}

// New: Transaction budget split from database
export interface TransactionBudgetSplit {
  id: string;
  transaction_id: string;
  budget_category: string;
  amount: number;
  percentage?: number;
  created_at: string;
}

// New: Household link from database
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
  notification_title: string;
  notification_text: string;
  notification_timestamp: number;
  posted_at: string;
  extracted_vendor: string;
  extracted_amount: number;
  extracted_timestamp: string;
  confidence: number;
  validation_reasons: string;
  needs_review: boolean;
  pattern_id?: string;
  created_at: string;
  reviewed_at?: string;
  approved?: boolean;
}

// New: Validation baseline for notification parsing
export interface ValidationBaseline {
  id: string;
  app_package: string;
  user_id: string;
  vendor_length_min: number;
  vendor_length_max: number;
  vendor_character_classes: string;
  vendor_case_style: 'title' | 'lower' | 'upper' | 'mixed';
  vendor_forbidden_patterns: string;
  amount_range_min: number;
  amount_range_max: number;
  amount_decimal_places: number;
  confidence_threshold: number;
  sample_count: number;
  created_at: string;
  updated_at: string;
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
}

export interface Transaction {
  id: string;
  user_id: string;
  vendor: string;
  amount: number;
  date: string;
  budget_id: string | null;
  recurrence?: Recurrence | 'One-time' | 'Biweekly' | 'Monthly';
  label?: TransactionLabel | 'Auto-Added' | 'Manual' | 'Auto-Added + Edited';
  is_projected: boolean;
  userName?: string;
  splits?: TransactionSplit[];
  created_at: string;

  // 🔽 New: used only on the client for notification correction / flagging
  notification_rule_id?: string;
  raw_notification?: string;
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
  hasSeenTutorial?: boolean;
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
    hasSeenTutorial: boolean;
    notificationsEnabled: boolean;
    hiddenCategories: string[]; // IDs of hidden budget categories
  };
}
