// lib/caughtTransactionOps.ts
//
// The two halves of filing a caught transaction, kept next to each other so
// they can't drift apart.
//
// "Filing" a row means clearing it from the review list — it does NOT delete
// anything. The transaction stays in the user's history and keeps counting
// toward their budgets; `caught_cleared` only controls whether it still shows
// up on the Review page.
//
// Undo therefore has to be the exact inverse of file, including any category
// change that rode along with it. Accept can be reached from a path that also
// moved the row (Change category → file), so an Undo that flips
// `caught_cleared` back but leaves the new budget in place would silently
// recategorise the transaction. That's why undo takes the previous budget name
// and restores it explicitly.

/** Fields written when a caught row is filed out of the review list. */
export function buildFilePayload(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { caught_cleared: true, ...extra };
}

/**
 * Fields that undo a file. `previousBudget` is the category name the row had
 * *before* filing.
 *
 * Passing null omits `budget` entirely rather than writing null: a row that
 * never had a category should come back without one, and writing an explicit
 * null would clobber anything set in between.
 */
export function buildUndoPayload(
  previousBudget: string | null,
): Record<string, unknown> {
  return previousBudget
    ? { caught_cleared: false, budget: previousBudget }
    : { caught_cleared: false };
}
