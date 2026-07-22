# Covault

A native Android budget-tracking app for a household. Track spending across
budget categories, with automatic transaction capture from Android banking
notifications, and share a vault with a partner.

Built with **Kotlin + Jetpack Compose**, backed by **Supabase**.

## Project layout

```
android-kotlin/   The app (self-contained Gradle project) — see android-kotlin/README.md
supabase/         Database schema & migrations (PostgreSQL + RLS)
CLAUDE.md         Architecture reference for AI/contributors — start here
.github/workflows/build-kotlin.yml   CI: compile, unit tests, debug APK
```

> This repo was previously a React/TypeScript + Capacitor web app. That app was
> replaced by the native Kotlin app; its history remains in git.

## Build

Requires an Android SDK and JDK 17+.

```bash
cd android-kotlin
# create local.properties with SUPABASE_URL and SUPABASE_ANON_KEY (see below)
./gradlew :app:assembleDebug      # build the debug APK
./gradlew :app:testDebugUnitTest  # run unit tests
```

`local.properties` (gitignored):

```
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your_anon_key
```

CI (`.github/workflows/build-kotlin.yml`) injects these from repo secrets, with
dummy fallbacks so the build compiles without them.

## Stack

Kotlin 2.1 · Jetpack Compose (Material 3) · Hilt · supabase-kt over Ktor ·
`minSdk 26` / `targetSdk 35`. See [CLAUDE.md](CLAUDE.md) for the full
architecture, data model, and conventions.
