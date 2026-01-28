export enum Recurrence {
  ONE_TIME = 'One-time',
  BIWEEKLY = 'Biweekly',
  MONTHLY = 'Monthly'
}

export enum TransactionLabel {
  AUTO = 'Auto-Added',
  MANUAL = 'Manual',
  EDITED = 'Auto-Added + Edited'
}

export interface BudgetCategory {
  id: string; // user_budgets ID, specific to the user
  name: string; // comes from primary_categories
  totalLimit: number; // user-defined limit for this budget ID
}

export interface TransactionSplit {
  budget_id: string; // References user_budgets ID
  amount: number;
}

export interface Transaction {
  id: string;
  user_id: string; // References auth.users
  vendor: string;
  amount: number;
  date: string;
  budget_id: string; // References user_budgets ID
  recurrence: Recurrence;
  label: TransactionLabel;
  is_projected: boolean;
  splits?: TransactionSplit[];
  created_at?: string;
  userName: string; // User's name
}

export interface PrimaryCategory {
  id: string;
  name: string; // Immutable name (e.g., Housing, Groceries, etc.)
  displayOrder: number;
}

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

export interface AppState {
  user: User | null;
  budgets: BudgetCategory[];
  transactions: Transaction[];
  settings: {
    rolloverEnabled: boolean;
    rolloverOverspend: boolean;
    useLeisureAsBuffer: boolean;
    showSavingsInsight: boolean;
    theme: 'light' | 'dark';
    hasSeenTutorial: boolean;
  };
}
