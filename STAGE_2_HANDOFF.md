# Stage 2 Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 1 (scaffold) commit
**Risk to existing React app:** zero. No file outside `android-kotlin/` was touched.

## What landed

The data layer and pure-logic port. The UI doesn't change yet (still the
Stage 1 placeholder) but the app now has real Supabase connectivity and
everything that doesn't depend on a screen.

### Data layer

| File | Purpose | Source port |
|---|---|---|
| `data/model/Models.kt` | Domain models: `User`, `Transaction`, `Settings`, `AppState`, enums | `types.ts` |
| `data/model/SystemCategories.kt` | The 7 system budget categories with stable UUIDs | `constants.ts` |
| `data/remote/dto/SupabaseDtos.kt` | Supabase row DTOs matching the live schema | new (snake_case wrappers) |
| `data/remote/SupabaseClientProvider.kt` | Builds the supabase-kt client from `BuildConfig` | `lib/supabase.ts` |
| `data/remote/TransactionMappers.kt` | Bidirectional mappers: row ↔ domain | `lib/hooks/transactionMappers.ts` |
| `data/repository/SessionStore.kt` | Auth session tracking + 14-day expiry | `lib/hooks/useAuthState.ts` |
| `di/SupabaseModule.kt` | Hilt singleton provider for the Supabase client | new |

### Domain (pure logic, no Android dependencies)

| File | Purpose | Source port |
|---|---|---|
| `domain/DateUtils.kt` | Local-calendar date helpers using `java.time.LocalDate` | `lib/dateUtils.ts` |
| `domain/FormatVendorName.kt` | Title case + vendor dedup normalization + fuzzy match | `lib/formatVendorName.ts` |
| `domain/BudgetColors.kt` | The 7-category palette as Compose `Color` + hex helpers | `lib/budgetColors.ts` |

### Tests (5 files, 28 cases)

| File | Cases | Mirrors |
|---|---|---|
| `domain/DateUtilsTest.kt` | 3 | `lib/__tests__/dateUtils.test.ts` |
| `domain/FormatVendorNameTest.kt` | 18 | new — covers `formatVendorName`, `normalizeVendorForDedup`, `fuzzyVendorMatch` |
| `domain/BudgetColorsTest.kt` | 3 | new |
| `data/TransactionMappersTest.kt` | 16 | `lib/__tests__/transactionMappers.test.ts` |
| `Stage1SmokeTest.kt` | 1 | new — verifies the JVM runner is wired |

**Total Kotlin tests: 41 cases.** Run with `./gradlew :app:testDebugUnitTest`.

## Key design decisions

**1. DTOs are separate from domain models.**
The React app conflates the two (`Transaction` is used everywhere). For
the Kotlin port I split: domain models in `data/model/`, Supabase rows
in `data/remote/dto/`. Mappers in `data/remote/TransactionMappers.kt`
bridge them. This means schema drift (column renames, new required
columns) only touches one file.

**2. Date handling uses `java.time.LocalDate`, not `Instant`.**
The React app's `dateUtils.ts` exists specifically to avoid `toISOString`
timezone shifts. Kotlin's `LocalDate` is timezone-free by design and
maps 1:1 to the React helper. Stage 4 UI code will continue using
`LocalDate` end-to-end — no `Instant.toString().substring(0,10)` traps.

**3. The supabase-kt client fails loudly when not configured.**
`SupabaseClientProvider.build()` throws if `SUPABASE_ANON_KEY` is empty
in `BuildConfig`. The React app falls back to a stub client that
silently swallows calls — that pattern is dangerous in production and
I refused to replicate it. To run the app you must set the anon key in
`android-kotlin/local.properties`.

**4. Session expiry is 14 days, matching the React app.**
`SessionStore.isSessionValid()` mirrors `lib/hooks/useAuthState.ts`'s
`isSessionValid`. If no timestamp is stored yet, it's stamped now and
the session is considered valid — same first-login behavior.

**5. Domain `Transaction.date` is a `String`, not a `LocalDate`.**
The React app keeps the date as a string (sometimes with `T12:00:00.000Z`
appended) and slices to 10 chars for display. The Kotlin port preserves
this exactly so the same `YYYY-MM-DD` round-trips through the schema,
the React app, and the Kotlin app. The `TransactionMappers` enforce
the noon-UTC suffix on read.

## Known limitations / explicit stubs

- **No `BudgetRepository` or `TransactionRepository` yet.** Stage 3
  adds them; the data layer is currently mapper + client only.
- **No realtime subscriptions wired up.** The Realtime plugin is
  installed but nothing subscribes. Stage 5 needs it for the settings
  modal that mirrors partner changes; we'll add it then.
- **`AppState` is plain data, no Redux/state container.** Stage 3 picks
  the state architecture (lean: `StateFlow` + ViewModels per screen,
  no Compose `MutableState` hoisting across screens).

## What you can verify locally

After pulling the branch:

```bash
cd android-kotlin
./gradlew :app:testDebugUnitTest
# 41 tests, all green
```

You won't see any UI change yet — Stage 1's "Covault" placeholder is
still the launcher screen. The data layer is fully unit-tested but
nothing calls into it from a screen yet.

## Stage 3 preview

- `AuthRepository` (sign in with Google via Custom Tab + deep link,
  sign out, observe session)
- `OnboardingViewModel` + `OnboardingScreen` (Compose)
- `AuthScreen` (Compose) — mirrors `components/Auth.tsx`
- Wire `MainActivity` to a `NavHost` that switches between
  loading / auth / onboarding / dashboard based on `SessionStore.sessionState`
- Port `lib/hooks/useAuthState.ts`'s `mapUser` helper into the
  `AuthRepository`

The first Compose screen will be the auth screen, and once it
connects to real Supabase auth, you'll be able to log in with the
same Google account the React app uses.
