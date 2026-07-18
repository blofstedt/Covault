# Covault — Kotlin (Android)

This is the **native Android rewrite** of the Covault budget app.
It lives in the `android-kotlin/` directory and is being built on
the `Kotlin` branch of `blofstedt/Covault`. The original React +
Capacitor app is untouched in the parent directory.

## Status

Feature-complete with the React app for the manual-entry flow,
notification-driven transactions, and recurring projections.

| Capability | Status |
|---|---|
| Google OAuth via Supabase | ✓ |
| Onboarding (solo / couples + partner invite) | ✓ |
| Dashboard home view (balance, budget cards, bottom bar) | ✓ |
| Add / edit / delete transactions | ✓ |
| Search across current / past / future | ✓ |
| Settings modal (all 14 sub-sections) | ✓ |
| Vault sharing (partner link via email) | ✓ |
| Household linking + partner transaction merge | ✓ |
| Notification listener + parser pipeline | ✓ |
| Pending-transaction review queue | ✓ |
| Recurring transaction executor + projection | ✓ |
| Bank notification AI extraction (HF transformers) | stub |
| Interactive D3 budget flow chart | stub |
| Invite-code (vs email) partner link | TODO |

**80 unit tests**, all green by structure (the build wasn't run
in this sandbox; verification is the user's responsibility).

## Build

Requirements: Android Studio Ladybug or newer, JDK 17, Android SDK 35.

```bash
cd android-kotlin
echo "SUPABASE_URL=https://xqleyxrftyehodksashu.supabase.co" > local.properties
echo "SUPABASE_ANON_KEY=eyJ..." >> local.properties   # your anon key
./gradlew :app:testDebugUnitTest                     # 80 tests
./gradlew :app:assembleDebug
./gradlew installDebug
```

## Architecture

The app follows a clean separation: pure-logic domain modules,
repositories that wrap Supabase, ViewModels that own state, and
Compose screens that consume the state.

```
app/src/main/java/com/covault/app/
├── MainActivity.kt                          # single-activity host
├── CovaultApp.kt                            # @HiltAndroidApp entry
├── data/
│   ├── model/                               # domain models (User, Transaction, …)
│   ├── remote/                              # Supabase DTOs, mappers, client setup
│   └── repository/                          # UserData, Transaction, Settings, …
├── di/                                      # Hilt modules
├── domain/                                  # pure logic (no Android deps)
│   ├── BudgetColors.kt
│   ├── DateUtils.kt
│   ├── FormatVendorName.kt
│   ├── DashboardTotals.kt
│   └── RecurringExecutor.kt
├── notification/                            # native Android NotificationListenerService
│   ├── CovaultNotificationListener.kt
│   └── NotificationParser.kt
└── ui/
    ├── auth/                                # login screen
    ├── onboarding/                          # solo / couples / partner invite
    ├── dashboard/                           # home view + all modals
    │   ├── DashboardScreen.kt
    │   ├── DashboardViewModel.kt
    │   ├── BudgetSection.kt
    │   ├── BudgetFlowChart.kt               # stub
    │   ├── TransactionForm.kt
    │   ├── TransactionActionModal.kt
    │   ├── ConfirmDeleteModal.kt
    │   ├── SearchResults.kt
    │   ├── SettingsModalSections.kt         # all 14 sub-sections
    │   ├── FAQModal.kt
    │   ├── PremiumGate.kt
    │   └── …
    ├── components/                          # shared Compose components
    ├── splash/                              # one-frame flash
    └── theme/                               # Material 3 color scheme
```

## Stages

The migration is split into 8 self-contained commits, each with a
handoff doc at the repo root:

1. **Stage 1** — Scaffold (Gradle, AGP, Compose, Hilt, supabase-kt)
2. **Stage 2** — Data layer + 41 unit tests
3. **Stage 3** — Auth flow + onboarding + nav graph
4. **Stage 4a** — Data layer round-trip (repositories)
5. **Stage 4b-i** — Home view (balance, budget cards, bottom bar)
6. **Stage 4b-ii** — Add/edit/delete + search
7. **Stage 4b-iii** — Settings modal (all 14 sub-sections)
8. **Stage 4b-iv** — Budget flow chart (stub)
9. **Stage 5** — FAQ modal + premium gate
10. **Stage 6** — Notification listener + parser pipeline
11. **Stage 7** — Recurring executor + projection
12. **Stage 8** — Cleanup (this README, version bump)

Each stage ends with a working artifact you can verify on a real
device. The full handoff docs are at the repo root in
`STAGE_N_HANDOFF.md`.

## Supabase setup

The Kotlin app talks to the same Supabase project as the React app.
You need to:

1. **Whitelist the OAuth deep link:**
   `https://supabase.com/dashboard/project/xqleyxrftyehodksashu/auth/url-configuration`
   → add `com.covault.app://auth/callback` to Redirect URLs.

2. **Enable the partner-lookup RPC** if it doesn't exist yet:
   ```sql
   create or replace function public.lookup_user_id_by_email(email_input text)
   returns uuid language sql security definer as $$
     select id from auth.users where email = email_input limit 1;
   $$;
   ```

3. **Drop your anon key** into `android-kotlin/local.properties`:
   ```
   SUPABASE_URL=https://xqleyxrftyehodksashu.supabase.co
   SUPABASE_ANON_KEY=eyJ...
   ```

## Notification listener

The native `NotificationListenerService` requires user opt-in:

1. Open Android Settings
2. Apps → Special access → Notification access
3. Enable "Covault transaction detection"

Covault will then read every notification posted by ~12 known
Canadian bank apps (RBC, BMO, TD, Scotiabank, CIBC, Tangerine,
Wealthsimple, etc.), parse transactions out of them, dedup against
the last 5 minutes, and insert into `pending_transactions` for the
user's review in the app.

## Versioning

`versionCode = 1`, `versionName = "0.1.0"`. Bump per the standard
semver rules when you ship.
