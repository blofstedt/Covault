# Covault — AI Codebase Reference

## What is Covault?

Personal budget-tracking app for a household. Users track spending across budget
categories, with automatic transaction capture from Android banking notifications.
Supports sharing a vault with a partner.

## This is a native Kotlin / Jetpack Compose Android app

The whole app lives in **`android-kotlin/`** (a self-contained Gradle project) —
there is no other app. A legacy React/TypeScript + Capacitor web app used to sit
at the repo root; it was removed once the Kotlin app took over. If you ever need
it as a reference, it's in git history (before the "Remove React" commit). Build
+ CI: `.github/workflows/build-kotlin.yml`. Backend is Supabase (see Database).

## Kotlin app (`android-kotlin/`)

### Stack
- Kotlin 2.1.0, Jetpack Compose (BOM 2024.12.01), Material 3
- Hilt 2.56.2 (DI), KSP
- supabase-kt 3.1.1 (`auth-kt`, `postgrest-kt`, `realtime-kt`, `storage-kt`) over Ktor (OkHttp engine)
- AGP 8.7.3, Gradle 8.10.2, JDK 17/21, `minSdk 26`, `targetSdk 35`
- Tests: JUnit4 + MockK + Turbine (unit only; no instrumented tests run in CI)

### Commands (run from `android-kotlin/`)
```bash
./gradlew :app:compileDebugKotlin     # fast compile check
./gradlew :app:testDebugUnitTest      # unit tests
./gradlew :app:assembleDebug          # build debug APK
```
Requires an Android SDK and a `local.properties` with `SUPABASE_URL` and
`SUPABASE_ANON_KEY` (CI writes these from repo secrets, with dummy fallbacks —
see `build-kotlin.yml`). **`java.util.Properties` gotcha:** inside the Gradle
`android {}` block, `java` resolves to Gradle's `java` extension, so
`java.util.Properties()` fails to resolve — import `java.util.Properties` at the
top of `app/build.gradle.kts` instead.

### Structure (`app/src/main/java/com/covault/app/`)
```
MainActivity.kt              # Single activity; hosts Compose + handles auth deep links
ui/
  CovaultNavHost.kt          # Top-level nav: splash → auth → onboarding → dashboard (state-driven)
  theme/Theme.kt             # Material3 color schemes; follows system dark mode
  auth/                      # AuthScreen + AuthViewModel (Google sign-in)
  onboarding/                # OnboardingScreen + ViewModel (partially stubbed)
  splash/                    # SplashScreen
  dashboard/                 # The bulk of the UI:
    DashboardScreen.kt       #   home view + modal host
    DashboardViewModel.kt    #   @HiltViewModel; loads data, transaction/settings ops
    BudgetSection, BudgetFlowChart, DashboardBalanceSection, DashboardBottomBar,
    TransactionForm, TransactionItem, TransactionActionModal, SearchResults,
    SettingsModalSections.kt #   the settings modal + its sub-sections
    LearnedRulesModal.kt     #   vendor→category rules + merge (native Compose)
    LearnedRulesViewModel.kt
    ReviewCapturesModal.kt   #   review/approve captured (pending) transactions
    ThemeViewModel.kt        #   backs the dark-mode toggle
    FAQModal, PremiumGate, ConfirmDeleteModal
  components/                # Shared (CovaultLogoMark, ...)
data/
  model/Models.kt            # Domain types: User, BudgetCategory, Transaction, Settings, PendingTransaction
  model/SystemCategories.kt  # The 7 fixed budget categories + fixed UUIDs (match React constants.ts)
  model/VendorOverride.kt    # Learned-rule model + MatchType (exact/prefix/contains)
  remote/dto/SupabaseDtos.kt # PostgREST row DTOs (@Serializable, @SerialName)
  remote/TransactionMappers.kt # DTO ↔ domain mapping
  repository/                # One per concern, all inject SupabaseClient:
    AuthRepository, UserDataRepository, TransactionRepository, BudgetRepository,
    SettingsRepository, RecurringRepository, NotificationRepository,
    VendorOverrideRepository, ThemePreference (DataStore), SessionStore
domain/                      # Pure logic (unit-tested): DashboardTotals, DateUtils,
                             # FormatVendorName, TransactionNormalizer, RecurringExecutor,
                             # BudgetColors, CategoryResolver (exact→fuzzy→learn),
                             # CsvExport, CsvImport
notification/
  CovaultNotificationListener.kt # NotificationListenerService (declared in manifest)
  NotificationParser.kt      # Regex parse of bank notification text → amount/vendor/confidence
widget/                      # Home-screen widget (CovaultWidgetProvider, WidgetDataStore, WidgetUpdater)
```

