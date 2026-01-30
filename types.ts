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
    notificationsEnabled: boolean;
  };
}
