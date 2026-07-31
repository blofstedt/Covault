// lib/reviewQueue.ts
//
// One definition of "waiting in Review", used by everything that counts or
// renders it.
//
// This exists because the app disagreed with itself. TransactionParsing passed
// `aiTransactions.length` to the bottom bar's badge, while
// AITransactionsEnteredCard rendered `nonRefunds` — the same list minus
// refunds. So a captured refund made the badge say 3 while the list showed 2,
// and there was no way to tell which was right by looking.
//
// It matters more now that the home-screen widget shows the same count: a badge
// you can't trust is worse than no badge, because its whole job is to be the
// backstop when a capture notification gets dismissed by mistake.
//
// The list is the truth. Everything reads from here.

import { isRefund } from './refundMatching';
import type { Transaction } from '../types';

/**
 * Captures the user still has to look at: auto-captured, not yet filed, and
 * not a refund.
 *
 * Refunds are excluded because they are money coming back — the review flow
 * exists to categorise spending, and a refund is matched against its original
 * expense by refundMatching rather than triaged by hand.
 */
export function selectAwaitingReview(transactions: Transaction[]): Transaction[] {
  return transactions.filter(
    (tx) => tx.label === 'Automatic' && !tx.caught_cleared && !isRefund(tx),
  );
}

/** Convenience for the badge/pill callers that only need the number. */
export function countAwaitingReview(transactions: Transaction[]): number {
  return selectAwaitingReview(transactions).length;
}

/**
 * Captured refunds that selectAwaitingReview filtered out.
 *
 * The review card's subtitle says "2 refunds hidden" so their absence is
 * explained rather than looking like a dropped capture. Now that the filtering
 * happens upstream, the count has to be derived separately or that line would
 * silently always read zero.
 */
export function countHiddenRefunds(transactions: Transaction[]): number {
  return transactions.filter(
    (tx) => tx.label === 'Automatic' && !tx.caught_cleared && isRefund(tx),
  ).length;
}
