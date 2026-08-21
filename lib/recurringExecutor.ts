// lib/recurringExecutor.ts
// Checks for recurring transactions that are due and inserts them.
// Piggybacks on app open / notification listener events.
// Uses localStorage to avoid re-processing the same day.

import { log } from './log';
import { getLocalToday, toLocalIsoDay } from './dateUtils';
import { restFetch } from './apiHelpers';
import { stepForward } from './recurrence';
import { findSameCharge } from './duplicateCharge';
import { SYSTEM_CATEGORIES } from '../constants';
import type { Transaction } from '../types';

/**
 * The only names `transactions.budget` accepts. It is a Postgres enum, so a
 * value outside this set is not a bad row — it is a rejected statement, and
 * the whole batch goes with it.
 */
const BUDGET_NAMES = new Map(
  SYSTEM_CATEGORIES.map((category) => [category.name.toLowerCase(), category.name]),
);

/**
 * Resolve a transaction's `budget_id` to the enum name the `budget` column
 * expects, or null when it cannot be resolved.
 *
 * Null rather than a guess, deliberately. This used to end with "return
 * budgetId" for anything that wasn't the 'budget:groceries' form — and every
 * transaction the app loads carries the category's UUID, not that form. So
 * every run posted a UUID where the enum expected 'Groceries', Postgres
 * rejected the insert, and the executor has never once managed to write a
 * row: recurring charges were never filled in, and because the once-a-day
 * marker is only set after a successful write, it retried on every reload —
 * six failed writes per app launch, all of them silent.
 */
export function budgetIdToName(budgetId: string | null): string | null {
  if (!budgetId) return 'Other';

  const system = SYSTEM_CATEGORIES.find((category) => category.id === budgetId);
  if (system) return system.name;

  if (budgetId.startsWith('budget:')) {
    const name = budgetId.slice('budget:'.length).replace(/-/g, ' ');
    return BUDGET_NAMES.get(name.toLowerCase()) ?? null;
  }

  return BUDGET_NAMES.get(budgetId.toLowerCase()) ?? null;
}

const LAST_RUN_KEY = 'covault_recurring_last_run';

/**
 * How many failed write attempts one app session is allowed before the
 * executor stops trying until the next launch.
 *
 * The day-marker is only set after a successful write, and the caller re-runs
 * this on every change to the transaction list — so a write that always fails
 * is a write that is retried five or six times per launch, forever, in
 * silence. The same payload failing twice more is not going to succeed.
 */
const MAX_FAILURES_PER_SESSION = 3;
let failuresThisSession = 0;

/**
 * The run currently under way, if any.
 *
 * The caller re-runs this on every change to the transaction list, and a
 * capture arriving changes it several times in a couple of seconds — the
 * server log shows two runs starting 50ms apart. The once-a-day marker is
 * written at the END of a run, so it cannot separate two that overlap: both
 * would read the same "not recorded yet", and both would post the same
 * charges. A second caller waits for the run already in progress and reports
 * nothing of its own, because the run it waited for has already reported
 * those rows to the caller that started it.
 */
let inFlight: Promise<Transaction[]> | null = null;

/** Exposed for testing: forget this session's failure count. */
export function _resetFailureCountForTesting(): void {
  failuresThisSession = 0;
  inFlight = null;
}

