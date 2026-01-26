
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

export interface SubCategory {
  id: string;
  name: string;
  allocatedAmount: number;
}

export interface BudgetCategory {
  id: string;
  name: string;
  totalLimit: number;
  subCategories: SubCategory[];
}

export interface TransactionSplit {
  budgetId: string;
  subCategoryId?: string;
  amount: number;
}

export interface Transaction {
  id: string;
  vendor: string;
  amount: number;
  date: string;
  budgetId: string;
  subCategoryId?: string;
  recurrence: Recurrence;
  label: TransactionLabel;
  userId: string;
  userName: string;
  isProjected?: boolean;
  splits?: TransactionSplit[];
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
    useLeisureAsBuffer: boolean; // Updated from negativeBalanceBehavior
    showSavingsInsight: boolean;
    theme: 'light' | 'dark';
  };
}
