
import { BudgetCategory } from './types';

export const SYSTEM_CATEGORIES: BudgetCategory[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Housing', totalLimit: 0 },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Groceries', totalLimit: 0 },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Transport', totalLimit: 0 },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Utilities', totalLimit: 0 },
  { id: '55555555-5555-5555-5555-555555555555', name: 'Leisure', totalLimit: 0 },
  { id: '66666666-6666-6666-6666-666666666666', name: 'Other', totalLimit: 0 },
];

export const APP_THEME = {
  primary: '#10B981', 
  secondary: '#3B82F6',
  background: '#F8FAFC',
  text: '#1E293B',
  danger: '#EF4444',
};
