// lib/recurringExecutor.ts
// Checks for recurring transactions that are due and inserts them.
// Piggybacks on app open / notification listener events.
// Uses localStorage to avoid re-processing the same day.

import { supabase } from './supabase';
import type { Transaction } from '../types';

/**
 * Resolve a budget_id (e.g. 'budget:groceries') to the enum name ('Groceries')
 * that the transactions.budget column expects.
 */
function budgetIdToName(budgetId: string | null): string {
  if (!budgetId) return 'Other';
  // 'budget:groceries' -> 'Groceries'
  if (budgetId.startsWith('budget:')) {
    const name = budgetId.slice('budget:'.length).replace(/-/g, ' ');
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  // Already a plain name or UUID fallback
  return budgetId;
}

const LAST_RUN_KEY = 'covault_recurring_last_run';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function toLocalIsoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Check if a recurring transaction is due today. */
function isDue(txDate: string, recurrence: string, today: Date): string | null {
  const rec = recurrence.toLowerCase();
  if (rec === 'one-time' || !rec) return null;

  // Strip any timestamp suffix to get just YYYY-MM-DD
  const baseStr = txDate.slice(0, 10);
  const parts = baseStr.split('-');
  if (parts.length < 3) return null;
  const base = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  if (isNaN(base.getTime())) return null;

  // If base is in the future, never due
  if (base > today) return null;

  const todayStr = toLocalIsoDay(today);
  let current = new Date(base);

  while (true) {
    if (rec === 'biweekly') {
      current = new Date(current);
      current.setDate(current.getDate() + 14);
    } else if (rec === 'monthly') {
      current = new Date(current);
      current.setMonth(current.getMonth() + 1);
    } else {
      break;
    }

    const currentStr = toLocalIsoDay(current);
    if (currentStr === todayStr) return currentStr;
    if (current > today) break;
  }

  return null;
}

/**
 * Execute any recurring transactions that are due today.
 * Idempotent — skips if already run today.
 */
export async function executeRecurringTransactions(
  userId: string,
  transactions: Transaction[],
): Promise<Transaction[]> {
  const today = todayStr();

  // Only run once per day
  const lastRun = localStorage.getItem(LAST_RUN_KEY);
  if (lastRun === today) return [];

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Find existing transaction dates to prevent duplicates
  // Normalize date to YYYY-MM-DD so the key matches the dueDate format
  const existingKeys = new Set(
    transactions.map((t) => `${t.vendor}|${t.amount}|${(t.date || '').slice(0, 10)}|${t.budget_id || ''}`),
  );

  const toInsert: Array<{
    user_id: string;
    vendor: string;
    amount: number;
    date: string;
    budget: string;
    recur: string;
    type: string;
    is_projected: boolean;
  }> = [];

  for (const tx of transactions) {
    const rec = ((tx as any).recur ?? tx.recurrence ?? '').toString();
    const dueDate = isDue(tx.date, rec, now);
    if (!dueDate) continue;

    // Don't re-insert if identical transaction already exists for this date
    const key = `${tx.vendor}|${tx.amount}|${dueDate}|${tx.budget_id || ''}`;
    if (existingKeys.has(key)) continue;

    toInsert.push({
      user_id: userId,
      vendor: tx.vendor,
      amount: tx.amount,
      date: dueDate,
      budget: budgetIdToName(tx.budget_id),
      recur: rec,
      type: 'Automatic',
      is_projected: false,
    });

    // Track to prevent dupes within this batch
    existingKeys.add(key);
  }

  if (toInsert.length === 0) {
    localStorage.setItem(LAST_RUN_KEY, today);
    return [];
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert(toInsert)
    .select();

  if (error) {
    console.error('[recurringExecutor] insert error:', error);
    return [];
  }

  localStorage.setItem(LAST_RUN_KEY, today);

  // Return inserted rows as Transaction objects
  return (data || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    vendor: row.vendor,
    amount: Number(row.amount),
    date: row.date,
    budget_id: row.budget ? `budget:${row.budget.toLowerCase()}` : null,
    recurrence: row.recur,
    label: 'Automatic' as const,
    is_projected: false,
    created_at: row.created_at || new Date().toISOString(),
  }));
}
