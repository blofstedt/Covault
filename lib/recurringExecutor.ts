// lib/recurringExecutor.ts
// Checks for recurring transactions that are due and inserts them.
// Piggybacks on app open / notification listener events.
// Uses localStorage to avoid re-processing the same day.

import { getLocalToday, toLocalIsoDay } from './dateUtils';
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
 * Idempotent — safe to call multiple times; it will only insert rows
 * for due dates that don't already exist in the provided transaction list.
 *
 * Pass `force: true` to bypass the once-per-day localStorage guard. Use
 * this when a new recurring template was just added mid-session and you
 * want its first due instance spawned immediately rather than waiting
 * for tomorrow's app-open run.
 */
export async function executeRecurringTransactions(
  userId: string,
  transactions: Transaction[],
  options: { force?: boolean } = {},
): Promise<Transaction[]> {
  const today = todayStr();

  // Only run once per day unless the caller explicitly forces a re-run.
  if (!options.force) {
    const lastRun = localStorage.getItem(LAST_RUN_KEY);
    if (lastRun === today) return [];
  }

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
        // Mark executor-spawned rows so the dedup logic can distinguish
        // them from notification-spawned rows of the same vendor+amount.
        source: 'executor',
      });

      // Track to prevent dupes within this batch
      existingKeys.add(key);
    }
  }

  if (toInsert.length === 0) {
    localStorage.setItem(LAST_RUN_KEY, today);
    return [];
  }

  // ── Guard against DB-only duplicates ──
  // The `existingKeys` set above is built from the in-memory `transactions`
  // list passed in by the caller. If a new transaction was just inserted
  // directly to the DB (e.g. a manual entry the user typed in before the
  // app finished loading) the executor's in-memory view is stale and we'd
  // happily spawn a duplicate. To close that race, query the DB for any
  // existing transactions in the months we're about to insert into and
  // drop matching rows from `toInsert`.
  //
  // This is what fixed the Netflix Jul 16/Jul 17 race: the executor ran
  // and saw the April Netflix template, computed a Jul 17 due date, and
  // spawned it — but the user had already manually added a Jul 16 entry
  // that wasn't in memory yet. After this guard, the executor queries the
  // DB, sees the Jul 16 row, and skips the Jul 17 insert.
  const monthKeys = new Set(toInsert.map(t => t.date.slice(0, 7)));
  const dbExistingKeys = new Set<string>();
  for (const monthKey of monthKeys) {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `${REST_BASE}/transactions?select=vendor,amount,date&user_id=eq.${userId}&date=like.${monthKey}-*`,
        { headers },
      );
      if (!res.ok) continue;
      const rows: Array<{ vendor?: string; amount?: number; date?: string }> = await res.json();
      for (const row of rows) {
        if (!row.vendor || row.amount == null || !row.date) continue;
        // Key by vendor (lowercased) + amount + day-of-month. We only
        // need to dedup within the same month, so a same-day duplicate
        // is the signal we care about.
        const day = row.date.slice(8, 10);
        dbExistingKeys.add(
          `${String(row.vendor).toLowerCase().trim()}|${Number(row.amount).toFixed(2)}|${day}`,
        );
      }
    } catch (err: any) {
      console.warn('[recurringExecutor] DB dedup check failed:', err?.message || err);
      // If the check fails, fall through and insert anyway — a duplicate
      // is better than missing a charge. The user can clean up manually.
    }
  }

  const filtered = toInsert.filter((row) => {
    const day = row.date.slice(8, 10);
    const key = `${row.vendor.toLowerCase().trim()}|${Number(row.amount).toFixed(2)}|${day}`;
    if (dbExistingKeys.has(key)) {
      console.log(`[recurringExecutor] Skipping ${row.vendor} $${row.amount} on ${row.date} — already in DB`);
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    console.log('[recurringExecutor] All candidates were DB duplicates; nothing to insert');
    localStorage.setItem(LAST_RUN_KEY, today);
    return [];
  }

  toInsert.length = 0;
  toInsert.push(...filtered);

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
