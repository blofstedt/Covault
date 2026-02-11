// lib/hooks/transactionMappers.ts
import { useCallback } from 'react';
import type { Transaction } from '../../types';

// Valid recurrence values that must match the database CHECK constraint
const VALID_RECURRENCES = ['One-time', 'Biweekly', 'Monthly'];

// Build the object Supabase expects — only columns that exist in the table
export const useToSupabaseTransaction = () =>
  useCallback((tx: Transaction) => {
    const dateStr = new Date(tx.date).toISOString().split('T')[0];

    // Validate required fields
    if (!tx.budget_id) {
      throw new Error(`Transaction must have a valid budget_id (category_id). Got: ${tx.budget_id}`);
    }

    // Validate and set recurrence value
    let recurrence: string = 'One-time';
    if (tx.recurrence) {
      if (VALID_RECURRENCES.includes(tx.recurrence)) {
        recurrence = tx.recurrence;
      } else {
        console.warn(`Invalid recurrence value "${tx.recurrence}", defaulting to "One-time"`);
      }
    }

    const row: Record<string, any> = {
      user_id: tx.user_id,
      vendor: tx.vendor,
      amount: Number(tx.amount),
      date: dateStr,
      category_id: tx.budget_id,
      recurrence: recurrence,
      label: tx.label || 'Manual',
      is_projected: tx.is_projected ?? false,
    };

    if (tx.userName) row.user_name = tx.userName;
    if (tx.splits && tx.splits.length > 1) row.split_group_id = tx.id;
    if (tx.description !== undefined) row.description = tx.description || null;

    return row;
  }, []);

// Convert Supabase transaction to app format
export const useFromSupabaseTransaction = () =>
  useCallback((row: any): Transaction => {
    // Validate recurrence value from database
    let recurrence: string = 'One-time';
    if (row.recurrence) {
      if (VALID_RECURRENCES.includes(row.recurrence)) {
        recurrence = row.recurrence;
      } else {
        console.warn(`Invalid recurrence value "${row.recurrence}" from database, using "One-time"`);
      }
    }

    return {
      id: row.id,
      user_id: row.user_id,
      vendor: row.vendor,
      amount: parseFloat(row.amount),
      date: new Date(row.date).toISOString(),
      budget_id: row.category_id,
      recurrence: recurrence,
      label: row.label,
      is_projected: row.is_projected,
      userName: row.user_name || '',
      description: row.description || '',
      created_at: row.created_at,
    };
  }, []);
