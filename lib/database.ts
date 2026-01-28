import { supabase } from './supabase';
import { PrimaryCategory, Transaction, UserBudget, User, Settings } from '../types';

// Fetch user settings by user ID
export async function getUserSettings(userId: string): Promise<Settings | null> {
  const { data, error } = await supabase
    .from<Settings>('settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    console.error('Error fetching user settings:', error.message);
    return null;
  }

  return data;
}

// Fetch transactions for a user
export async function getUserTransactions(userId: string): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from<Transaction>('transactions')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching user transactions:', error.message);
    return [];
  }

  return data;
}

// Fetch user budgets by user ID
export async function getUserBudgets(userId: string): Promise<UserBudget[]> {
  const { data, error } = await supabase
    .from<UserBudget>('user_budgets')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching user budgets:', error.message);
    return [];
  }

  return data;
}

// Fetch primary categories
export async function getPrimaryCategories(): Promise<PrimaryCategory[]> {
  const { data, error } = await supabase
    .from<PrimaryCategory>('primary_categories')
    .select('*');

  if (error) {
    console.error('Error fetching primary categories:', error.message);
    return [];
  }

  return data;
}

// Add additional database functions as required
