# Stage 7 Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 6
**Risk to existing React app:** zero.

## What landed

Recurring transaction executor + future-dated projection. The
missing piece that makes `DashboardTotals.remainingMoney` and the
budget bars' projected fill correct.

### New files

| File | Purpose | Source port |
|---|---|---|
| `domain/RecurringExecutor.kt` | Pure logic: compute due past dates (catches up missed instances within 2 months) and compute future projections (6 months ahead) for each recurring template | `lib/recurringExecutor.ts` + `lib/projectedTransactions.ts` |
| `data/repository/RecurringRepository.kt` | Orchestrator: takes the user's transactions, runs the executor, inserts the new projected rows into Supabase | `lib/recurringExecutor.ts` (orchestrator) |
| `test/domain/RecurringExecutorTest.kt` | 7 cases covering monthly / biweekly / one-time templates, projected-id format, isProjected flag, backfill cap | new |

### Modified files

| File | Change |
|---|---|
| `domain/DashboardTotals.kt` | The `projectedTransactions` list is now non-empty: it's `RecurringExecutor.computeFutureProjections(transactions, now)`. The `remainingMoney` math correctly folds the projection in |

## What's ported

- ✓ Monthly recurrence: `current.plus(1 month)`
- ✓ Biweekly recurrence: `current.plus(2 weeks)`
- ✓ One-time is a no-op
- ✓ Future projection horizon: 6 months
- ✓ Past-due catch-up: 2-month backfill window
- ✓ Projected id format: `projected-{template_id}-{date}`
- ✓ Projected rows are marked `is_projected = true`
- ✓ Per-template safety cap: 200 rows
- ✓ Projected insert via the existing `transactions` table (uses
  the same `TransactionMappers` as manual entries)

## What you can verify on device

- Add a Monthly transaction in the form (e.g. rent on the 1st)
- Wait for the next app open, or tap the dashboard's "Refresh" path
- The executor computes the next 6 months of projections and inserts
  them
- The dashboard's `remainingMoney` now reflects `monthlyIncome -
  spent - projectedThisMonth` (the projected contribution is
  visible as the dashed bar in `BudgetSection`)
- The monthly pulse card on the React app now matches the Kotlin
  app's `remainingMoney`

## Test counts

| Stage | Tests added | Total |
|---|---|---|
| Stage 1 | 1 | 1 |
| Stage 2 | 40 | 41 |
| Stage 3 | 0 | 41 |
| Stage 4a | 13 | 54 |
| Stage 4b-i | 3 | 57 |
| Stage 4b-ii | 5 | 62 |
| Stage 4b-iii | 0 | 62 |
| Stage 4b-iv | 0 | 62 |
| Stage 5 | 0 | 62 |
| Stage 6 | 11 | 73 |
| **Stage 7** | **7** | **80** |

## Stage 8 preview (last one)

Cleanup. The Kotlin app is now feature-complete with the React app
(at least for the manual + notification + recurring flows). The last
stage is:
- Verify the test suite passes on a real device
- Bump version to 0.1.0
- Final README for the `android-kotlin/` module
- No React-app removal (you said to keep it)
