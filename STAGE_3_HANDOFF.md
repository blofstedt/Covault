# Stage 3 Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 2 (data layer)
**Risk to existing React app:** zero.

## What landed

The first end-to-end Compose flow: splash → auth → onboarding → dashboard
skeleton. The app now actually logs in with Google and persists the
session, mirroring the React `useAuthState` semantics.

### New files

| File | Purpose |
|---|---|
| `data/repository/AuthRepository.kt` | Wraps supabase-kt auth: `signInWithGoogle`, `signOut`, observes `sessionStatus` flow and translates to a 4-state `AuthState` sealed interface |
| `ui/MainViewModel.kt` | Exposes the auth state to the nav graph |
| `ui/CovaultNavHost.kt` | Single NavHost with 4 routes (Splash, Auth, Onboarding, Dashboard) — switches routes when the auth state changes |
| `ui/splash/SplashScreen.kt` | One-frame flash before the auth state resolves |
| `ui/auth/AuthViewModel.kt` | Owns the auth screen's state: `isLoggingIn`, `authError` |
| `ui/auth/AuthScreen.kt` | Compose port of `components/Auth.tsx`: brand mark, "Connect with Google" button, loading state, error banner, legal links |
| `ui/components/CovaultLogoMark.kt` | Procedural vault logo (Canvas drawing) — no raster asset needed |
| `ui/onboarding/OnboardingViewModel.kt` | Step state machine: INTRO_1 → INTRO_2 → CHOOSE_MODE → PARTNER_EMAIL → done |
| `ui/onboarding/OnboardingScreen.kt` | Compose port of `components/Onboarding.tsx`: two intro steps, solo/couples choice, partner email step |
| `ui/dashboard/DashboardViewModel.kt` | Skeleton: surfaces the authenticated user |
| `ui/dashboard/DashboardScreen.kt` | Skeleton: welcome message + "Stage 4 will render the real dashboard here" |
| `MainActivity.kt` (rewritten) | Hosts the NavHost and forwards OAuth deep links to `supabase.handleDeeplinks(intent)` |

### Modified files

| File | Change |
|---|---|
| `data/remote/SupabaseClientProvider.kt` | Added `host = "auth"`, `scheme = "com.covault.app"`, and `defaultExternalAuthAction = CustomTabs()` to the Auth install block. supabase-kt 3.x requires these for the deep link to work. |
| `AndroidManifest.xml` | Deep link path changed from `com.covault.app://oauth-callback` → `com.covault.app://auth/callback` to match what the React app already uses (`components/Auth.tsx:26`) so the Supabase dashboard's redirect URL whitelist doesn't have to change. |
| `data/repository/SessionStore.kt` | Initial state is now `SessionStatus.LoadingFromStorage` (the real supabase-kt enum value) instead of a non-existent `SessionStatus.Loading`. |
| `gradle/libs.versions.toml` + `app/build.gradle.kts` | Added `androidx.lifecycle.runtime-compose` for `collectAsStateWithLifecycle`. |
| `ui/MainViewModel.kt` (new) | New file. |

## Key design decisions

**1. `AuthState` is a 4-way sealed interface, not a 4-value enum.**
The React app's `AuthStatus` is a string union, but in Kotlin the
sealed interface lets us carry the authenticated `User` along with
the `Authenticated` state without boxing. Matches what
`lib/hooks/useAuthState.ts` does in spirit: the AuthState is always
one of exactly four things, but only `Authenticated` has payload.

**2. The 14-day expiry check is enforced in `AuthRepository`, not
`SessionStore`.** The data store stays a pure key-value store; the
business rule lives in the repository that uses it. This matches the
React separation between `localStorage` (data) and `useAuthState`
(behavior).

**3. The onboarding `complete()` flow doesn't yet write to Supabase.**
Stage 4 adds the real `SettingsRepository.upsertOnboarding(...)`
call. For Stage 3 it just flips a `hasCompleted` flag the screen
observes to navigate forward. The handoff doc for Stage 4 will
revisit this — the React app's `onComplete` callback in
`App.tsx` writes to the settings table via the `upsertSettings`
function in `lib/hooks/useUserSettings.ts`.

