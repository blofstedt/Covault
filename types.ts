// types.ts
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

export interface UserBudget {
  id: string;
  userId: string;
  categoryId: string;
  totalLimit: number;
  createdAt: string;
  updatedAt: string;
}

// Database-aligned Transaction shape (snake_case to match Supabase)
export interface Transaction {
  id: string;
  user_id: string;
  vendor: string;
  amount: number;
  date: string;
  category_id: string | null;
  recurrence?: Recurrence;
  label?: TransactionLabel;
  is_projected: boolean;
  user_name?: string;
  splits?: TransactionSplit[] | Record<string, any>;
  created_at: string;
  updated_at?: string;
}

export interface PrimaryCategory {
  id: string;
  name: string;
  displayOrder: number;
  createdAt: string;
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

// UI budget category
export interface BudgetCategory {
  id: string;
  name: string;
  totalLimit: number;
}

// Transaction split (flexible)
export interface TransactionSplit {
  id: string;
  amount: number;
  user_id?: string;
  vendor?: string;
  note?: string;
  [key: string]: any;
}

// Recurrence and label types
export type Recurrence = 'One-time' | 'Biweekly' | 'Monthly';

export type TransactionLabel =
  | 'Auto-Added'
  | 'Manual'
  | 'Auto-Added + Edited';
