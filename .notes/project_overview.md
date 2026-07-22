# Project Overview — Covault

One-page architecture. For the file-by-file routing table, see `../CLAUDE.md`.

## What it is
A personal budgeting Android app for a household. Users track spending across
**7 fixed budget categories** (Housing, Groceries, Transport, Utilities, Leisure,
Services, Other), with **automatic transaction capture** from Android banking
notifications and **vault sharing** with a partner.

## Shape
- **Native only:** Kotlin 2.1.0, Jetpack Compose (Material 3), single activity.
  Everything is in `android-kotlin/`. (A legacy React/Capacitor app was removed;
  it's in git history before the "Remove React" commit if ever needed.)
- **Backend:** Supabase (Postgres + RLS) via supabase-kt 3.1.1 over Ktor/OkHttp.
  Auth is Google OAuth through a Custom Tab (no native Google SDK).
- **DI:** Hilt. Repositories are `@Singleton @Inject constructor(SupabaseClient)`;
  ViewModels are `@HiltViewModel`.
- **State:** `StateFlow` in ViewModels → `collectAsStateWithLifecycle()` in
  composables. Repositories return `Result`/nullables; ViewModels do optimistic
  UI and reload on failure.
- **Nav:** state-driven. Top-level routes in `ui/CovaultNavHost.kt`; every modal
  is a boolean in `DashboardScreen` (no nav routes for modals).

## Layers (under `android-kotlin/app/src/main/java/com/covault/app/`)
- `ui/` — Compose screens + ViewModels (auth, onboarding, dashboard, splash).
- `domain/` — **pure, unit-tested** logic: money math, parsing, category
  resolution, CSV, chart data, Discretionary Shield.
- `data/model/` — domain types + `SystemCategories` (the 7 categories + UUIDs).
- `data/remote/` — Supabase DTOs + mappers + client provider.
- `data/repository/` — one repository per concern.
- `notification/` — the notification-capture listener + parser.
- `widget/` — home-screen widget.

## Key data rule
The DB stores category **NAMES** ("Groceries"), never UUIDs. The app maps
name ↔ UUID via `SystemCategories` at load time. IDs are derived, never stored.

## Capture pipeline
`CovaultNotificationListener` → `NotificationParser.parse` (regex) →
`NotificationRepository.process` (dedup + insert `pending_transactions`) →
`ReviewCapturesModal` (user approves) → moves to `transactions` +
`VendorOverrideRepository.learn` teaches the vendor→category rule.

## Verification reality
CI compiles + unit-tests + builds the APK. **Nothing runs the app.** Runtime
behavior must be device-tested by the owner.
