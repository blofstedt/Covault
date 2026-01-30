// lib/database.ts
import { supabase } from './supabase';
import { PrimaryCategory, Transaction, Settings } from '../types';

// Fetch user settings from user_profiles by user ID
export async function getUserSettings(userId: string): Promise<Settings | null> {
  const { data, error } = await supabase
    .from('settings')
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

  return (data as Transaction[]) ?? [];
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

  return (data as PrimaryCategory[]) ?? [];
}

/**
 * Create a new transaction with basic duplicate protection.
 *
 * Duplicate rule:
 * - If the user has a partner with has_joint_accounts = true,
 *   we consider BOTH user_id and partner_id when checking duplicates.
 * - We treat as duplicate any existing "Auto-Added" transaction where:
 *      user_id IN (user, partner)
 *      AND vendor == new vendor
 *      AND amount == new amount
 *      AND date == new date
 *
 * This helps avoid double-logging the same bank transaction when both
 * partners have the banking app installed on the same joint account.
 */
export async function addTransaction(
  transaction: Partial<Transaction>
): Promise<{ error: any }> {
  try {
    // If we don't have the core fields, just insert without dedupe
    if (
      !transaction.user_id ||
      !transaction.vendor ||
      transaction.amount == null ||
      !transaction.date
    ) {
      const { error } = await supabase.from('transactions').insert([transaction]);
      if (error) {
        console.error('Error adding transaction (no dedupe):', error.message);
      }
      return { error };
    }

    const userId = transaction.user_id;

    // 1) Find partner_id + has_joint_accounts from settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('partner_id, has_joint_accounts')
      .eq('user_id', userId)
      .maybeSingle();

    if (settingsError) {
      console.warn(
        'Warning: could not fetch settings for dedupe, proceeding without partner check:',
        settingsError.message
      );
    }

    const userIdsToCheck: string[] = [userId];

    if (settings && settings.has_joint_accounts && settings.partner_id) {
      userIdsToCheck.push(settings.partner_id);
    }

    // 2) Check for existing Auto-Added transaction with same vendor/amount/date
    const { data: existing, error: existingError } = await supabase
      .from('transactions')
      .select('id')
      .in('user_id', userIdsToCheck)
      .eq('vendor', transaction.vendor)
      .eq('amount', transaction.amount)
      .eq('date', transaction.date)
      .eq('label', 'Auto-Added')
      .limit(1);

    if (existingError) {
      console.warn(
        'Warning: error checking for duplicate transaction, proceeding with insert:',
        existingError.message
      );
    } else if (existing && existing.length > 0) {
      // Duplicate detected — do NOT insert a new row
      console.log(
        '[addTransaction] Skipping insert: duplicate Auto-Added transaction detected for vendor, amount, date across joint accounts.'
      );
      return { error: null };
    }

    // 3) No duplicate found → insert transaction normally
    const { error } = await supabase.from('transactions').insert([transaction]);

    if (error) {
      console.error('Error adding transaction:', error.message);
    }

    return { error };
  } catch (err: any) {
    console.error('Unexpected error in addTransaction:', err?.message ?? err);
    return { error: err };
  }
}

// Update an existing transaction
export async function updateTransaction(
  transactionId: string,
  updates: Partial<Transaction>
): Promise<{ data: Transaction | null; error: any }> {
  const { data, error } = await supabase
    .from('transactions')
    .update(updates)
    .eq('id', transactionId)
    .single();

  if (error) {
    console.error('Error updating transaction:', error.message);
    return { data: null, error };
  }

  return { data: data as Transaction, error: null };
}

// Delete a transaction by ID
export async function deleteTransaction(
  transactionId: string
): Promise<{ error: any }> {
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
export async function updateUserSettings(
  userId: string,
  updates: Partial<Settings>
): Promise<{ error: any }> {
  const { error } = await supabase
    .from('settings')
    .update(updates)
    .eq('user_id', userId);

  if (error) {
    console.error('Error updating settings:', error.message);
  }

  return { error };
}
