# Covault

This is the single source of agent instructions for this repository. `AGENTS.md`
only points here. Keep this file to facts and rules that apply to the current
code. Put unfinished work in `docs/CODEBASE_PLAN.md` and past decisions in Git
history. Remove a rule when the code changes rather than preserving the story
behind it. Name the tool, file, value, or behavior an agent needs to act on;
omit comparisons with tools this app does not use.

## App and workflow

Covault is a household budget app. React 19, TypeScript, Vite 6, Tailwind 3,
and Capacitor 8 make the Android app. Supabase stores household data. Android
bank notifications feed the capture pipeline. Vitest runs unit and component
tests; Playwright runs browser tests.

The user does not write code. Answer in a short numbered list, with a verdict
first and one claim per number. Use plain English and explain what the change
means for the app. State what was verified and what remains unverified. Do not
show code, diffs, file contents, or commands for the user to run.

Follow the branch requested by the user. Otherwise, commit to `main` and push
to `main`. CI builds the phone APK from
`main`. A passing build or browser test does not verify Android capture, the
widget, authenticated screens, or motion on a phone.

Use `npm ci --legacy-peer-deps` for a clean install. Never commit secrets. Read
`docs/CODEBASE_PLAN.md` for pending work; its checklist is a plan, not a second
set of repository rules.

## Find the owner

| Area | Start here |
| --- | --- |
| Android notification listener and source selection | `android-custom/NotificationListener.java`, `lib/captureSources.ts`, `lib/bankingApps.ts` |
| Parse and accept a notification | `lib/deviceTransactionParser.ts`, `lib/notificationProcessor.ts` |
| Email capture | `lib/emailNotification.ts`, `lib/captureChannel.ts` |
| Merchant names and learned rules | `lib/formatVendorName.ts`, `lib/vendorRuleScope.ts`, `lib/vendorOverrideWrite.ts`, `components/transaction_parsing/useVendorOverrides.ts` |
| Skipped alerts and Review | `lib/notificationRules.ts`, `lib/queries/notificationRules.ts`, `components/TransactionParsing.tsx` |
| Recurring, duplicate, and fuel-hold decisions | `lib/projectedTransactions.ts`, `lib/recurringSchedule.ts`, `lib/duplicateCharge.ts`, `lib/fuelHold.ts`, `lib/fuelHoldReconcile.ts` |
| Budgets, categories, and totals | `lib/hooks/useDataLoading.ts`, `lib/budgetFallback.ts`, `lib/budgetAllocation.ts`, `lib/budgetOrder.ts`, `components/dashboard_components/useDashboardTotals.ts` |
| Saved settings and sharing | `lib/hooks/useUserSettings.ts`, `lib/settings/`, `lib/hooks/useHouseholdLinking.ts` |
| Subscription access | `lib/entitlement.ts`, `lib/serverClock.ts`, `components/SubscriptionRequired.tsx` |
| Dashboard month selection and chart | `components/Dashboard.tsx`, `lib/hooks/useMonthSelection.ts`, `components/dashboard_components/BudgetFlowChart.tsx` |
| Onboarding | `components/Onboarding.tsx`, `components/onboarding/`, `lib/onboardingProgress.ts` |
| Widget | `lib/widgetSnapshot.ts`, `android-custom/WidgetDeltaStore.java`, `android-custom/WidgetRenderer.java` |
| App updates and builds | `lib/appUpdate.ts`, `lib/hooks/useAppUpdate.ts`, `android-custom/CovaultUpdaterPlugin.java`, `scripts/sync-android.sh`, `.github/workflows/` |
| Shared controls, tests, and lint | `components/ui/`, `components/shared/`, `test/renderWithProviders.tsx`, `eslint.config.js` |

`android/`, `dist/`, and `node_modules/` are generated. Android source owned by
this repository lives in `android-custom/`. Migration files marked
`SUPERSEDED` are not the current schema setup path.

## Capture and money invariants

- `NotificationListener.broadcastTransaction` persists a pending capture,
  posts Covault's notification, and then dismisses the bank notification.
  Persistence uses `commit()` so dismissal waits for durable storage. The
  native pending queue is the sole pending capture queue.
