// lib/budgetVisibility.ts
//
// Which categories may be chosen for a transaction.
//
// The eye in Budget Limits is the user saying "I don't use this one": it writes
// `Visible = false` on the row, and `loadUserBudgets` reads those rows back into
// `settings.hiddenCategories`. Everything that DISPLAYS a budget honours that
// list already — the vials on the dashboard, the chart, the settings list.
//
// Everything that let the user FILE a transaction did not. The edit form drew
// its vault grid straight from `state.budgets`, so every category the user had
// turned off came back as a choice: the report was "all budget categories show
// up, regardless of what the user has enabled in settings". The category sheet
// behind the caught-transaction rows did the same.
//
// So the list the user set is applied in one place, and both pickers read it
// from here rather than each deciding for itself.

import type { BudgetCategory } from '../types';

/**
 * The categories a transaction may be filed under.
 *
 * `keepIds` are shown whether or not they are hidden, and there is usually at
 * most one: the category the transaction is ALREADY filed under. A category can
 * be hidden long after rows were filed to it, and an edit form that opens with
 * nothing selected — because the one category it is filed under was filtered
 * out — hides from the user what the row says. The vault stays honest about
 * where the money is; it just stops offering new filings into a category the
 * user has turned off.
 */
export function selectableBudgets(
  budgets: readonly BudgetCategory[],
  hiddenCategories: readonly string[] = [],
  keepIds: readonly (string | null | undefined)[] = [],
): BudgetCategory[] {
  const hidden = new Set(hiddenCategories);
  if (hidden.size === 0) return [...budgets];

  const keep = new Set(keepIds.filter((id): id is string => !!id));
  return budgets.filter((b) => !hidden.has(b.id) || keep.has(b.id));
}
