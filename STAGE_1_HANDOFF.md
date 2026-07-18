# Stage 1 Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Base:** `main` @ `b88f51e` (latest commit before branch cut)
**Stage 1 commit:** pending — see `git log Kotlin` after push

## What landed

A buildable Android project scaffold at `android-kotlin/`. The existing
React + Capacitor app is untouched.

| Concern | Choice | Why |
|---|---|---|
| UI | Jetpack Compose + Material 3 | Modern, less boilerplate, matches the React component model |
| DI | Hilt | First-class ViewModel + Compose support |
| Min SDK | 26 (Android 8.0) | Covers ~95% of devices, unlocks Adaptive icons and BiometricPrompt |
| Target SDK | 35 | Required for Play Store submissions in 2025+ |
| JDK | 17 | Required by AGP 8.7+ |
| Backend | supabase-kt 3.1.1 (auth, postgrest, realtime, storage) | Direct port path for the React app's Supabase usage |
| Auth flow | Supabase OAuth via Custom Tab + `com.covault.app://oauth-callback` deep link | Reuses existing Supabase Google client, no new GCP project needed |
| Secrets | `local.properties` → `BuildConfig` fields, `.gitignore`d | Keeps anon key out of the repo |

## File map

```
android-kotlin/
├── build.gradle.kts                # root
├── settings.gradle.kts             # module includes, repo config
├── gradle.properties               # JVM args, AndroidX flags
├── gradle/
│   ├── libs.versions.toml          # single source of truth for versions
│   └── wrapper/gradle-wrapper.properties
├── app/
│   ├── build.gradle.kts            # module config, BuildConfig fields
│   ├── proguard-rules.pro
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml # deep link, permissions, app entry
│       │   ├── java/com/covault/app/
│       │   │   ├── CovaultApp.kt   # @HiltAndroidApp
│       │   │   ├── MainActivity.kt # @AndroidEntryPoint host
│       │   │   └── ui/theme/Theme.kt
│       │   └── res/                # strings, theme, icons, backup rules
│       ├── test/java/.../Stage1SmokeTest.kt
│       └── androidTest/java/.../ExampleInstrumentedTest.kt
├── .gitignore
└── README.md                       # build instructions
```

## What I could not verify in this sandbox

This cloud environment has **no JDK, no Android SDK, no Gradle**. So I
authored the project but did not run `./gradlew assembleDebug`. To
verify, do this on your machine (or in CI):

```bash
cd android-kotlin
echo "SUPABASE_URL=https://xqleyxrftyehodksashu.supabase.co" > local.properties
echo "SUPABASE_ANON_KEY=eyJ..." >> local.properties   # your anon key
./gradlew assembleDebug
./gradlew test
```

Studio will auto-generate `gradlew`/`gradlew.bat` on first sync.

## What you need to do (one-time, ~2 minutes)

1. **Whitelist the redirect URL in Supabase:**
   `https://supabase.com/dashboard/project/xqleyxrftyehodksashu/auth/url-configuration`
   → add `com.covault.app://oauth-callback` to "Redirect URLs".
2. **Drop your anon key** into `android-kotlin/local.properties` (see
   `local.properties.example` in the README).

That's the entire Stage 3 prep. No Google Cloud console work, no new
client ID, no Play Store changes.

## Known stubs / placeholders

- Launcher icon is a generic vault glyph vector. Stage 4 swaps in the
  real `icons/` assets from the React app.
- Theme palette is Material 3 defaults. Stage 4 maps the Tailwind config
  to Compose `ColorScheme` + custom typography.
- `MainActivity` renders a centered "Covault — Stage 1" placeholder.
  Stage 3 wires the auth flow into this activity.

## Risk to existing React app

**Zero.** `android-kotlin/` is a brand-new directory. No file in
`components/`, `lib/`, `supabase/`, or anywhere else in the React app
has been modified. The Capacitor build pipeline (`cap:sync`,
`cap:build`) keeps working.

## Stage 2 preview

Next: port `types.ts` to Kotlin data classes, set up the supabase-kt
client as a Hilt singleton, port the pure-logic modules in `lib/`
(`budgetColors`, `formatVendorName`, `dateUtils`, `transactionMappers`)
with JVM unit tests ported from the vitest files.

The shape will be:

```
app/src/main/java/com/covault/app/
├── data/
│   ├── model/         # data classes ported from types.ts
│   ├── remote/        # Supabase client + DAO classes
│   └── repository/    # AuthRepository, TransactionRepository, ...
└── domain/            # pure logic (mappers, budget math, date utils)
```