### Architecture patterns
- **DI:** Hilt. Repositories are `@Singleton @Inject constructor(supabase: SupabaseClient)`.
  ViewModels are `@HiltViewModel`; obtained in composables via `hiltViewModel()`.
- **State:** `StateFlow` in ViewModels, `collectAsStateWithLifecycle()` in composables.
  Repositories are pure (return `Result`); ViewModels own optimistic UI state and
  reload from source on failure.
- **supabase-kt 3.1.1 API notes** (differs from newer docs):
  - `SessionStatus` is in `io.github.jan.supabase.auth.status`; loading state is `Initializing`.
  - `supabase.auth.signOut(SignOutScope.LOCAL)`; needs `import ...auth.auth`.
  - Query: `postgrest["table"].select { filter { eq(...) } }.decodeList<Dto>()`.
  - Update: `.update(mapOf("col" to v)) { filter { eq(...) } }` **or** the builder
    `.update({ set("col", v) }) { filter { ... } }`. Delete: `.delete { filter { ... } }`.
  - RPC params are a `JsonObject`, not a `Map`.
- **Nav:** state-driven (no routes for modals — modals are boolean state in DashboardScreen).

## Database (Supabase / PostgreSQL)

All tables use RLS (`auth.uid() = user_id` + partner-access policies).

| Table | Purpose | Notes |
|-------|---------|-------|
| `budgets` | Per-user budget categories | cols: `user_uuid`, `budget` (enum name), `amount`, `visible`. |
| `transactions` | Confirmed transactions | `budget` stores the enum **name** ("Groceries"); `type` = Manual/Automatic. |
| `pending_transactions` | AI/regex-captured, awaiting review | `status` pending/approved/rejected, `confidence`. |
| `settings` | 1 row per user | `partner_id`, `monthly_income`, theme, trial/subscription. |
| `overrides` (a.k.a. vendor_overrides) | Learned vendor→category rules | `proper_name`, `match_key`, `match_type`, **`category_id` stores the category NAME**, `updated_at`. |

**7 system categories** (fixed UUIDs in `SystemCategories.kt`, matching React
`constants.ts`): Housing, Groceries, Transport, Utilities, Leisure, Services, Other.

## Notification capture pipeline (Kotlin)
```
CovaultNotificationListener (system service, user must grant permission)
  → NotificationParser.parse(rawText)   # regex: amount, vendor, income/refund, confidence
  → NotificationRepository.process():
      reject if low confidence / missing fields; dedup vs pending_transactions (5-min window);
      insert into pending_transactions (status="pending")
  → NotificationRepository.approvePending() moves a row → transactions and deletes the pending row
```
Capture works and is wired. Captured rows are reviewed/approved in
`ReviewCapturesModal` (opened from the bottom-bar Inbox button); approving moves
a row into `transactions` and, via `CategoryResolver` + `VendorOverrideRepository.learn`,
teaches a vendor→category rule so the next capture auto-categorizes.
Category precedence: deterministic learned rule → fuzzy match
(`FormatVendorName.fuzzyVendorMatch`) → user picks. No on-device ML model.

## Feature status — keep this current

- ✅ Done: auth, dashboard, budgets/limits, transaction CRUD, search, recurring,
  partner sharing, home-screen widget, Learned Rules (view + merge), notification
  capture → `pending_transactions`, capture review/approve UI, category resolution
  (exact → fuzzy → learn), CSV import/export, dark-mode toggle.
- ❌ / partial: rollover / leisure-buffer budget math, onboarding polish,
  Privacy/Terms/Tutorial pages, on-device AI extraction (capture is regex + fuzzy
  learned-rule matching, not an ML model).
- ⚠️ Much of the above is compile/unit-verified only — **not yet run on a device.**

## Known issues
- `SystemCategories.idForName()` lowercases the lookup key but `idByName` is keyed by
  the original-case name, so it returns null. It feeds budget/transaction ID
  resolution in several places — fix carefully and verify on a device/emulator, not
  compile-only.

## Coding conventions (Kotlin)
- Composables `PascalCase`; ViewModels `XxxViewModel`; repositories `XxxRepository`.
- Not strict null-safety beyond Kotlin defaults; no `allWarningsAsErrors` (warnings
  don't fail the build).
- Prefer stable Compose APIs; annotate experimental ones (`@OptIn(ExperimentalLayoutApi::class)` for `FlowRow`, etc.).

## Verification reality
CI (`build-kotlin.yml`) compiles, runs unit tests, and builds the debug APK — but
**nothing runs the app**. Compile-green ≠ works. Runtime-heavy features (capture,
AI, review flow) must be tested on a device/emulator; don't claim a feature works
from a green build alone.
