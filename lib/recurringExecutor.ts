// lib/recurringExecutor.ts
// Checks for recurring transactions that are due and inserts them.
// Piggybacks on app open / notification listener events.
// Uses localStorage to avoid re-processing the same day.

import { getLocalToday } from './dateUtils';
import { REST_BASE, getAuthHeaders } from './apiHelpers';
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
  return getLocalToday();
}

function toLocalIsoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Step forward from `from` by one recurrence interval (monthly +14 days,
 * biweekly +14 days). Returns a NEW Date — the original is not mutated.
 */
function stepForward(d: Date, recurrence: string): Date {
  const next = new Date(d);
  if (recurrence === 'biweekly') {
    next.setDate(next.getDate() + 14);
  } else {
    // monthly
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

/**
 * How many months back the executor is allowed to catch up. Anything
 * older than this is left alone — the user's actual records for those
 * months are whatever they manually entered. Going forward, missed
 * instances within this window will be auto-inserted on the next app
 * open so a missed due date doesn't silently disappear.
 */
const MAX_BACKFILL_MONTHS = 2;

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/**
 * Build the full list of due dates for a recurring transaction from its
 * base date up to (and including) `today`. Returns an empty array if
 * the base date is in the future.
 *
 * Both Monthly and Biweekly are supported. The previous version of this
 * function only returned a date if it matched today exactly, which meant
 * any due date the user happened to miss (e.g. didn't open the app that
 * day) was lost forever. This version catches up on every missed
 * instance between the base date and today, subject to a backfill window
 * (see MAX_BACKFILL_MONTHS) so we don't re-create years of history.
 */
function dueDatesUpTo(txDate: string, recurrence: string, today: Date): string[] {
  const rec = recurrence.toLowerCase();
  if (rec === 'one-time' || !rec) return [];

  const baseStr = txDate.slice(0, 10);
  const parts = baseStr.split('-');
  if (parts.length < 3) return [];
  const base = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  if (isNaN(base.getTime())) return [];
  if (base > today) return [];

  // Compute the earliest date we're allowed to backfill. Anything earlier
  // than this is left for the user's existing history.
  const floor = new Date(today);
  floor.setMonth(floor.getMonth() - MAX_BACKFILL_MONTHS);
  floor.setDate(1); // align to month start so we don't get weird mid-month floors
  const effectiveStart = base > floor ? base : floor;

  // Walk forward from the base, collecting every occurrence on or before today.
  // Cap at 200 to prevent runaway loops if the recurrence is misconfigured.
  const out: string[] = [];
  let current = new Date(base);
  for (let i = 0; i < 200; i++) {
    current = stepForward(current, rec);
    if (current > today) break;
    if (current < effectiveStart) continue;
    out.push(toLocalIsoDay(current));
  }
  return out;
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
    if (!rec || rec.toLowerCase() === 'one-time') continue;

    const dueDates = dueDatesUpTo(tx.date, rec, now);
    if (dueDates.length === 0) continue;

    for (const dueDate of dueDates) {
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
  }

  if (toInsert.length === 0) {
    localStorage.setItem(LAST_RUN_KEY, today);
    return [];
  }

  let data: any[] | null = null;
  try {
    const headers = await getAuthHeaders();
    (headers as any)['Prefer'] = 'return=representation';
    const res = await fetch(`${REST_BASE}/transactions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(toInsert),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error('[recurringExecutor] insert failed:', res.status, body.slice(0, 200));
      return [];
    }
    data = JSON.parse(body);
  } catch (err: any) {
    console.error('[recurringExecutor] insert error:', err?.message || err);
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
