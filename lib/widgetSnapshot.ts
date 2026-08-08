// lib/widgetSnapshot.ts
//
// What the home-screen widget draws.
//
// The widget runs as an AppWidgetProvider in the native process. It has no
// WebView, no React, and — crucially — no Supabase session, because auth lives
// in the WebView's storage. So it cannot fetch anything. Instead the app hands
// it a small, fully pre-computed snapshot whenever it loads data, and the
// widget's only job is to draw it.
//
// Everything here is derived from values the app already computes, using the
// same helpers, so the widget's idea of "this month" and "remaining" cannot
// disagree with the Dashboard's.

import { getBudgetColor } from './budgetColors';
import { getLocalMonthKey, getLocalToday } from './dateUtils';
import type { BudgetCategory, Transaction } from '../types';

/** Bumped if the shape changes, so an old native reader can bail rather than misread. */
export const WIDGET_SNAPSHOT_VERSION = 2;

/**
 * How many purchases the widget lists when a category is opened on it.
 *
 * Four is what the right-hand column can show at the widget's design height
 * without shrinking the type back to the size that made it unreadable.
 */
export const WIDGET_RECENT_PER_CATEGORY = 4;

export interface WidgetSlice {
  name: string;
  amount: number;
  /** Hex, straight from budgetColors so the widget never guesses. */
  color: string;
}

/** One line in the list shown when a category is opened on the widget. */
export interface WidgetRecent {
  vendor: string;
  amount: number;
  /** "08-07" — day and month, which is all the column has room for. */
  day: string;
}

export interface WidgetSnapshot {
  version: number;
  /** "2026-07" — the month these figures describe. */
  monthKey: string;
  /** "July" — rendered in the widget header. */
  monthLabel: string;
  totalSpent: number;
  /** May be negative; the widget must render that, not clamp it. */
  remaining: number;
  income: number;
  /** The app's own theme setting. Null means follow the system. */
  theme: 'light' | 'dark' | null;
  /** Spend descending. Zero and negative slices are dropped. */
  slices: WidgetSlice[];
  /**
   * Captures still waiting in Review. Shown as a pill on the widget so a
   * mis-dismissed capture notification isn't the only way to know something
   * needs attention. Uses selectAwaitingReview so it always equals what the
   * app's own list shows.
   */
  pendingReview: number;
  /**
   * The most recent purchases in each category, keyed by category name.
   *
   * Only read when the user opens a category on the widget, which is why it is
   * a few lines per category rather than the month: the whole snapshot crosses
   * a Binder transaction with a hard size ceiling, and the widget is drawn from
   * it on every redraw.
   */
  recent: Record<string, WidgetRecent[]>;
  updatedAtMs: number;
}

/**
 * A purchase the native notification listener captured while the app was shut.
 *
 * These are optimistic: the listener resolves the category from a mirrored copy
 * of the user's vendor rules, which is a rougher match than the full JS
 * pipeline, and the pipeline may later reject or dedup the notification
 * entirely. That's accepted — see mergeWidgetDeltas.
 */
