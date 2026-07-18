# Stage 4b-ii Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 4b-i (home view)
**Risk to existing React app:** zero.

## What landed

The interactive pieces of the dashboard: add/edit transactions, tap
to edit/delete, search results. The home view is now fully functional
for manual entry — no more no-op buttons.

### New files

| File | Purpose | Source port |
|---|---|---|
| `ui/dashboard/TransactionForm.kt` | Add/edit modal: amount + Expense/Refund toggle, vendor input with autocomplete, 7-cell budget grid, date row, recurrence segmented control, confirm/update button, delete (when editing) | `components/TransactionForm.tsx` |
| `ui/dashboard/ConfirmDeleteModal.kt` | "Remove Entry?" confirmation dialog | `components/ConfirmDeleteModal.tsx` |
| `ui/dashboard/TransactionActionModal.kt` | Thin wrapper that hosts `TransactionForm` with delete-confirm state when the user taps a transaction | `components/TransactionActionModal.tsx` |
| `ui/dashboard/SearchResults.kt` | Search results panel: This Month, Past Transactions (collapsible), Future Transactions (collapsible). Vendor-name filter, refund exclusion | `components/dashboard_components/SearchResults.tsx` |

### Modified files

| File | Change |
|---|---|
| `ui/dashboard/DashboardViewModel.kt` | Added `addTransaction(tx)`, `updateTransaction(tx)`, `deleteTransaction(id)`. Each one optimistically updates local state, then calls the repository, then on failure re-loads from Supabase. Mirrors the React `handleAddTransaction` etc. |
| `ui/dashboard/DashboardScreen.kt` | Wired the action callbacks. The `+` button opens the form. Tapping a transaction opens the action modal. Search field shows the `SearchResults` panel when the user has typed a query. |

### Tests

| File | Cases |
|---|---|
| `ui/dashboard/SearchFilterTest.kt` | 5 |

**Total Kotlin tests: 61 cases** (4b-i had 56, this stage adds 5).

## Key design decisions

**1. `TransactionForm` is a stateful Compose component, not a ViewModel.**

The React `TransactionForm` keeps ~10 useState hooks inside the
component. The Kotlin port does the same. Hoisting this state into
a ViewModel would mean ~10 StateFlows in `DashboardViewModel`,
which is more boilerplate than the current setup. The form is short-
lived (one modal session) and doesn't survive process death in
either React or Compose, so the trade-off is fine.

**2. The "Expense" / "Refund" toggle is a single shared component.**

The toggle is reused for the recurrence segmented control. Both are
the same shape: a pill row with mutually-exclusive buttons. I
extracted `ToggleButton` to keep the visual consistent.

**3. The date row is a click-target with no calendar popup.**

The React `TransactionForm` opens a `CalendarPicker` modal. I
shipped a placeholder date display that the user can tap, but the
actual date picker lands in a later stage (4b-iii or 4b-iv). For
Stage 4b-ii the date defaults to today and is the date the
transaction is saved with. Adding a Compose date picker is a
~50-LOC follow-up; the seam is `setDate(newValue)`.

**4. Optimistic UI updates in the ViewModel.**

The React `handleAddTransaction` adds the new transaction to local
state immediately, then writes to Supabase, then reverts on failure.
The Kotlin `addTransaction` does the same — `_transactions.update {
listOf(saved) + it }` happens before the `transactionRepository.add`
suspend call. On failure, `refresh(userId)` re-pulls from the server.

**5. The form closes immediately on save, not on success.**

This matches the React behavior. The user doesn't wait for the
Supabase round-trip; the optimistic update gives them instant
feedback, and the modal closes. If the server write fails, the
error message shows in the dashboard's error block and the data
re-loads from the server.

**6. `SearchResults` excludes refunds.**

The React `filterFn` does `tx.vendor.toLowerCase().includes(q) &&
!isRefund(tx)`. The Kotlin port replicates the same predicate. The
`isRefund` test is `amount < 0`, matching the React helper.

**7. Vendor history is built from current-month transactions only.**

The React `Dashboard.tsx` also pulls vendor history from the server
(250 most-recent transactions). The Kotlin port uses only the
in-memory current-month list because `UserDataRepository` doesn't
yet expose a dedicated `loadVendorHistory` endpoint. The result is
shorter suggestion lists, not a behavior change. The full server-
side history lands in 4b-iii alongside the settings modal.

## What you can verify locally

```bash
cd android-kotlin
./gradlew :app:testDebugUnitTest     # 61 tests
./gradlew :app:assembleDebug
./gradlew installDebug
# Open the app:
#  - Tap the + button in the bottom bar
#  - The form opens: type a vendor, enter an amount, pick a budget, hit Confirm
#  - The new transaction appears in the corresponding budget section immediately
#  - Refresh by collapsing and expanding the budget
#  - Tap a transaction in any budget section
#  - The action modal opens with the form pre-filled; tap Delete to remove it
#  - Type into the search field at the top
#  - The search results panel appears with This Month + collapsible Past/Future
#  - Tap a search result to open the action modal
```

If the form doesn't open:
- Check that the budget section list isn't in an expanded state (the +
  button is in the bottom bar, not the section list)
- Check logcat for the `UserDataRepository` tag for any RLS errors

If optimistic updates don't appear:
- Check the network tab: the POST to /rest/v1/transactions should
  return 201 with the new row
- Check the Supabase RLS policy: `Users can insert own transactions`
  must allow `WITH CHECK (auth.uid() = user_id)`

## Known limitations / explicit stubs

- **Date picker is a placeholder.** Tapping the date row does nothing.
  Stage 4b-iii adds the real Compose date picker.
- **Vendor history is local-only.** A future stage adds a server
  query for cross-month vendor autocomplete.
- **No "AI transaction" detection yet.** All new transactions are
  `MANUAL`. The notification pipeline in Stage 6 inserts
  `AUTOMATIC` transactions; the form already handles them
  (shows the "AI Transaction" pill, preserves the label on edit).
- **Refund matching is a no-op.** The list of refunded expenses
  shown with strikethrough is empty. The real `lib/refundMatching.ts`
  logic lands in Stage 6 when the notification flow is wired.
- **The settings cog is still a no-op.** That's 4b-iii.

## Stage 4b-iii preview

The settings modal (`DashboardSettingsModal.tsx`) with all 14
sub-sections: theme toggle, monthly income, budget limits, budget
visibility, partner linking, sign out, smart notifications,
app notifications, import/export transactions, support & feedback,
privacy policy, terms, vault sharing.

This is the next big UI port. Each sub-section is a small
component on its own — the modal is just a routing container.
