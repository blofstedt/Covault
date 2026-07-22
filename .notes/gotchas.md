# Gotchas — read before editing

Recurring traps and project-specific quirks. Each one has cost an agent time or
caused a bug here. Don't repeat them.

## Build / dependencies
- **`java.util.Properties` in `app/build.gradle.kts`:** inside the Gradle
  `android {}` block, `java` resolves to Gradle's extension, so
  `java.util.Properties()` won't compile. There is an explicit
  `import java.util.Properties` at the top — **don't "fix" it away.**
- **Ktor deps look unused but are required at runtime.** `ktor-client-*` has zero
  direct references in app code, but supabase-kt uses it as its HTTP engine.
  Removing it compiles fine and breaks networking at runtime. **Keep it.**
- **`material-icons-extended` is required.** Several icons in use (AttachMoney,
  Bolt, DirectionsCar, LocalGroceryStore, PhoneIphone, Tune…) are extended-only.
  Don't "optimize" to `material-icons-core`.

## Auth
- **OAuth redirect MUST be `com.covault.app://auth/callback`** (with `/callback`).
  It has to match the manifest intent-filter AND the Supabase-dashboard allow-list.
  supabase-kt's default is `scheme://host` (no `/callback`) → lands on an
  unhandled page → "404 on sign in". Pass `redirectUrl` explicitly to
  `signInWith(Google, ...)`.

## Data / Supabase
- **Settings writes: targeted UPDATE, not full-row upsert.** A full-row upsert of
  `SettingsRow` re-serializes managed columns (`link_code`, `trial_*`,
  `subscription_status`) and silently fails. Use
  `.update({ set("col", v) }) { filter { eq("user_id", id) } }` — see
  `SettingsRepository.upsertSettings` / `linkPartner`.
- **DB stores category NAMES, not UUIDs.** Map via `SystemCategories` at load.
- **`SystemCategories.idForName` keys its lookup map lowercase** because it
  lowercases the argument. This bug (map keyed original-case → always null) reset
  budget limits on every load and broke per-category totals. Regression-tested in
  `SystemCategoriesTest`; keep it lowercase-keyed.

## UI / theme
- **Brand palette is emerald/slate; `dynamicColor` is OFF by default.** Don't
  reintroduce Material's default purple or Material You wallpaper theming — the
  identity must be consistent on every device. See `ui/theme/Theme.kt`.
- **The budget chart needs the FULL transaction history**, not just the current
  month, to plot multiple months. Pass `transactions`, not
  `currentMonthTransactions`.

## Process
- **CI compiles + unit-tests only; it never runs the app.** Never claim a runtime
  feature (auth, capture, chart render, income save, theme) works from a green
  build. Ask the owner to device-test.
- **There is no premium gating right now** — it was removed as dead code
  (everyone is effectively premium). Re-adding it is a product decision, not a
  cleanup.
