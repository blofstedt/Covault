// lib/firstPaintCache.ts
//
// What the app draws before the network answers.
//
// Every screen in Covault is derived from `transactions` and `budgets`, and
// both started every launch as an empty array. Nothing was wrong with the load
// — it is four parallel round-trips to Supabase — but on a phone waking a
// radio that is still most of a second, and for that second the app is
// *telling the user something*: the review list says "All caught up", the
// balance shows a skeleton, the vials are empty. The one moment that is worst
// is arriving from a capture notification, because the notification just said
// a purchase is waiting and the page it opens says there isn't one.
//
// So the last thing the app showed is kept on disk and drawn immediately, then
// replaced wholesale when the real data lands. Standard stale-while-revalidate,
// with two rules that keep it from ever being wrong for long:
//
//   - It is only ever read into empty state. A reload triggered mid-session
//     (token refresh, resume) must never see cached rows overwrite live ones.
//   - It is one snapshot, written together. Hydrating transactions but not
//     income would paint a balance computed from a month of spending against
//     an income of zero — a real number, badly wrong, which is worse than the
//     skeleton it replaced.
//
// Not a sync layer and not a source of truth: nothing is ever read back from
// here after the first paint, and a miss costs nothing but the old behaviour.

import { log } from './log';
import { sortBudgets } from './budgetOrder';
import type { BudgetCategory, Transaction } from '../types';

const CACHE_KEY = 'covault_first_paint_v1';

/**
 * How many rows are kept. The dashboard reads the current month and the review
 * list reads unfiled captures, so this only has to be deep enough that neither
 * can be truncated — a household spending 1000 times in a month does not exist.
 * The cap is here to bound what goes into localStorage, which is a synchronous
 * write on the main thread and has a hard quota.
 */
const MAX_CACHED_TRANSACTIONS = 1000;

export interface FirstPaintSnapshot {
  /** Whose data this is. A different user gets a miss, not someone else's rows. */
  userId: string;
  savedAt: number;
  transactions: Transaction[];
  budgets: BudgetCategory[];
  hiddenCategories: string[];
  monthlyIncome: number;
}

/**
 * The snapshot for this user, or null if there isn't one.
 *
 * Any malformed or foreign payload reads as a miss rather than throwing — this
 * runs on the launch path, and a corrupt cache must degrade to the old
 * behaviour instead of taking the app down with it.
 */
export function readFirstPaintCache(userId: string): FirstPaintSnapshot | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.userId !== userId) return null;
    if (!Array.isArray(parsed.transactions) || !Array.isArray(parsed.budgets)) return null;

    return {
      userId,
      savedAt: Number(parsed.savedAt) || 0,
      transactions: parsed.transactions as Transaction[],
      // Re-sorted on the way out rather than trusted from disk, so a snapshot
      // written by an older build still obeys the one budget order. See
      // lib/budgetOrder.ts for why that order cannot come from the database.
      budgets: sortBudgets(parsed.budgets as BudgetCategory[]),
      hiddenCategories: Array.isArray(parsed.hiddenCategories)
        ? (parsed.hiddenCategories as string[])
        : [],
      monthlyIncome: Number(parsed.monthlyIncome) || 0,
    };
  } catch (err: any) {
    log.debug('[firstPaintCache] read failed:', err?.message || err);
    return null;
  }
}

/**
 * Write the snapshot. Best-effort by design: a full quota or a locked store
 * means the next launch waits for the network, which is exactly what every
 * launch used to do.
 */
export function writeFirstPaintCache(snapshot: FirstPaintSnapshot): void {
  if (!snapshot.userId || typeof window === 'undefined') return;
  try {
    // Newest first, then truncated. `date` is a plain ISO day, so a string
    // compare is the date compare.
    const transactions = [...snapshot.transactions]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, MAX_CACHED_TRANSACTIONS);

    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ ...snapshot, savedAt: Date.now(), transactions }),
    );
  } catch (err: any) {
    log.debug('[firstPaintCache] write failed:', err?.message || err);
  }
}

/**
 * Drop the snapshot. Called on sign-out: the next person to use this phone
 * should not see the last one's spending flash up before the login screen.
 */
export function clearFirstPaintCache(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to do — a cache we cannot clear is still keyed by user id, so it
    // cannot be read by anyone else.
  }
}
