// lib/hooks/useFirstPaintCache.ts
import { useEffect } from 'react';
import { writeFirstPaintCache } from '../firstPaintCache';
import type { AppState } from '../../types';

/**
 * Wait for the state to settle before writing. Serialising the transaction
 * list is a synchronous main-thread cost, and a load or a capture changes
 * several pieces of state in quick succession — without this the snapshot
 * would be written four or five times for one arrival, each time throwing the
 * previous one away.
 */
const WRITE_DELAY_MS = 800;

/**
 * Keep the first-paint snapshot up to date with whatever the app is showing.
 *
 * Written from live state rather than from the loader, so it also captures the
 * things that arrive after the load: a purchase captured while the app is
 * open, a row the user just filed, a budget limit they just changed. The next
 * launch then draws what they last saw, not what the last full reload saw.
 */
export function useFirstPaintCache(state: AppState): void {
  const userId = state.user?.id;
  const monthlyIncome = state.user?.monthlyIncome ?? 0;
  const { transactions, budgets } = state;
  const hiddenCategories = state.settings.hiddenCategories;

  useEffect(() => {
    // Nothing worth keeping until both halves are real. An empty list here is
    // the pre-load state, and caching it would blank the next launch's first
    // paint — the one thing this exists to prevent.
    if (!userId || transactions.length === 0 || budgets.length === 0) return;

    const timer = setTimeout(() => {
      writeFirstPaintCache({
        userId,
        savedAt: Date.now(),
        transactions,
        budgets,
        hiddenCategories: hiddenCategories ?? [],
        monthlyIncome,
      });
    }, WRITE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [userId, transactions, budgets, hiddenCategories, monthlyIncome]);
}
