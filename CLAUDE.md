# Covault — AI Codebase Reference (THE MAP)

Personal budget-tracking Android app for a household. Users track spending across
7 fixed budget categories, with automatic transaction capture from Android banking
notifications and vault sharing with a partner. The whole app is the self-contained
Gradle project in **`android-kotlin/`**; backend is Supabase. (A legacy React app
was removed — it's in git history before the "Remove React" commit if ever needed.)

**This repo is maintained by AI.** Keep this file current, keep code lean, and
prefer surgical edits over rewrites.

> **This file is the repository map.** To make a change, find it in the
> **Change-routing map** below and open **only** the file(s) it names — do not
> scan the repo. Companion docs: [`AGENTS.md`](./AGENTS.md) (front door +
> working protocol), [`.notes/gotchas.md`](./.notes/gotchas.md) (traps — read
> before editing), [`.notes/project_overview.md`](./.notes/project_overview.md),
> [`.notes/task_list.md`](./.notes/task_list.md).

## How to work in this repo (read first)

1. **Route with the table below** — don't explore. Grep for a symbol only when the
   table doesn't cover your task.
2. **Read only what you need.** Files are small and single-purpose; read the file
   the table names, not its neighbors.
3. **You cannot run the app locally.** CI compiles, unit-tests, and builds the APK
   (`.github/workflows/build-kotlin.yml`). Compile-green ≠ works — runtime flows
   (capture, auth, review) need the owner to test on a device. Say so when relevant.
4. **Pure logic lives in `domain/` and is unit-tested.** If you change money math,
   parsing, or category resolution, update the matching test in
   `android-kotlin/app/src/test/java/com/covault/app/`.
5. **Update "Feature status"** below whenever you add or remove a feature.

## Change-routing map ("change X → edit Y")

Paths relative to `android-kotlin/app/src/main/java/com/covault/app/`.

| Change | Edit |
|---|---|
| Budget categories (names/UUIDs) | `data/model/SystemCategories.kt` (+ DB enum `Budgets`) |
| Budget card UI / expand behavior | `ui/dashboard/BudgetSection.kt` |
| Budget flow chart | `ui/dashboard/BudgetFlowChart.kt` |
| Category icons / colors | `ui/dashboard/BudgetIcons.kt`, `domain/BudgetColors.kt` |
| Dashboard layout / which modals exist | `ui/dashboard/DashboardScreen.kt` |
| Dashboard data loading / user actions | `ui/dashboard/DashboardViewModel.kt` |
| Balance header / remaining-money math | `ui/dashboard/DashboardBalanceSection.kt`, `domain/DashboardTotals.kt` |
| Discretionary Shield (Leisure absorbs overspend) | `domain/DiscretionaryShield.kt`; toggle in settings modal |
| Bottom bar (add / inbox / search) | `ui/dashboard/DashboardBottomBar.kt` |
| Add/edit transaction form | `ui/dashboard/TransactionForm.kt` |
| Transaction row / long-press actions | `ui/dashboard/TransactionItem.kt`, `TransactionActionModal.kt` |
| Search | `ui/dashboard/SearchResults.kt` + filter logic in `DashboardViewModel.kt` |
| Settings modal (all sections) | `ui/dashboard/SettingsModalSections.kt` |
| Dark-mode toggle | `ui/dashboard/ThemeViewModel.kt`, `data/repository/ThemePreference.kt`, `ui/theme/Theme.kt` |
| Learned rules (vendor→category) UI + merge | `ui/dashboard/LearnedRulesModal.kt` + `LearnedRulesViewModel.kt` |
| Learned rules storage / learning | `data/repository/VendorOverrideRepository.kt`, `data/model/VendorOverride.kt` |
| Category auto-resolution precedence | `domain/CategoryResolver.kt` (exact rule → fuzzy → user) |
| Vendor name cleanup / fuzzy match | `domain/FormatVendorName.kt` |
| Notification capture (parse bank texts) | `notification/NotificationParser.kt` |
| Capture accept / dedup / insert | `data/repository/NotificationRepository.kt` |
| Review pending captures UI | `ui/dashboard/ReviewCapturesModal.kt` |
| Recurring projections (display-only) | `domain/RecurringExecutor.kt`, folded in by `DashboardTotals` |
| CSV import / export | `domain/CsvImport.kt`, `domain/CsvExport.kt`; UI hooks in settings modal |
| Auth / Google sign-in | `ui/auth/AuthScreen.kt` + `AuthViewModel.kt`, `data/repository/AuthRepository.kt` |
| Session / auth-state routing | `ui/MainViewModel.kt`, `ui/CovaultNavHost.kt`, `data/repository/SessionStore.kt` |
| Auth deep link handling | `MainActivity.kt` + manifest intent-filter |
| Onboarding | `ui/onboarding/OnboardingScreen.kt` + `OnboardingViewModel.kt` |
| Partner linking | `data/repository/SettingsRepository.kt` (`linkPartner` / `unlinkPartner`) |
| Settings persistence (income, toggles) | `data/repository/SettingsRepository.kt` |
| Full data load on app open (+ budget seeding) | `data/repository/UserDataRepository.kt` |
| Transaction CRUD against Supabase | `data/repository/TransactionRepository.kt` |
| Budget-limit writes | `data/repository/BudgetRepository.kt` |
| DTO ↔ domain mapping, budget-ID resolution | `data/remote/TransactionMappers.kt` |
| Supabase row shapes | `data/remote/dto/SupabaseDtos.kt` |
| Supabase client config / OAuth callback | `data/remote/SupabaseClientProvider.kt`, `di/SupabaseModule.kt` |
| Home-screen widget | `widget/` (3 files) + `res/layout/widget_covault.xml` |
| Legal / FAQ / delete-confirm modals | `ui/dashboard/LegalModal.kt`, `FAQModal.kt`, `ConfirmDeleteModal.kt` |
| Date / vendor-string helpers | `domain/DateUtils.kt`, `domain/TransactionNormalizer.kt` |
| Domain types (Transaction, User, …) | `data/model/Models.kt` |
| Dependencies / versions | `android-kotlin/gradle/libs.versions.toml` + `app/build.gradle.kts` |
| CI / APK build | `.github/workflows/build-kotlin.yml` |
| DB schema reference | `supabase/schema.sql` (+ `supabase/migrations/`) |

## Stack

- Kotlin 2.1.0, Jetpack Compose (BOM 2024.12.01), Material 3, single activity
- Hilt 2.56.2 (DI) via KSP; AGP 8.7.3, Gradle 8.10.2, JDK 17/21, minSdk 26, targetSdk 35
- supabase-kt 3.1.1 (`auth-kt`, `postgrest-kt` only) over Ktor/OkHttp
- Tests: JUnit4 only — plain JVM unit tests, no instrumented tests

### Commands (run from `android-kotlin/`)
```bash
./gradlew :app:compileDebugKotlin     # fast compile check
./gradlew :app:testDebugUnitTest      # unit tests
./gradlew :app:assembleDebug          # debug APK
```
Needs an Android SDK + `local.properties` with `SUPABASE_URL` / `SUPABASE_ANON_KEY`
(CI writes these from secrets, with dummy fallbacks). **Gotcha:** inside the Gradle
`android {}` block `java` resolves to Gradle's extension, so `java.util.Properties()`
won't compile — `import java.util.Properties` at the top of `app/build.gradle.kts`
(already done; don't "fix" it back).

## Architecture patterns

- **DI:** repositories are `@Singleton @Inject constructor(supabase: SupabaseClient)`;
  ViewModels `@HiltViewModel`, obtained via `hiltViewModel()`.
- **State:** `StateFlow` in ViewModels → `collectAsStateWithLifecycle()` in composables.
  Repositories return `Result`/nullables; ViewModels do optimistic UI + reload on failure.
- **Nav:** state-driven. Top-level routes in `CovaultNavHost`; every modal is a
  boolean in `DashboardScreen` — no nav routes for modals.
- **supabase-kt 3.1.1 API** (differs from newer docs):
  - `SessionStatus` is in `io.github.jan.supabase.auth.status`; loading = `Initializing`.
  - `supabase.auth.signOut(SignOutScope.LOCAL)`; needs `import ...auth.auth`.
  - Query: `postgrest["table"].select { filter { eq(...) } }.decodeList<Dto>()`.
  - Update: `.update(mapOf("col" to v)) { filter { eq(...) } }` **or** builder
    `.update({ set("col", v) }) { filter { ... } }`. Delete: `.delete { filter { ... } }`.
  - RPC params are a `JsonObject`, not a `Map`.

## Database (Supabase / PostgreSQL, RLS on all tables)

| Table | Purpose | Notes |
|---|---|---|
| `budgets` | Per-user category limits | `user_uuid`, `budget` (category NAME), `amount`, `visible` (column exists, app doesn't use it). |
| `transactions` | Confirmed transactions | `budget` stores the NAME ("Groceries"); `type` = Manual/Automatic. |
| `pending_transactions` | Captured, awaiting review | `status` pending/approved/rejected, `confidence`. |
| `settings` | 1 row per user | `partner_id`, `monthly_income`, theme, `leisure_buffer_enabled` (= Discretionary Shield), trial/subscription. |
| `overrides` | Learned vendor→category rules | `proper_name`, `match_key`, `match_type`, **`category_id` stores the category NAME**, `updated_at`. |

**IDs are derived, never stored:** the DB stores category NAMES; the app maps
name ↔ UUID via `SystemCategories` at load time. The 7 fixed categories (Housing,
Groceries, Transport, Utilities, Leisure, Services, Other) + UUIDs live in
`SystemCategories.kt`.

## Notification capture pipeline

```
CovaultNotificationListener (user grants notification access)
  → NotificationParser.parse(text)      # regex → amount/vendor/income-refund/confidence
  → NotificationRepository.process()    # reject low confidence, dedup 5-min window,
                                        # insert pending_transactions(status=pending)
  → ReviewCapturesModal (Inbox button)  # approve → row moves to transactions;
                                        # CategoryResolver + VendorOverrideRepository.learn()
                                        # teaches the vendor→category rule
```
Category precedence: learned rule (exact/prefix/contains) → fuzzy
(`FormatVendorName.fuzzyVendorMatch`) → user picks. No on-device ML.

## Feature status — keep this current

- ✅ Auth (Google), dashboard, budget limits, transaction CRUD, search, partner
  sharing, widget, learned rules (view/edit/merge), notification capture + review,
  category resolution (exact → fuzzy → learn), CSV import/export, dark-mode toggle,
  Discretionary Shield, legal pages, recurring **projections** (display-only math
  in `DashboardTotals`).
- ❌ Not implemented: persisting recurring transactions to the DB (the display-only
  projection is intentional; the old DB-persisting `RecurringRepository` was removed
  as unwired dead code), category-visibility UI (`budgets.visible` unused), on-device
  AI extraction (capture is regex + learned rules).
- ⚠️ **2026-07 fixes not yet device-verified:** `SystemCategories.idForName` case bug
  (it previously ALWAYS returned null → budget limits reset to defaults on every load
  and per-category spend never matched its budget card). Fixed + regression-tested in
  `SystemCategoriesTest`, but confirm on a device that limits persist and category
  totals fill before building on top of them.

## Coding conventions

- Composables `PascalCase`; ViewModels `XxxViewModel`; repositories `XxxRepository`.
- Warnings don't fail the build; still, don't leave unused imports/symbols behind.
- Prefer stable Compose APIs; annotate experimental ones
  (`@OptIn(ExperimentalLayoutApi::class)` for `FlowRow`, etc.).

## Verification reality

CI (`build-kotlin.yml`) = compile + unit tests + APK. **Nothing runs the app.**
Never claim a runtime feature works from a green build; ask the owner to device-test.