export interface WidgetDelta {
  amount: number;
  category: string;
  atMs: number;
  /**
   * Whether this capture will land in Review. False when auto-file will take
   * it, so the widget doesn't show a phantom "1 to review" after every matched
   * purchase — a badge that cries wolf is worse than no badge. The native side
   * decides; anything it isn't sure about counts as pending.
   */
  pending?: boolean;
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-07" -> "July". Falls back to the raw key rather than throwing. */
export function monthLabelFromKey(monthKey: string): string {
  const month = Number.parseInt(monthKey.slice(5, 7), 10);
  return MONTH_LABELS[month - 1] ?? monthKey;
}

export interface BuildWidgetSnapshotArgs {
  budgets: BudgetCategory[];
  /** Current-month transactions, as the Dashboard already computes them. */
  currentMonthTransactions: Transaction[];
  /** From useDashboardTotals — already includes projected spending. */
  remaining: number;
  income: number;
  theme: 'light' | 'dark' | null;
  /** Captures awaiting review — countAwaitingReview over ALL transactions. */
  pendingReview: number;
  /** Injectable for tests; defaults to today. */
  monthKey?: string;
  nowMs?: number;
}

/**
 * Build the snapshot. Pure — no I/O, no clock reads beyond the injectable
 * defaults — so the interesting cases are all testable.
 */
export function buildWidgetSnapshot({
  budgets,
  currentMonthTransactions,
  remaining,
  income,
  theme,
  pendingReview,
  monthKey = getLocalMonthKey(getLocalToday()),
  nowMs = Date.now(),
}: BuildWidgetSnapshotArgs): WidgetSnapshot {
  const nameById = new Map<string, string>();
  for (const b of budgets) nameById.set(b.id, b.name);

  // Sum by category name, matching how BudgetFlowChart buckets: an unknown or
  // missing budget_id lands in "Other" rather than being dropped, so the total
  // always equals the sum of the slices.
  const byCategory = new Map<string, number>();
  let totalSpent = 0;
  for (const tx of currentMonthTransactions) {
    const amount = Number(tx.amount) || 0;
    if (amount === 0) continue;
    const name = (tx.budget_id && nameById.get(tx.budget_id)) || 'Other';
    byCategory.set(name, (byCategory.get(name) || 0) + amount);
    totalSpent += amount;
  }

  // Colour by the category's position in the user's budget list, so the widget
  // and the app pick the same fallback colour for a non-system category.
  const orderByName = new Map<string, number>();
  budgets.forEach((b, i) => orderByName.set(b.name, i));

  const slices: WidgetSlice[] = Array.from(byCategory.entries())
    // A refund can push a category negative. A negative arc is meaningless on a
    // donut, so it's excluded from the ring — but it stays in totalSpent, which
    // is a real figure.
    .filter(([, amount]) => amount > 0)
    .map(([name, amount]) => ({
      name,
      amount,
      color: getBudgetColor(name, orderByName.get(name) ?? 0),
    }))
    // Largest first: the renderer places icons in this order and drops the ones
    // whose arcs are too small, so the least significant slices lose theirs.
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  return {
    version: WIDGET_SNAPSHOT_VERSION,
    monthKey,
    monthLabel: monthLabelFromKey(monthKey),
    totalSpent,
    remaining,
    income,
    theme,
    slices,
    pendingReview,
    recent: buildRecent(currentMonthTransactions, nameById),
    updatedAtMs: nowMs,
  };
}

/**
 * The last few purchases in each category, newest first.
 *
 * Bucketed by the same rule the slices use — an unknown budget lands in
 * "Other" — so a category the donut can show always has a list behind it.
 * Refunds and anything at zero are left out: the list is what you spent, and a
 * credit sitting in it reads as a purchase.
 */
function buildRecent(
  transactions: Transaction[],
  nameById: Map<string, string>,
): Record<string, WidgetRecent[]> {
  const byCategory = new Map<string, { at: number; entry: WidgetRecent }[]>();

  for (const tx of transactions) {
    const amount = Number(tx.amount) || 0;
    if (amount <= 0) continue;
    const name = (tx.budget_id && nameById.get(tx.budget_id)) || 'Other';
    const day = typeof tx.date === 'string' ? tx.date.slice(0, 10) : '';
    const at = day ? Date.parse(day) : 0;
    const bucket = byCategory.get(name) ?? [];
    bucket.push({
      at: Number.isFinite(at) ? at : 0,
      entry: {
        vendor: (tx.vendor || 'Unknown').trim() || 'Unknown',
        amount,
        day: day.length === 10 ? day.slice(5) : '',
      },
    });
    byCategory.set(name, bucket);
  }

  const out: Record<string, WidgetRecent[]> = {};
  for (const [name, rows] of byCategory) {
    out[name] = rows
      .sort((a, b) => b.at - a.at)
      .slice(0, WIDGET_RECENT_PER_CATEGORY)
      .map((r) => r.entry);
  }
  return out;
}

/**
 * Fold optimistic native deltas into the snapshot for rendering.
 *
 * Two rules, and both matter:
 *
 *   - Only deltas newer than the snapshot count. The snapshot is authoritative,
 *     so anything it already accounts for must not be added again. This is what
 *     makes drift self-healing: the moment the app writes a fresh snapshot,
 *     every optimistic guess before it is discarded, including ones the JS
 *     pipeline went on to reject or dedup.
 *   - Only deltas from the rendered month count. A purchase captured at 00:05
 *     on the 1st must not be added to December's donut.
 *
 * The Java side mirrors this; the tests here are the specification.
 */
export function mergeWidgetDeltas(
  snapshot: WidgetSnapshot,
  deltas: WidgetDelta[],
  monthKeyOf: (atMs: number) => string,
): WidgetSnapshot {
  const applicable = deltas.filter(
    (d) => d.atMs > snapshot.updatedAtMs && monthKeyOf(d.atMs) === snapshot.monthKey,
  );
  if (applicable.length === 0) return snapshot;

  const amounts = new Map<string, number>();
  const colors = new Map<string, string>();
  for (const s of snapshot.slices) {
    amounts.set(s.name, s.amount);
    colors.set(s.name, s.color);
  }

  let totalSpent = snapshot.totalSpent;
  let pendingReview = snapshot.pendingReview;
  for (const d of applicable) {
    const amount = Number(d.amount) || 0;
    if (amount === 0) continue;
    const name = d.category || 'Other';
    amounts.set(name, (amounts.get(name) || 0) + amount);
    totalSpent += amount;
    // Default true: a delta with no verdict is one the native side couldn't
    // classify, and the badge errs high rather than low.
    if (d.pending !== false) pendingReview += 1;
  }

  const slices: WidgetSlice[] = Array.from(amounts.entries())
    .filter(([, amount]) => amount > 0)
    .map(([name, amount], i) => ({
      name,
      amount,
      color: colors.get(name) || getBudgetColor(name, i),
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));

  return {
    ...snapshot,
    totalSpent,
    // Every dollar spent is a dollar not remaining.
    remaining: snapshot.remaining - (totalSpent - snapshot.totalSpent),
    slices,
    pendingReview,
  };
}
