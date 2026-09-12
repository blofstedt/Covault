// lib/autoFiledReceipt.ts
//
// Which rows the "Filed automatically" receipt is showing right now.
//
// The card clears itself: once its rows have been on screen long enough to
// count as read, their `auto_filed` flag is unset so they do not come back
// next time. That write is the problem this file solves. The rows are marked
// read WHILE the user is still looking at them, so the moment anything reloads
// the transaction list — a new capture landing, a pull to refresh — those rows
// stop matching `selectRecentlyAutoFiled` and would disappear out of the card
// mid-sentence. A receipt that deletes itself under a reading eye is worse
// than one that never cleared at all: the first looks like the app losing
// something, the second only looks untidy.
//
// So the card keeps its own copy of everything it has shown during the visit,
// and that copy is what gets drawn. It is emptied by unmounting, which is what
// leaving the Review page does.

import type { Transaction } from '../types';

/**
 * Fold `incoming` into `shown` and return what the card should draw.
 *
 * `shown` is mutated: that retention IS the point, and handing back a fresh
 * map each render would lose it. The caller keeps it in a ref for the life of
 * the mount.
 *
 * A row already in `shown` is replaced by the incoming copy rather than kept,
 * so one moved to another budget redraws in its new colour instead of being
 * pinned to whichever version the card happened to see first. A row that has
 * left `incoming` entirely is kept, which is the whole reason this exists.
 *
 * Newest first, by date, matching the order `selectRecentlyAutoFiled` hands
 * them over in — the merge has to re-sort because a retained row and a fresh
 * one arrive from different places.
 */
export function mergeReceiptRows(
  shown: Map<string, Transaction>,
  incoming: readonly Transaction[],
  excludedIds: ReadonlySet<string> = new Set(),
): Transaction[] {
  for (const tx of incoming) {
    if (!tx || !tx.id) continue;
    shown.set(tx.id, tx);
  }

  return Array.from(shown.values())
    .filter((tx) => !excludedIds.has(tx.id))
    .sort((a, b) => String(b.date).slice(0, 10).localeCompare(String(a.date).slice(0, 10)));
}
