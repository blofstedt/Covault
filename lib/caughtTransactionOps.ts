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

/**
 * Fields written when the user clears a row off the "Filed automatically" list.
 *
 * Also not a delete. `auto_filed` is the only thing that puts a row on that
 * card (lib/reviewQueue.ts — `selectRecentlyAutoFiled`), and the card is a
 * receipt rather than a queue: it exists so a purchase the app filed on its own
 * is still a purchase the user has seen. Once they have seen it and said so,
 * the flag has done its job, and unsetting it is the honest way to say "no
 * longer news" — the transaction itself, its amount, its category and its place
 * in the budget are all untouched.
 *
 * Chosen over a device-local dismissal list on purpose: two people share a
 * vault, and a receipt one of them has already acknowledged should not come
 * back on the other's phone.
 */
export function buildAutoFiledClearPayload(): Record<string, unknown> {
  return { auto_filed: false };
}