/** `2026-08-*` shifted by whole months, for the DB duplicate lookup. */
function neighbouringMonth(date: string, offset: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function todayStr(): string {
  return getLocalToday();
}



/**
 * How many months back the executor is allowed to catch up. Anything
 * older than this is left alone — the user's actual records for those
 * months are whatever they manually entered. Going forward, missed
 * instances within this window will be auto-inserted on the next app
 * open so a missed due date doesn't silently disappear.
 */
const MAX_BACKFILL_MONTHS = 2;

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
  if (inFlight) {
    await inFlight.catch(() => {});
    return [];
  }
  inFlight = runRecurringTransactions(userId, transactions, options);
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function runRecurringTransactions(
  userId: string,
  transactions: Transaction[],
  options: { force?: boolean },
): Promise<Transaction[]> {
  const today = todayStr();

  // Only run once per day unless the caller explicitly forces a re-run.
  if (!options.force) {
    const lastRun = localStorage.getItem(LAST_RUN_KEY);
    if (lastRun === today) return [];
  }

  if (failuresThisSession >= MAX_FAILURES_PER_SESSION) return [];

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Charges already on the books, to be checked against rather than keyed on.
  //
  // This was an exact-match key of vendor + amount + date + budget, which meant
  // the executor only recognised its own handiwork. A charge captured from a
  // bank notification carries the bank's name for the merchant — "Google One"
  // where the recurring rule says "Google" — and against an exact key that is
  // a different charge, so the executor posted its own copy alongside it.
  const existing: Array<{ vendor: string; amount: number; date: string }> =
    transactions.map((t) => ({
      vendor: t.vendor,
      amount: t.amount,
      date: (t.date || '').slice(0, 10),
    }));

  const toInsert: Array<{
    user_id: string;
    vendor: string;
    amount: number;
    date: string;
    budget: string;
    recur: string;
    type: string;
    is_projected: boolean;
    source: 'executor';
  }> = [];

  for (const tx of transactions) {
    const rec = ((tx as any).recur ?? tx.recurrence ?? '').toString();
    if (!rec || rec.toLowerCase() === 'one-time') continue;

    const dueDates = dueDatesUpTo(tx.date, rec, now);
    if (dueDates.length === 0) continue;

    // Resolved once per template: a category the enum doesn't have cannot be
    // written at all, and including such a row would take the whole batch —
    // every other subscription with it — down with it.
    const budgetName = budgetIdToName(tx.budget_id);
    if (!budgetName) {
      log.warn(
        `[recurringExecutor] Skipping ${tx.vendor}: no category name for budget_id ${tx.budget_id}`,
      );
      continue;
    }

    for (const dueDate of dueDates) {
      // Don't re-insert if this charge already looks recorded — by any name.
      const candidate = { vendor: tx.vendor, amount: tx.amount, date: dueDate };
      if (findSameCharge(candidate, existing)) continue;

      toInsert.push({
        user_id: userId,
        vendor: tx.vendor,
        amount: tx.amount,
        date: dueDate,
        budget: budgetName,
        recur: rec,
        type: 'Automatic',
        is_projected: false,
        // Mark executor-spawned rows so the dedup logic can distinguish
        // them from notification-spawned rows of the same vendor+amount.
        source: 'executor',
      });

      // Track to prevent dupes within this batch. Added to the same list the
      // check reads, so two due dates a day apart for the same subscription
      // can't both be spawned.
      existing.push(candidate);
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
  // Months either side as well as the month itself: a due date on the 1st or
  // the 31st has to be able to see a charge that landed a couple of days over
  // the boundary, and a month-scoped lookup could not.
  const monthKeys = new Set<string>();
  for (const row of toInsert) {
    monthKeys.add(row.date.slice(0, 7));
    monthKeys.add(neighbouringMonth(row.date, -1));
    monthKeys.add(neighbouringMonth(row.date, 1));
  }
  const dbExisting: Array<{ vendor: string; amount: number; date: string }> = [];
  // Each month's lookup is independent — results only accumulate into the
  // shared set — so they run concurrently instead of one round-trip apiece.
  // The per-month try/catch is kept so one failure still falls through to
  // "insert anyway" without taking the others down.
  await Promise.all(
    [...monthKeys].map(async (monthKey) => {
      try {
        // A range, not a pattern. `date=like.2026-08-*` asks Postgres to LIKE
        // a date against text, which has no operator — PostgREST answered 404
        // every time, the check fell through to "insert anyway", and the guard
        // this whole block exists to provide has never actually run.
        const res = await restFetch(
          `/transactions?select=vendor,amount,date&user_id=eq.${userId}` +
          `&date=gte.${monthKey}-01&date=lt.${neighbouringMonth(`${monthKey}-01`, 1)}-01`,
        );
        if (!res.ok) return;
        const rows: Array<{ vendor?: string; amount?: number; date?: string }> = await res.json();
        for (const row of rows) {
          if (!row.vendor || row.amount == null || !row.date) continue;
          dbExisting.push({
            vendor: String(row.vendor),
            amount: Number(row.amount),
            date: String(row.date).slice(0, 10),
          });
        }
      } catch (err: any) {
        log.warn('[recurringExecutor] DB dedup check failed:', err?.message || err);
        // If the check fails, fall through and insert anyway — a duplicate
        // is better than missing a charge. The user can clean up manually.
      }
    }),
  );

  const filtered = toInsert.filter((row) => {
    const match = findSameCharge(row, dbExisting);
    if (match) {
      log.debug(
        `[recurringExecutor] Skipping ${row.vendor} $${row.amount} on ${row.date}` +
        ` — already in DB as ${match.vendor} on ${match.date}`,
      );
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    log.debug('[recurringExecutor] All candidates were DB duplicates; nothing to insert');
    localStorage.setItem(LAST_RUN_KEY, today);
    return [];
  }

  toInsert.length = 0;
  toInsert.push(...filtered);

  let data: any[] | null = null;
  try {
    const res = await restFetch(`/transactions`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(toInsert),
    });
    const body = await res.text();
    if (!res.ok) {
      failuresThisSession += 1;
      log.error('[recurringExecutor] insert failed:', res.status, body.slice(0, 200));
      return [];
    }
    data = JSON.parse(body);
  } catch (err: any) {
    failuresThisSession += 1;
    log.error('[recurringExecutor] insert error:', err?.message || err);
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
