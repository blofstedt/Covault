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
export const WIDGET_SNAPSHOT_VERSION = 1;

export interface WidgetSlice {
  name: string;
  amount: number;
  /** Hex, straight from budgetColors so the widget never guesses. */
  color: string;
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
    updatedAtMs: nowMs,
  };
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
  for (const d of applicable) {
    const amount = Number(d.amount) || 0;
    if (amount === 0) continue;
    const name = d.category || 'Other';
    amounts.set(name, (amounts.get(name) || 0) + amount);
    totalSpent += amount;
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
  };
}
