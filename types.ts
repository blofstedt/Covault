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

export interface Transaction {
  id: string;
  userId: string;
  vendor: string;
  amount: number;
  date: string;
  budgetId: string | null;
  recurrence?: 'One-time' | 'Biweekly' | 'Monthly';
  label?: 'Auto-Added' | 'Manual' | 'Auto-Added + Edited';
  isProjected: boolean;
  userName?: string;
  splits?: Record<string, any>;
  createdAt: string;
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

export type Recurrence = 'One-time' | 'Biweekly' | 'Monthly';
