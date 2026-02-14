// lib/hooks/transactionMappers.ts
import { useCallback } from 'react';
import type { Transaction } from '../../types';
import { Recurrence } from '../../types';

// Valid recurrence values that must match the database CHECK constraint
const VALID_RECURRENCES = [
  Recurrence.ONE_TIME,
  Recurrence.BIWEEKLY,
  Recurrence.MONTHLY,
];

// Build the object Supabase expects — only columns that exist in the table
export const useToSupabaseTransaction = () =>
  useCallback((tx: Transaction) => {
    // Extract the YYYY-MM-DD portion directly from the date string to avoid
    // timezone-related date shifts that occur when round-tripping through the
    // Date constructor (e.g. "2025-03-01T00:00:00Z" parsed in UTC-8 becomes
    // Feb 28 locally).
    const dateStr = tx.date.slice(0, 10);

    // Validate required fields
    if (!tx.budget_id) {
      throw new Error(`Transaction must have a valid budget_id (category_id). Got: ${tx.budget_id}`);
    }

    // Validate and set recurrence value
    let recurrence: string = Recurrence.ONE_TIME;
    if (tx.recurrence) {
      if (VALID_RECURRENCES.includes(tx.recurrence)) {
        recurrence = tx.recurrence;
      } else {
        console.warn(`Invalid recurrence value "${tx.recurrence}", defaulting to "${Recurrence.ONE_TIME}"`);
      }
    }

    const row: Record<string, any> = {
      id: tx.id,
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
    if (tx.description !== undefined) row.Description = tx.description || null;

    return row;
  }, []);

// Convert Supabase transaction to app format
export const useFromSupabaseTransaction = () =>
  useCallback((row: any): Transaction => {
    // Validate recurrence value from database
    let recurrence: string = Recurrence.ONE_TIME;
    if (row.recurrence) {
      if (VALID_RECURRENCES.includes(row.recurrence)) {
        recurrence = row.recurrence;
      } else {
        console.warn(`Invalid recurrence value "${row.recurrence}" from database, using "${Recurrence.ONE_TIME}"`);
      }
    }

    return {
      id: row.id,
      user_id: row.user_id,
      vendor: row.vendor,
      amount: parseFloat(row.amount),
      // Keep date as a YYYY-MM-DD string (with a noon-UTC timestamp appended so
      // that slicing to 10 chars always yields the correct calendar date regardless
      // of the user's timezone).
      date: typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
        ? row.date + 'T12:00:00.000Z'
        : new Date(row.date).toISOString(),
      budget_id: row.category_id,
      recurrence: recurrence,
      label: row.label,
      is_projected: row.is_projected,
      userName: row.user_name || '',
      description: row.Description || row.description || '',
      created_at: row.created_at,
    };
  }, []);