**4. `signInWith(Google)` doesn't need a `redirectUrl` argument.**
supabase-kt 3.x builds the redirect URL from the `host` + `scheme`
configured in the Auth install block, which matches the manifest's
`com.covault.app://auth/callback`. This is the same URL the React
app's `components/Auth.tsx:26` hardcodes — they agree on purpose.

**5. `MainActivity.handleAuthDeepLink` calls
`supabase.handleDeeplinks(intent)`.** This is the supabase-kt
3.x-prescribed way to consume the OAuth callback. The function parses
the deep link, exchanges the auth code for a session, and updates the
`sessionStatus` flow. Our `SessionStore` mirrors that flow, and
`AuthRepository` translates it into `AuthState`. So a successful
deep link → session status flips to `Authenticated` → nav graph
auto-navigates to the dashboard skeleton.

**6. `MainActivity` uses `launchMode="singleTask"`.** When the user
comes back from the Google OAuth Custom Tab, the same activity
instance receives the deep link via `onNewIntent` rather than
re-creating. The `handleAuthDeepLink` is called from both `onCreate`
(cold start after OAuth) and `onNewIntent` (warm start).

**7. Procedural logo (`CovaultLogoMark`).** Stage 1 shipped a generic
vault glyph as a static vector drawable. Stage 3 replaces it with a
Compose `Canvas` so the same component can be reused at any size
(auth screen uses 120dp, dashboard uses 48dp). Stage 4 can replace
this with a true brand asset SVG when the design team finalizes the
mark; the call sites don't need to change.

## What you need to do (1 minute)

In the Supabase dashboard, ensure `com.covault.app://auth/callback`
is in the redirect URL whitelist. This URL matches what the React
app already uses, so if you have a working build today, this is
already configured — no action needed.

If you DO need to add it: `https://supabase.com/dashboard/project/xqleyxrftyehodksashu/auth/url-configuration`
→ Redirect URLs → add `com.covault.app://auth/callback` → Save.

## What you can verify locally

```bash
cd android-kotlin
./gradlew :app:testDebugUnitTest
# All Stage 2 tests still pass (40 cases)
./gradlew :app:assembleDebug
./gradlew installDebug    # or run from Studio
# Open the app:
#  - Brief splash
#  - Auth screen with "Connect with Google"
#  - After sign-in: onboarding flow (intro1 → intro2 → choose mode → optional partner email)
#  - On completion: dashboard skeleton with the user's name + email
```

If Google sign-in fails:
- Check the deep link is whitelisted in the Supabase dashboard (above)
- Check `local.properties` has the anon key
- Check logcat for the `Auth` tag and the `signInWith` exception

## Known limitations / explicit stubs

- **No real persistence of onboarding choice yet.** Stage 4 adds the
  `SettingsRepository.upsertOnboarding(...)` write.
- **No "this is a returning user" detection.** Anyone with a valid
  session goes straight to the dashboard skeleton. Stage 4 checks
  the `settings` row; if it's missing or `monthly_income IS NULL`,
  the user is routed to ONBOARDING instead.
- **The AuthScreen's loading state shows for a fixed visual duration
  while the Custom Tab is open.** There's no signal that the deep
  link has fired yet — Stage 4 will listen for `SessionStatus`
  transitions to flip the loading state off.
- **No password / magic link / email sign-in yet.** Only Google.
  Trivial to add in Stage 4 if you want it; the React app only
  uses Google anyway.
- **`OnboardingScreen` doesn't visually match the React app's
  animations yet.** Crossfades only; Stage 4 adds the per-step
  slide-in keyframes.
- **CovaultLogoMark is a placeholder.** The real Covault mark from
  the React app's `components/CovaultIcon.tsx` will be imported as
  an SVG in Stage 4.

## Stage 4 preview

- Real Dashboard: transaction list, budget bars, KIA projection,
  monthly pulse card. Port of `components/Dashboard.tsx` (522 LOC) +
  all the `components/dashboard_components/*.tsx` (2.4k LOC total).
- `SettingsRepository` for the onboarding write + the rest of the
  settings screen
- `UserDataRepository` for the user/settings/transactions loads
- Returning-user detection in `AuthRepository` (settings row
  existence check)
- `DashboardSkeleton` → real `DashboardScreen`
- Port the auth screen's full visual design (animated background,
  exact Google logo colors, the `animate-nest` keyframe)

Stage 4 is the largest single stage. Budget: it'll take multiple
iterations even with focused work. The handoff doc will be longer.
