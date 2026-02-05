// lib/hooks/transactionMappers.ts
import { useCallback } from 'react';
import type { Transaction } from '../../types';

// Build the object Supabase expects — only columns that exist in the table
export const useToSupabaseTransaction = () =>
  useCallback((tx: Transaction) => {
    const dateStr = new Date(tx.date).toISOString().split('T')[0];

    const row: Record<string, any> = {
      user_id: tx.user_id,
      vendor: tx.vendor,
      amount: Number(tx.amount),
      date: dateStr,
      category_id: tx.budget_id,
      recurrence: tx.recurrence || 'One-time',
      label: tx.label || 'Manual',
      is_projected: tx.is_projected ?? false,
    };

    if (tx.userName) row.user_name = tx.userName;
    if (tx.splits && tx.splits.length > 1) row.split_group_id = tx.id;

    return row;
  }, []);

// Convert Supabase transaction to app format
export const useFromSupabaseTransaction = () =>
  useCallback((row: any): Transaction => {
    return {
      id: row.id,
      user_id: row.user_id,
      vendor: row.vendor,
      amount: parseFloat(row.amount),
      date: new Date(row.date).toISOString(),
      budget_id: row.category_id,
      recurrence: row.recurrence,
      label: row.label,
      is_projected: row.is_projected,
      userName: row.user_name || '',
      created_at: row.created_at,
    };
  }, []);