- The listener's income, failed-charge, bill-notice, stop/go, and bank email
  sender lists mirror the TypeScript parser lists. Update both languages and
  their parity tests together. The listener silences only alerts the parser
  rejects. A quiet capture writes no widget delta. Bank tray suppression also
  requires permission to post Covault's own notification.
- The user's selected capture-source list takes priority after
  `monitored_apps_chosen` is set. An empty chosen list is valid. Only
  `saveMonitoredApps` marks the list as chosen. `applySourceSelection` updates
  the native and web copies together; app discovery seeds choices only before
  the user has chosen.
- Two apps reporting one tap match on amount and time in
  `lib/captureChannel.ts`. Bank-versus-email matching uses its separate
  one-to-one rule. Email captures go to Review, leave the user's mail in place,
  and write no widget delta.
- Recurring occurrences are projected for display by
  `lib/projectedTransactions.ts`. They do not create transaction rows. A real
  charge cancels at most one matching projected occurrence. A new recurrence
  label requires a database enum migration before the app queries or writes it.
- `lib/notificationProcessor.ts` keeps a soft duplicate in Review. It does not
  auto-file that capture. A processor prefix is removed only when a merchant
  name remains. Local vendor memory requires agreeing lead words before it
  adopts a remembered name or category.
- `fuzzyVendorMatch` asks whether two names identify the same merchant. Its
  callers include duplicate checks, vendor memory, and recurring lookup. Keep
  the conservative first-word, abbreviation, and one-word rules covered by
  `lib/__tests__/fuzzyVendorMatch.test.ts`.
- Learned rules match bank text through `match_key` and group by the displayed
  `proper_name`. The picker shows one choice per category. New rules do not
  teach `Other`; an existing `Other` rule yields to the merchant's one real
  category. Conflicting real categories still go to Review.
- Prefix rules cover only the curated single-category chains in
  `lib/chainVendorKeys.ts`. A prefix-rule update stays within its category.
  Display-name cleanup carries the earlier spelling as an alias so learned
  rules continue matching.
- A budget limit reduction is allowed even when the resulting total remains
  above income. A failed budgets read preserves the last displayed budgets;
  an empty successful read may seed defaults. Keep the current column-name
  fallbacks for `user_uuid`/`user_id`, `Visible`/`visible`, and
  `Budget`/`budget` until the deployed schemas are verified. A 401 does not
  trigger a column-name fallback.
- Current month and browsed month are separate in `components/Dashboard.tsx`.
  The dashboard follows the browsed month. Widget and over-budget alerts use
  the current month. Browsing resets on app pause, resume, Home, a calendar
  rollover, or a second tap on the current month. `lib/budgetOrder.ts` owns
  category order.
- New opt-in categories start hidden in an existing vault and visible in a new
  vault. Automatic category guesses use visible categories. Dining alone has
  the Leisure fallback; personal, travel, and shopping guesses can return no
  category. A user-taught rule still applies to a later-hidden category.
- `lib/refundMatching.ts` pairs a refund with at most one matching expense in
  the current 60-day window. The negative amount reduces spending while the
  paired expense remains visible with its refunded state.

## Screen and interaction invariants

- Reuse `lib/budgetColors.ts`, `getBudgetIcon`, and the shared cards and
  controls. `components/shared/cardSurface.ts` holds the common card surface.
  Keep light and dark appearances paired. Add a shared control when two real
  screens use the same behavior and appearance.
- The budget expand uses 320 ms and
  `cubic-bezier(0.32, 0.72, 0.24, 1)` for everything moving in that gesture.
  Avoid backdrop filtering, `content-visibility`, and layout-property
  transitions over its animating list. Check motion in an Android WebView
  before calling it smooth.
- The collapsed budget row shows one line above seven visible vials. Expanded
  cards keep their full content. `lib/vialDensity.ts` owns that threshold.
- Overlays inside Review's `<main>` use `components/ui/Portal.tsx` so the
  bottom navigation does not cover them. `ConfirmModal` receives initial
  focus, traps Tab, handles Escape, restores focus, and locks body scrolling.
  Match that interaction when adding another dialog or sheet.
