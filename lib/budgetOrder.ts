// lib/budgetOrder.ts
//
// The order the budget vials are shown in.
//
// This exists because the database has no opinion about it. `budgets` has no
// primary key and no sort column, and the app reads it with a plain
// `select=*` — so PostgREST hands back whatever order the rows happen to sit
// in on disk. Postgres does not keep that stable: an UPDATE writes a new
// version of the row, usually at the end of the heap, so the moment the user
// changes a budget's limit or hides a category, that budget jumps to the end
// of the list on the next load. To the user that reads as the vials
// rearranging themselves for no reason.
//
// Adding `order=` to the query would not fix it either, because there is no
// column worth ordering on — the table stores a category name and an amount.
// So the order is decided here, in code, and every consumer (the vials, the
// chart, the settings list) inherits it from the single sorted list that
// `loadUserBudgets` puts into app state.

import { SYSTEM_CATEGORIES } from '../constants';

/** The canonical order, taken from the app's own category list. */
const CANONICAL_ORDER: readonly string[] = SYSTEM_CATEGORIES.map((c) =>
  c.name.trim().toLowerCase(),
);

/**
 * Where a category sits in the running order.
 *
 * "Other" is pinned last whatever the canonical list says, because it is the
 * catch-all and has always been shown at the bottom. Anything unrecognised
 * sorts after the known categories but before Other, alphabetically.
 */
export function budgetRank(name: string | null | undefined): number {
  const key = String(name || '').trim().toLowerCase();
  if (key === 'other') return Number.MAX_SAFE_INTEGER;
  const index = CANONICAL_ORDER.indexOf(key);
  return index >= 0 ? index : CANONICAL_ORDER.length;
}

/** Comparator form, for `Array.prototype.sort`. */
export function compareBudgets(
  a: { name: string },
  b: { name: string },
): number {
  const byRank = budgetRank(a?.name) - budgetRank(b?.name);
  if (byRank !== 0) return byRank;
  // Same rank means both are unrecognised (or both are "Other"). Falling back
  // to the name keeps the result independent of the order they arrived in,
  // which is the whole point of this file.
  return String(a?.name || '').localeCompare(String(b?.name || ''));
}

/** A new array in the canonical order. Never mutates the input. */
export function sortBudgets<T extends { name: string }>(budgets: readonly T[]): T[] {
  return [...budgets].sort(compareBudgets);
}
