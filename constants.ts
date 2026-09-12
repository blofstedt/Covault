import { BudgetCategory } from './types';

/**
 * Every category the app offers, in the order the vials are shown.
 *
 * The original seven keep their exact relative order: Shopping, Personal and
 * Travel are inserted after Services rather than among them, so a vault that
 * already exists sees its dashboard in precisely the order it had before. See
 * `lib/budgetOrder.ts`, which takes the running order from this list and pins
 * "Other" last regardless.
 *
 * Adding to this list is a MIGRATION FIRST, app code second: these names are
 * values of a Postgres enum (`public."Budgets"`), shared by
 * `transactions.budget`, `overrides.category_id` and `budgets.budget`. A name
 * the enum does not know cannot be stored, and a SELECT that filters on one
 * fails the whole query rather than matching nothing. See
 * `supabase/migrations/2026_09_add_shopping_personal_travel_budgets.sql`.
 */
export const SYSTEM_CATEGORIES: BudgetCategory[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Housing', totalLimit: 500 },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Groceries', totalLimit: 500 },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Transport', totalLimit: 500 },
  { id: '44444444-4444-4444-4444-444444444444', name: 'Utilities', totalLimit: 500 },
  { id: '55555555-5555-5555-5555-555555555555', name: 'Leisure', totalLimit: 500 },
  { id: '77777777-7777-7777-7777-777777777777', name: 'Services', totalLimit: 500 },
  { id: '88888888-8888-8888-8888-888888888888', name: 'Shopping', totalLimit: 500 },
  { id: '99999999-9999-9999-9999-999999999999', name: 'Personal', totalLimit: 500 },
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Travel', totalLimit: 500 },
  { id: '66666666-6666-6666-6666-666666666666', name: 'Other', totalLimit: 500 },
];

/**
 * Categories added after the original seven shipped.
 *
 * These are seeded switched OFF into a vault that already has budget rows,
 * and switched ON into a brand-new one. Both halves matter:
 *
 *   - A household that has been using the app for months did not ask for
 *     three more vials. Appearing on their dashboard uninvited would be the
 *     app rearranging the one screen they read every day, as a side effect of
 *     an update they did not choose. Worse, the ten vials would not fit the
 *     two-line row they are used to (see `useCompactCollapsedStyles` and the
 *     density note in `DashboardBudgetSectionsList`), so the change would
 *     arrive looking broken.
 *
 *   - A new user, by contrast, has nothing to disturb. They meet all ten in
 *     the intro's budget step and switch off whatever they do not want, which
 *     is the same eye toggle the settings screen uses.
 *
 * "Off" here is the ordinary hidden-category mechanism, not a second concept:
 * the seeded row carries `Visible: false`, `loadUserBudgets` turns that into
 * `settings.hiddenCategories`, and one tap of the eye in either screen turns
 * it on for good. Nothing about an existing transaction or learned rule
 * moves, and no category is ever un-hidden on the user's behalf.
 */
export const OPT_IN_CATEGORIES: ReadonlySet<string> = new Set([
  'Shopping',
  'Personal',
  'Travel',
]);

/** Whether a category is one of the later additions, matched case-insensitively. */
export function isOptInCategory(name: string | null | undefined): boolean {
  const key = String(name || '').trim().toLowerCase();
  for (const candidate of OPT_IN_CATEGORIES) {
    if (candidate.toLowerCase() === key) return true;
  }
  return false;
}
