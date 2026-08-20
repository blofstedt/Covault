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
 * How far back the "Filed automatically" list looks.
 *
 * Long enough that a few days away from the app still shows what happened
 * while you were gone, short enough that the list stays something you read
 * rather than scroll. Older auto-filed rows are still in the history and in
 * their budget — they simply stop being news.
 */
export const AUTO_FILED_WINDOW_DAYS = 7;

/**
 * Captures the app filed on arrival, which the user has therefore never seen.
 *
 * With "file known vendors automatically" on, a capture that matches a learned
 * rule is stored already cleared and never enters the review list. That is the
 * point of the setting — but with no trace anywhere, the capture page said
 * "All caught up" while purchases were being recorded, and the same purchases
 * got entered a second time by hand a minute later.
 *
 * So they are listed separately: visible, already filed, nothing to action.
 * Refunds are excluded for the same reason selectAwaitingReview excludes them.
 *
 * @param todayIso today as YYYY-MM-DD, from the app's single clock
 *                 (useCurrentDay), so this list rolls over with everything else.
 */
export function selectRecentlyAutoFiled(
  transactions: Transaction[],
  todayIso: string,
  windowDays: number = AUTO_FILED_WINDOW_DAYS,
): Transaction[] {
  const cutoff = shiftIsoDay(todayIso, -windowDays);
  if (!cutoff) return [];
  return transactions
    .filter(
      (tx) =>
        tx.auto_filed === true &&
        tx.label === 'Automatic' &&
        !isRefund(tx) &&
        typeof tx.date === 'string' &&
        tx.date.slice(0, 10) >= cutoff,
    )
    .sort((a, b) => String(b.date).slice(0, 10).localeCompare(String(a.date).slice(0, 10)));
}

/**
 * `iso` moved by `days`, as YYYY-MM-DD. Built from the date parts rather than
 * Date.parse so it cannot drift a day either way with the phone's timezone —
 * the same reason the rest of the app compares dates as strings.
 */
function shiftIsoDay(iso: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!match) return null;
  const shifted = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
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
