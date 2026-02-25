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
export const useToSupabaseTransaction = (budgets: { id: string; name: string }[] = []) =>
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
      if (VALID_RECURRENCES.includes(tx.recurrence as Recurrence)) {
        recurrence = tx.recurrence;
      } else {
        console.warn(`Invalid recurrence value "${tx.recurrence}", defaulting to "${Recurrence.ONE_TIME}"`);
      }
    }

    const budgetName = budgets.find(b => b.id === tx.budget_id)?.name || tx.budget_id;

    const row: Record<string, any> = {
      id: tx.id,
      user_id: tx.user_id,
      vendor: tx.vendor,
      amount: Number(tx.amount),
      date: dateStr,
      is_projected: tx.is_projected ?? false,
      // New schema (support lowercase/uppercase budget column variants)
      budget: budgetName,
      Budget: budgetName,
      type: tx.label || 'Manual',
      recur: recurrence,
      // Legacy schema compatibility
      category_id: tx.budget_id,
      label: tx.label || 'Manual',
      recurrence: recurrence,
    };

    if (tx.userName) row.user_name = tx.userName;

    return row;
  }, []);

// Convert Supabase transaction to app format
export const useFromSupabaseTransaction = () =>
  useCallback((row: any): Transaction => {
    // Validate recurrence value from database (supports recur or recurrence)
    let recurrence: Recurrence = Recurrence.ONE_TIME;
    const recurrenceRaw = row.recur || row.recurrence;
    if (recurrenceRaw) {
      if (VALID_RECURRENCES.includes(recurrenceRaw as Recurrence)) {
        recurrence = recurrenceRaw as Recurrence;
      } else {
        console.warn(`Invalid recurrence value "${recurrenceRaw}" from database, using "${Recurrence.ONE_TIME}"`);
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
      budget_id: row.category_id || row.budget_id || row.Budget || row.budget || null,
      recurrence: recurrence,
      label: row.label || row.type || 'Manual',
      is_projected: row.is_projected,
      userName: row.user_name || '',
      created_at: row.created_at,
    };
  }, []);
