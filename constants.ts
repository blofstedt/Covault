
import { BudgetCategory } from './types';

export const SYSTEM_CATEGORIES: BudgetCategory[] = [
  { id: '1', name: 'Housing', totalLimit: 1500, subCategories: [] },
  { id: '2', name: 'Groceries', totalLimit: 600, subCategories: [] },
  { id: '3', name: 'Transport', totalLimit: 300, subCategories: [] },
  { id: '4', name: 'Utilities', totalLimit: 150, subCategories: [] },
  { 
    id: '5', 
    name: 'Leisure', 
    totalLimit: 400, 
    subCategories: [
      { id: 'sub_dining', name: 'Dining', allocatedAmount: 200 },
      { id: 'sub_events', name: 'Events', allocatedAmount: 100 }
    ] 
  },
  { id: '6', name: 'Other', totalLimit: 100, subCategories: [] },
];

export const APP_THEME = {
  primary: '#10B981', // Emerald 500
  secondary: '#3B82F6', // Blue 500
  background: '#F8FAFC', // Slate 50
  text: '#1E293B', // Slate 800
  danger: '#EF4444', // Red 500
};