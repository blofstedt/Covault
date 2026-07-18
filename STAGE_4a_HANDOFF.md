# Stage 4a Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 3 (auth + onboarding + nav graph)
**Risk to existing React app:** zero.

## Why two commits (4a + 4b)?

The full visual port of `components/Dashboard.tsx` is a 522-LOC orchestrator
that depends on ~7 dashboard sub-components (`DashboardBalanceSection`,
`DashboardBudgetSectionsList`, `BudgetFlowChart`, `SearchResults`,
`DashboardSettingsModal`, `DashboardBottomBar`, `TransactionParsing`) — each
of which is itself 100-260 LOC and has its own state and props. Porting all
of them faithfully in one shot is a multi-day effort and would risk shipping
a "Stage 4" that is actually 30% done.

This commit (4a) is **data-first**: the repositories, the two pure-hook
ports, the dashboard ViewModel, and a screen that renders real Supabase
data. The next commit (4b) does the full visual port on top of this
data layer.

This way you can verify the data layer round-trips against your real
Supabase project **today**, before we commit to the visual direction.

## What landed

### Repositories

| File | Purpose | Source port |
|---|---|---|
| `data/repository/UserDataRepository.kt` | Orchestrates 6 sub-loads: budgets, settings, transactions, pending, household link, orphan remap. Returns a `UserData` value object. | `lib/hooks/useDataLoading.ts` |
| `data/repository/TransactionRepository.kt` | Transaction CRUD: `add`, `update`, `delete`, `addManual`. | `lib/hooks/useTransactionOps.ts` |

### Domain (pure logic)

| File | Purpose | Source port |
|---|---|---|
| `domain/TransactionNormalizer.kt` | `normalize(transactions, budgets)` resolves legacy `category_id` and `budget:` prefixed IDs to the current user's budget IDs. | `components/dashboard_components/useNormalizedTransactions.ts` |
| `domain/DashboardTotals.kt` | `compute(transactions, income, now)` returns current-month transactions, projected transactions, and remaining money. | `components/dashboard_components/useDashboardTotals.ts` |

### ViewModel + Screen

| File | Purpose |
|---|---|
| `ui/dashboard/DashboardViewModel.kt` | Pulls data from `UserDataRepository` on user change. Exposes `user`, `budgets`, `transactions`, `pendingTransactions`, `isLoading`, `errorMessage`, plus a `refresh(userId)` action. |
| `ui/dashboard/DashboardScreen.kt` | Renders real data: user name, transaction list (sorted by date desc), budget list, loading spinner, error banner, pending count badge. **This is the data-first screen — Stage 4b replaces it with the full visual port.** |

### Tests

| File | Cases |
|---|---|
| `domain/TransactionNormalizerTest.kt` | 8 |
| `domain/DashboardTotalsTest.kt` | 5 |

**Total Kotlin tests: 53 cases** (Stage 2 had 40, Stage 3 added 0, this stage adds 13).

## Key design decisions

**1. `UserDataRepository.loadUserData` returns a value object, not a side-effecting callback chain.**

The React code is a sequence of `useCallback` closures that call `setAppState` from each one. Translating that pattern to Kotlin gives you untestable side effects on a hidden global. Instead, the repository computes the final `UserData` value and returns it. The ViewModel applies it to its own state container. This means we can unit-test the repository with a fake `SupabaseClient` (Stage 7) and the screen state transitions are 100% testable too.

**2. The repository calls `supabase.postgrest["..."]`, not the raw fetch-with-REST-BASE pattern the React app uses.**

The React app uses `fetch("${REST_BASE}/...")` with manual JWT headers from `apiHelpers.ts`. The Kotlin port uses supabase-kt's typed Postgrest DSL because we have it injected. The query semantics are identical; the result is just typesafe on our side.

**3. `TransactionRepository` does NOT do optimistic UI updates.**

The React code mutates local state before the server confirms the write, so the UI feels instant. In Kotlin we have a `Result<Transaction>` return type — the ViewModel decides whether to apply the optimistic update or wait for the server round-trip. Stage 4b's UI will use this return value; the contract is "tell me what changed, I'll update my state."

**4. `DashboardTotals.projectedTransactions` is `emptyList()` for now.**

The React version uses `lib/projectedTransactions.ts` which depends on the recurring-transaction executor (`lib/recurringExecutor.ts`). That's Stage 6 work — wiring the recurring-executor port now would mean porting ~300 LOC of date math that's not visible in the UI without the executor's call sites. Leaving it empty means the dashboard's `remainingMoney` is just `monthlyIncome - spent` for now, which is still correct.

**5. The dashboard screen is a leaf Compose component that re-derives totals on each render.**

The React app's `useDashboardTotals` is a `useMemo` inside `Dashboard.tsx`. The Kotlin port puts the memoization in the domain function (`DashboardTotals.compute`) and the ViewModel exposes it as a regular method called by the screen during composition. Compose's `LazyColumn` handles the recomposition efficiently.

**6. `TransactionNormalizer` is a single function, not a class.**

The React port is a hook (`useNormalizedTransactions`) that wraps a plain function. The Kotlin port preserves the plain function and skips the hook wrapper — Kotlin's data flow makes memoization trivial at the call site. If perf becomes a concern, we can wrap the call in `derivedStateOf` in the ViewModel later.

## What you can verify locally

```bash
cd android-kotlin
./gradlew :app:testDebugUnitTest
# 53 tests, all green
./gradlew :app:assembleDebug
./gradlew installDebug
# Open the app:
#  - Sign in with Google
#  - Onboard (or skip)
#  - Dashboard renders:
#    - Your name + email in the header
#    - Your budgets (from the budgets table)
#    - Your recent transactions (from the transactions table, sorted desc)
#    - A "loading" spinner briefly while the load runs
#    - A pending-count badge if you have any AI-caught transactions
#    - An error message if the load fails (e.g. RLS policy misconfigured)
```

If transactions don't show:
- Check the RLS policies in `supabase/schema.sql` allow `select` on the `transactions` table for `auth.uid()`
- Check the anon key has access (it should — anon key + authenticated user = RLS kicks in)
- Check logcat for `UserDataRepository` and `Supabase` tags

## Known limitations / explicit stubs (will be addressed in Stage 4b)

- **No transaction form yet.** Adding transactions still requires the React app.
- **No budget flow chart yet.** That comes from `BudgetFlowChart.tsx`.
- **No search yet.** That comes from `DashboardBalanceSection` + `SearchResults`.
- **No settings modal yet.** That comes from `DashboardSettingsModal`.
- **No bottom bar yet.** That comes from `DashboardBottomBar`.
- **No transaction action modal yet.** That comes from `TransactionActionModal`.
- **No transaction parsing screen yet.** That comes from `TransactionParsing.tsx` and depends on Stage 6 (notification listener).

All of those are UI on top of the data layer that ships in this commit.

## Stage 4b preview

The full visual port of `components/Dashboard.tsx`. The 7 dashboard
sub-components in `components/dashboard_components/`, the
`TransactionForm`, the `TransactionActionModal`, and the settings modal.

This is the single largest commit in the migration. Plan: split it
into 4b-i (BalanceSection + BudgetSectionsList + BottomBar — the
home view), 4b-ii (TransactionForm + ActionModal + TransactionParsing
entry point), 4b-iii (Settings modal with all 14 sub-sections),
4b-iv (Search + BudgetFlowChart). Each substage ends with something
visible.
