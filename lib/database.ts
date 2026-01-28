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

// Create a new transaction
export async function addTransaction(transaction: Transaction): Promise<void> {
  const { error } = await supabase
    .from<Transaction>('transactions')
    .insert([transaction]);

  if (error) {
    console.error('Error adding transaction:', error.message);
  }
}

// Update an existing transaction
export async function updateTransaction(transactionId: string, updates: Partial<Transaction>): Promise<Transaction | null> {
  const { data, error } = await supabase
    .from<Transaction>('transactions')
    .update(updates)
    .eq('id', transactionId)
    .single();

  if (error) {
    console.error('Error updating transaction:', error.message);
    return null;
  }

  return data;
}

// Delete a transaction by ID
export async function deleteTransaction(transactionId: string): Promise<void> {
  const { error } = await supabase
    .from<Transaction>('transactions')
    .delete()
    .eq('id', transactionId);

  if (error) {
    console.error('Error deleting transaction:', error.message);
  }
}

// Create a new user budget
export async function addUserBudget(budget: UserBudget): Promise<void> {
  const { error } = await supabase
    .from<UserBudget>('user_budgets')
    .insert([budget]);

  if (error) {
    console.error('Error adding user budget:', error.message);
  }
}

// Update an existing user budget
export async function updateUserBudget(budgetId: string, updates: Partial<UserBudget>): Promise<void> {
  const { error } = await supabase
    .from<UserBudget>('user_budgets')
    .update(updates)
    .eq('id', budgetId);

  if (error) {
    console.error('Error updating user budget:', error.message);
  }
}

// Delete a user budget by ID
export async function deleteUserBudget(budgetId: string): Promise<void> {
  const { error } = await supabase
    .from<UserBudget>('user_budgets')
    .delete()
    .eq('id', budgetId);

  if (error) {
    console.error('Error deleting user budget:', error.message);
  }
}

// Add new user settings entry
export async function addUserSettings(settings: Settings): Promise<void> {
  const { error } = await supabase
    .from<Settings>('settings')
    .insert([settings]);

  if (error) {
    console.error('Error adding settings:', error.message);
  }
}

// Update user settings
export async function updateUserSettings(userId: string, updates: Partial<Settings>): Promise<void> {
  const { error } = await supabase
    .from<Settings>('settings')
    .update(updates)
    .eq('user_id', userId);

  if (error) {
    console.error('Error updating settings:', error.message);
  }
}

// Delete user settings entry
export async function deleteUserSettings(userId: string): Promise<void> {
  const { error } = await supabase
    .from<Settings>('settings')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('Error deleting settings:', error.message);
  }
}

// Add a new primary category
export async function addPrimaryCategory(category: PrimaryCategory): Promise<void> {
  const { error } = await supabase
    .from<PrimaryCategory>('primary_categories')
    .insert([category]);

  if (error) {
    console.error('Error adding primary category:', error.message);
  }
}

// Update an existing primary category
export async function updatePrimaryCategory(categoryId: string, updates: Partial<PrimaryCategory>): Promise<void> {
  const { error } = await supabase
    .from<PrimaryCategory>('primary_categories')
    .update(updates)
    .eq('id', categoryId);

  if (error) {
    console.error('Error updating primary category:', error.message);
  }
}

// Delete a primary category
export async function deletePrimaryCategory(categoryId: string): Promise<void> {
  const { error } = await supabase
    .from<PrimaryCategory>('primary_categories')
    .delete()
    .eq('id', categoryId);

  if (error) {
    console.error('Error deleting primary category:', error.message);
  }
}