- Onboarding saves each answer before leaving for Android settings and waits
  for loaded categories before displaying them. The setup hint is shown while
  Android settings is open. Every setup step remains skippable.
- `lib/bankHeartbeat.ts` reports silence from a bank as an inference. The app
  cannot read another app's notification settings.
- `lib/widgetSnapshot.ts` sends the current figures to the native widget. The
  listener adds month-scoped deltas while the app is closed. The widget renders
  from local state and caps its bitmap at 180,000 pixels.

## Data, tests, and boundaries

- Dashboard setting saves use `lib/settings/` for column mapping, response
  checks, write ordering, and rollback. Follow that boundary in changed
  features: components ask for an operation, and the data layer handles table
  names and response shapes. A failed read is distinct from an empty result;
  a failed write must not appear saved.
- `App.tsx` owns current budgets, transactions, and settings, with
  `lib/firstPaintCache.ts` for launch. `lib/queryClient.ts` currently caches
  Review's skipped-alert rules. Query functions throw on failed reads, and
  sign-out clears the query cache and first-paint snapshot. Evaluate any new
  query migration against stale answers, failed reads, account switching, and
  first paint.
- Partner linking and unlinking use the RPC operations in
  `lib/hooks/useHouseholdLinking.ts`. `lib/entitlement.ts` grants access to a
  tester, an active subscriber, or a trial still within its end date. It
  returns `checking` while those settings load. `App.tsx` applies that result
  to the whole app.
- Screen drafts, search text, and open sheets stay with their screen. Device
  storage owns phone-specific choices. Parse notification text, native payloads,
  stored JSON, and server responses at their entry boundary before treating
  them as typed values. Keep shared UI controls free of Supabase and native
  plugin imports; pass values and actions through props.
- Vitest tests observable behavior with fresh data for each test. Component
  tests render through `test/renderWithProviders.tsx`, which mounts the app
  query provider and clears the DOM and cache after each test. Keep a local
  controlled-state harness when the parent screen owns the state. Use user
  actions, accessible names, and an axe scan when dialog semantics change.
  Keep source checks for native/web parity and build wiring that cannot run in
  Vitest.
- Playwright uses a fresh browser context per test and blocks unexpected
  external requests. Authenticated tests use `e2e/fixtures.ts` to create and
  remove distinct users and vaults in a shared local test backend. The backend
  checks each REST request against its test token. Browser tests do not verify
  live Supabase access policies or Android behavior.
- `eslint.config.js` enforces the owned UI and feature import boundaries.
  The changed-file Stop hook also runs ESLint fixes. New dependencies need a
  current stable-version and license check plus an installation audit.

## Android and release invariants

- The sideload APK and Play AAB have different manifest permissions.
  `scripts/play-manifest.mjs` applies the Play changes only to the AAB build.
  The APK retains its update and package-discovery permissions.
- CI pins the APK signing certificate and checks the built APK with
  `apksigner`. The CI run number supplies Android `versionCode` and release tag
  `v<n>`.
- `scripts/native-hash.mjs` fingerprints native code, Capacitor config, and
  plugin versions. A web bundle applies only to a phone with the matching
  fingerprint; native changes require an APK.
- The APK downloads when an update is found and attempts installation when
  the app enters the background. Silent installation requires Android 12 or
  newer, `UPDATE_PACKAGES_WITHOUT_USER_ACTION`, and the user's install-apps
  permission. A refusal is recorded per build.
- `CovaultUpdaterPlugin.load()` checks a staged web bundle before Capacitor
  reads its stored path. A staged bundle needs two confirmed launches;
  `useAppUpdate` confirms the new bundle after launch.
- `vite.config.ts` drops the unused ONNX runtime binary while
  `lib/aiExtractor.ts` pins its CDN path. Keep these settings together.
- Trial expiry uses the database clock through `lib/serverClock.ts` and fails
  open when that clock cannot be read. Keep `tailwindcss-animate` registered in
  `tailwind.config.js` so `animate-in` classes emit CSS.

## Verification

Run `npm run verify` before committing. It checks TypeScript, unused values,
ESLint, Vitest, and the web build. Run the relevant Playwright suite for browser
changes. Check affected capture, widget, update, and motion flows on an Android
phone before claiming they work there. Report any check that was not run.
