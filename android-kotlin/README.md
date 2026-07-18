# Covault — Kotlin (Stage 1)

This is the **native Android rewrite** of the Covault budget app. It lives
in `android-kotlin/` and is being built on the `Kotlin` branch. The original
React + Capacitor app is untouched in `../components/`, `../lib/`, etc.

## Stage 1 status

Scaffold only. What's in this commit:

- Gradle 8.10.2 + AGP 8.7.3 + Kotlin 2.1.0
- Jetpack Compose (BOM 2024.12.01) with Material 3
- Hilt 2.52 for DI
- supabase-kt 3.1.1 (core, auth, postgrest, realtime, storage)
- AndroidX Biometric, Play Services Auth, DataStore Preferences
- Compose Navigation, Coil, kotlinx.serialization
- Single-Activity host (`MainActivity`) with Hilt-generated graph
- Adaptive launcher icon + Material 3 theme with dynamic color (Android 12+)
- Deep link `com.covault.app://oauth-callback` registered for Supabase Auth
- JVM unit test (`Stage1SmokeTest`) + instrumented test scaffold
- ProGuard rules for Supabase, kotlinx.serialization, OkHttp

## Build locally

Requirements: Android Studio Ladybug or newer, JDK 17, Android SDK 35.

```bash
cd android-kotlin
echo "SUPABASE_URL=https://xqleyxrftyehodksashu.supabase.co" > local.properties
echo "SUPABASE_ANON_KEY=your_anon_key_here" >> local.properties
./gradlew assembleDebug
./gradlew test
```

If you don't have a `gradlew` script yet, run `gradle wrapper` once
(studio does this automatically on first sync).

## What's next

**Stage 2** — Types + data layer: port `types.ts` to Kotlin, set up the
Supabase client, port the pure-logic modules (`budgetColors`,
`formatVendorName`, `dateUtils`).
