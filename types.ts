
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
  id: string;
  name: string;
  totalLimit: number;
}

export interface TransactionSplit {
  budget_id: string;
  amount: number;
}

export interface Transaction {
  id: string;
  user_id: string;
  vendor: string;
  amount: number;
  date: string; 
  budget_id: string;
  recurrence: Recurrence;
  label: TransactionLabel;
  is_projected: boolean;
  splits?: TransactionSplit[];
  created_at?: string;
  userName: string; 
}

export interface User {
  id: string;
  name: string;
  email: string;
  linkedUserEmail?: string;
  isLinked: boolean;
  bankAccountMode: 'shared' | 'separate';
  budgetingSolo: boolean;
}

export interface AppState {
  user: User | null;
  budgets: BudgetCategory[];
  transactions: Transaction[];
  currentMode: 'Mine' | 'Ours';
  settings: {
    rolloverEnabled: boolean;
    rolloverOverspend: boolean;
    useLeisureAsBuffer: boolean;
    showSavingsInsight: boolean;
    theme: 'light' | 'dark';
    monthlyIncome: number;
    hasSeenTutorial: boolean;
  };
}
