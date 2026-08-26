// lib/budgetFallback.ts
//
// What the dashboard shows when the budgets read does not answer.
//
// The `budgets` table holds two things the user set by hand: each category's
// limit, and whether it is shown at all. `loadUserBudgets` used to respond to
// any failed read by putting the starter set — every limit 500, every category
// visible — into app state. That conflates two very different things: "you
// have not set any budgets" and "I could not ask".
//
// The second one happened. Four requests go out together at the start of a
// load, and when the access token rotates in that instant one of them can be
// refused; on the report that produced this file it was the budgets read. The
// database was intact the whole time. The user simply opened the app and found
// their limits back at 500 and the categories they had hidden showing again,
// until they closed and reopened it.
//
// It is worse than a wrong screen. The limits shown are the ones the settings
// screen edits and writes back, so displaying the starter figures over the
// user's own left the app one tap away from saving them over the real ones.
//
// The rule, which lib/hooks/useDataLoading.ts already follows for transactions:
// an empty answer is an answer, a failed request is not.

/**
 * The budgets to hold after a read that failed.
 *
 * Whatever is already on screen — the previous load, or the first-paint cache —
 * stays. The starter set is used only when there is genuinely nothing to show,
 * which is a first-ever load and nothing else.
 *
 * Returns the same reference when there is nothing to change, so a caller can
 * use it inside a state updater without forcing a re-render.
 */
export function budgetsAfterFailedRead<T>(
  current: readonly T[],
  defaults: readonly T[],
): readonly T[] {
  return current.length > 0 ? current : defaults;
}

/**
 * Is this status the server saying "that column does not exist here"?
 *
 * The user_uuid/user_id fallback is for installs whose schema uses the other
 * name, and PostgREST reports an unknown column as 400. The fallback used to
 * run on ANY non-ok response, so a 401 was answered by asking again for a
 * column this schema does not have — a certain 400, which turned one
 * recoverable failure into a guaranteed one.
 */
export function looksLikeWrongColumn(status: number): boolean {
  return status === 400 || status === 404;
}

/**
 * Is this status worth one retry with a freshly read token?
 *
 * Only 401. A 403 is a policy refusing the row, which a new token will not
 * change, and anything 5xx is the server's problem rather than the session's.
 */
export function worthRetryingWithFreshToken(status: number): boolean {
  return status === 401;
}
