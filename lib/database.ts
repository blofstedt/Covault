import { supabase } from './supabase';
import { PrimaryCategory, Transaction, Settings } from '../types';

// Fetch user settings from user_profiles by user ID
export async function getUserSettings(userId: string): Promise<Settings | null> {
  const { data, error } = await supabase
    .from('user_profiles')
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
    .from('transactions')
    .select('*')
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching user transactions:', error.message);
    return [];
  }

  return data ?? [];
}

// Fetch categories
export async function getCategories(): Promise<PrimaryCategory[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*');

  if (error) {
    console.error('Error fetching categories:', error.message);
    return [];
  }

  return data ?? [];
}

// Create a new transaction
export async function addTransaction(transaction: Partial<Transaction>): Promise<{ error: any }> {
  const { error } = await supabase
    .from('transactions')
    .insert([transaction]);

  if (error) {
    console.error('Error adding transaction:', error.message);
  }

  return { error };
}

// Update an existing transaction
export async function updateTransaction(transactionId: string, updates: Partial<Transaction>): Promise<{ data: Transaction | null; error: any }> {
  const { data, error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', transactionId)
    .single();

  if (error) {
    console.error('Error updating transaction:', error.message);
    return { data: null, error };
  }

  return { data, error: null };
}

// Delete a transaction by ID
export async function deleteTransaction(transactionId: string): Promise<{ error: any }> {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', transactionId);

  if (error) {
    console.error('Error deleting transaction:', error.message);
  }

  return { error };
}

// Update user profile/settings
export async function updateUserSettings(userId: string, updates: Partial<Settings>): Promise<{ error: any }> {
  const { error } = await supabase
    .from('user_profiles')
    .update(updates)
    .eq('user_id', userId);

  if (error) {
    console.error('Error updating settings:', error.message);
  }

  return { error };
}
