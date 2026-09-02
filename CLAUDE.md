# Covault — AI index

**Read this before opening any other file.** It exists so you can go straight to
the two or three files a request actually touches instead of reading the repo.

The person you are working for does not write code and will not review a diff
line by line. Assume every change is yours to get right, and that "it compiles"
is not evidence it works.

## How to answer them

This is not a style preference. They cannot check your work by reading the
code, so the reply *is* the deliverable — if it is unreadable to them, the work
is unreviewable.

- **Plain English only.** No code in the answer, no diffs, no file contents, no
  snippets to run. Naming a file so they know where something lives is fine;
  showing them its contents is not.
- **Numbered, concise.** Any feedback on a change, a plan, a review, or another
  tool's suggestion comes back as a short numbered list — one claim per number,
  verdict first. Not paragraphs, not a narrated walk through the reasoning.
- **Explain in consequences, not mechanics.** "New purchases would stop being
  captured" — not "the listener's `commit()` returns before the insert
  resolves". If a mechanism has to be mentioned, one clause, then back to what
  it means for them.
- **Say plainly what you did not verify.** They cannot infer it. CI does not run
  this app: compile-green proves nothing about capture, the widget, or anything
  visual. Say so rather than letting a green build imply it works.
- **Answer the question that was asked**, then stop. If they ask whether
  something is right, the first thing they should read is whether it is right.

## Where work goes: main

**Commit to `main` and push to `main`.** Do not create a feature branch, and do
not open a pull request, unless they ask for one in that request. They do not
want to manage branches, and a PR only adds a review step that nobody performs
— they cannot read the diff, which is the whole point of the section above.

If the harness you are running under forces you onto a branch, finish the work
there, then fast-forward `main` to it and push, and say in your reply that you
did. Do not leave the work parked on a branch and call it delivered.

`main` is what CI builds the APK from, so it is also the phone build. That
makes `npm run verify` before pushing non-negotiable, not a nicety: breaking
`main` means no APK to install. It still does not mean the app works — see the
Verification reality section.

## What they care about: how it looks and how it moves

They judge this app on whether it is beautiful to use. Not as a finishing
touch — as the point. A correct feature that looks wrong, breaks the visual
language, or stutters on the phone is not finished, and saying "it works" about
it will not land.

- **Consistency over invention.** The app already has a design language: one
  category palette (`lib/budgetColors.ts`, reused by bars, icons and the
  chart), `rounded-[2rem]` cards, tight tracking on big numerals, muted glassy
  surfaces. Reuse the existing pieces — `components/ui/`, `components/shared/`,
  `getBudgetIcon` — before adding a new visual idea. A new control that looks
  like it came from a different app is a regression even if it works.
- **One clock per interaction.** Everything moving as part of the same gesture
  shares 320ms and `cubic-bezier(0.32, 0.72, 0.24, 1)` — the budget expand, the
  card, the chart. Mixed durations inside one interaction were what previously
  read as "not smooth"; the fix was putting them on the same clock, not making
  them faster.
- **Smooth on their phone, not on your laptop.** Motion has to hold up in an
  Android WebView at 120Hz, roughly an 8ms frame budget. That is where the
  Invariants below come from — `backdrop-filter` over the animating list,
  `content-visibility`, layout-property transitions. Those rules exist to
  protect the feel, so treat them as design rules, not micro-optimisations.
- **Never trade the look for an easier implementation** without saying so. If
  the simple approach is uglier, say that plainly, in English, and describe the
  alternative and what it costs. Let them choose.
- **Be honest about what you have not seen.** Nothing in CI renders this app.
  If you changed something visual or animated, say it is unverified rather than
  letting a green build imply it looks right.

## What it is

Personal budget app for a household. Users track spending by category;
transactions are captured automatically from Android banking notifications. Two
people can share a vault.

React 19 + TypeScript + Vite 6 + Tailwind 3, wrapped in Capacitor 8 for Android.
Supabase (Postgres + RLS) for data. On-device flan-T5 via
`@huggingface/transformers` for parsing. Vitest for tests.

```bash
npm run verify     # typecheck + typecheck:unused + test + build  ← run before committing
npm run dev        # localhost:3000
npm run cap:build  # web build + cap sync + scripts/sync-android.sh
```

## Where to look, by what the user says

Requests arrive in plain language. Start here, not with a repo-wide search.

| The user says | Open, in this order |
|---|---|
| "a purchase wasn't captured" | `lib/deviceTransactionParser.ts` (regex) → `lib/notificationProcessor.ts` (pipeline) |
| "something that isn't my bank got captured" | `android-custom/NotificationListener.java` (forwarding) → `lib/bankingApps.ts` (`isBankingApp`, the JS backstop) |
| "my bank stopped being captured" | `lib/bankingApps.ts` — `suggestUnknownBankApps`, surfaced in `components/NotificationSettings.tsx` |
| "the gas amount is wrong" / "it says placeholder" | `lib/fuelHold.ts` — hold detection, applied at step 6 of the processor and re-derived per row in `AIEnteredRow` |
| "I have two rows for one tank of gas" | `lib/fuelHoldReconcile.ts` — pairs a settled charge with the hold it replaces |
| "I got a duplicate" | `lib/notificationProcessor.ts` — dedup is steps 1, 2, 5 and the post-insert race recovery |
| "recurring charges are duplicating / I keep deleting them" | `lib/projectedTransactions.ts` — recurring is display-only. Nothing writes recurring rows. See Invariants |
| "a deposit / my pay showed up as spending" | `INCOME_PHRASES` in `lib/deviceTransactionParser.ts`, mirrored into `android-custom/NotificationListener.java` — the native listener has to know income on sight, or it announces the deposit and adds it to the widget hours before the parser rejects it |
| "something that isn't spending got captured" (a deposit, a declined card, a statement reminder, a balance alert) | the four mirrored lists at the top of `lib/deviceTransactionParser.ts` — `INCOME_PHRASES`, `FAILED_CHARGE_PHRASES`, `BILL_NOTICE_PHRASES`, and `STOP_PHRASES` vs `GO_PHRASES` — each copied into `android-custom/NotificationListener.java`, because the listener has to reach the same verdict on sight or it announces the capture and adds it to the widget hours before the parser rejects it |
| "my bank only emails me, nothing gets captured" | `lib/emailNotification.ts` — the sender has to be a bank before the body is read at all. A bank whose sender name is not in `EMAIL_BANK_SENDERS` is silently never captured; adding it there (and to the mirrored Java list) is the fix |
| "an email that wasn't a purchase got captured" | `lib/emailNotification.ts` — the sender gate, then the four existing phrase lists in `deviceTransactionParser.ts`, which email inherits unchanged |
| "I turned a bank off and it kept capturing" | `lib/captureSources.ts` (the user's list, and the three-state "never chosen" flag) → `isMonitoredApp` in `android-custom/NotificationListener.java` → `autoDetectBankingApps` in `CovaultNotificationPlugin.java`, which must only ever SEED |
| "nothing is captured at all any more" | `lib/captureSources.ts` first — `isCaptureSourceAllowed` returning false for everything is the one silent, total failure this app has. Check `monitored_apps_chosen` before anything else |
| "I got two rows for one tap-to-pay purchase" | `lib/captureChannel.ts` (`isOtherAppSameTap`) → step 4d of `lib/notificationProcessor.ts`. Matched on amount and timing, never on the merchant name |
| "a subscription got captured / notified about anyway" | `lib/recurringSchedule.ts` — matches the capture against the recurring *schedule*, not just nearby rows; applied at step 5b. The notification is suppressed in `NotificationListener.java` (`RECURRING_CHARGES_KEY`) and withdrawn by `useNotificationListener.ts` when it slipped through |
| "the budget pills keep rearranging" | `lib/budgetOrder.ts` — the `budgets` table has no sort column, so the order is fixed in code. See Invariants |
| "my budget limits / hidden categories are back to the defaults" | `loadUserBudgets` in `lib/hooks/useDataLoading.ts` → `lib/budgetFallback.ts`. Check the Supabase edge logs for a non-200 on `/rest/v1/budgets` before assuming the data is gone — it usually isn't |
| "it picked the wrong category" | `lib/hooks/useVendorMatcher.ts`, `lib/vendorMatchConfidence.ts`, step 5a of the processor |
| "a new restaurant landed in Other" | `lib/merchantCategorySignals.ts` — the offline descriptor/POS-prefix guess, applied in step 5c |
| "the review list / badge is wrong" | `lib/reviewQueue.ts` — the single definition of "waiting"; the list, badge and widget all read it |
| "the widget is stale or wrong" | `lib/widgetSnapshot.ts` → `android-custom/WidgetDeltaStore.java` → `android-custom/WidgetRenderer.java` |
| "the 'add widget' button in settings doesn't work" | `android-custom/CovaultWidgetPlugin.java` (`isSupported` / `requestPinAppWidget`) → `components/dashboard_components/settings_modal_components/HomeScreenWidgetSection.tsx` — the button is one of two routes and only ever shown once `isSupported` says the launcher can honour it; the other route is the written steps, unconditional and always correct |
| "notifications look wrong / didn't arrive" | `lib/appNotifications.ts` (JS-posted) and `android-custom/NotificationListener.java` (native, fires with app closed) |
| "bank alerts aren't being hidden any more" | `canPostCaptureNotifications` in `android-custom/NotificationListener.java` **first** — suppression needs Covault's own notification to post, and `POST_NOTIFICATIONS` is a separate permission a reinstall resets. Only then the gates in `maybeHideBankNotification` |
| "tapping a notification goes to the wrong place" | `lib/hooks/useNotificationRoute.ts`, `android-custom/MainActivity.java` |
| "partner sharing / linking is broken" | `lib/hooks/useHouseholdLinking.ts` + the RPCs in `supabase/migrations/2026_08_01_sync_schema_to_app.sql` |
| "it won't let me lower a budget" / "it says I'm over my income" | `lib/budgetAllocation.ts` — the rule is direction, not the line; see the invariant below |
| "nothing is being captured from one of my banks" | the amber card in `NotificationSettingsSection.tsx`, fed by `lib/bankHeartbeat.ts`. The app cannot read another app's notification settings — this is an inference from silence |
| "a setting doesn't stick" | `SETTING_DB_KEYS` in `components/Dashboard.tsx` → `lib/hooks/useUserSettings.ts` → `lib/hooks/useDataLoading.ts`. **Usually a missing DB column** — see Invariants |
| "an edit didn't save" | `lib/hooks/useTransactionOps.ts`. If it's a **vendor rename**, also `lib/formatVendorName.ts` — it has previously overwritten the user's own capitalisation |
| "the numbers are wrong" | `components/dashboard_components/useDashboardTotals.ts`, `lib/refundMatching.ts`, `lib/projectedTransactions.ts` |
| "last month's entries are still listed" / "the list is in the wrong order" | `lib/transactionOrdering.ts` (one month, chronological) → `lib/hooks/useCurrentDay.ts` (the single clock) → `components/Dashboard.tsx` |
| "a modal/sheet looks broken or is cut off" | `components/ui/Portal.tsx` — overlays inside `<main>` need it; see Invariants |
| "the animation is janky" | `index.css`, `components/BudgetSection.tsx`, `components/dashboard_components/BudgetFlowChart.tsx` |
| "the intro didn't set anything up" / "I got dropped on an empty dashboard" | `components/Onboarding.tsx` (the step router) → `components/onboarding/` (one file per setup step) → `lib/onboardingProgress.ts` (where it resumes from) |
| "the app didn't offer me the update" / "it didn't update itself" | `lib/appUpdate.ts` (the check) → `lib/hooks/useAppUpdate.ts` (when, and which of the two routes) → `android-custom/CovaultUpdaterPlugin.java` (install, or unpack) |
| "it still asked me to confirm the update" | the three conditions in the APK-route invariant below — `UPDATE_PACKAGES_WITHOUT_USER_ACTION` in `android-custom/AndroidManifest.xml`, Android 12+, and the install permission. A refusal is recorded per build in `CovaultUpdaterPlugin` and reported by `getStatus` as `quietInstallSupported` |
| anything about the Android build | `scripts/sync-android.sh`, `.github/workflows/build-android.yml` |

Deeper detail on any of these: `docs/ARCHITECTURE.md`. Human setup: `README.md`.

## Invariants — look like bugs, are not

Do not "clean these up". Each one was a real failure that cost real debugging.

- **`NotificationListener.broadcastTransaction` runs persist → notify →
  dismiss.** Tray suppression may only delete a bank's notification *after* the
  capture is durably on disk and Covault has posted its own. Reordering silently
  destroys purchases.
- **The pending queue uses `commit()`, not `apply()`.** The return value has to
  mean "on disk", because suppression acts on it.
- **`useDataLoading.ts` requests late-added settings columns in a separate
  select with a fallback.** PostgREST 400s the *whole* select on one unknown
  column, and that function returns early on a non-ok response — naming them
  unconditionally takes theme, income and trial fields down with them.
- **Column-name fallbacks are load-bearing**: `user_uuid`/`user_id`,
  `Visible`/`visible`, `Budget`/`budget`, `recur`/`recurrence`.
- **`pending_transactions` does not exist in the DB.** Reads treat a 404 as an
  empty queue. Writes to it fail and are swallowed. Not a bug to fix casually.
- **`tailwindcss-animate` must stay in `tailwind.config.js` plugins.** ~40 uses
  of `animate-in` / `zoom-in-*` / `slide-in-*` emit *no CSS at all* without it,
  silently. `lib/__tests__/tailwindAnimatePlugin.test.ts` guards this.
- **Vendor matching exists in three places on purpose** — the TS pipeline, the
  TS widget snapshot, and `WidgetDeltaStore.java`. The Java copy is deliberately
  dumber. `widgetPalette.test.ts` and `widgetAutoFileThreshold.test.ts` fail the
  build if the constants drift.
- **Overlays rendered inside the Review page's `<main>` need `Portal`.** `<main>`
  is `relative z-10`, which caps everything inside it below the `z-40` nav bar
  no matter how large its own z-index is.
- **The APK signing key is pinned, and the pinning is verified.** CI writes an
  explicit `signingConfigs.debug` into `android/app/build.gradle` naming
  `android-custom/covault-debug.keystore`, then checks the built APK's
  certificate with `apksigner` and fails if it doesn't match. Both halves are
  load-bearing. Without a pinned key Gradle mints a fresh one per run and
  Android refuses to install the update, so the only way forward is
  uninstalling — which erases the app's local data. And without the check the
  pinning can fail silently: the first attempt dropped the keystore at
  `~/.android/debug.keystore` and Gradle ignored it, which shipped three
  uninstallable releases with a green build each time. Do not "simplify" this
  back to copying a file into place. Changing the key forces one more uninstall
  on every phone.
- **The CI run number is the versionCode *and* the release tag `v<n>`.** That
  shared integer is the entire update check. Break either half and the app
  never offers an update again, in silence. `appUpdate.test.ts` reads the
  workflow to catch it.
- **A web-only change updates itself; anything native needs the APK.** Which
  route a release takes is decided by `scripts/native-hash.mjs` — a fingerprint
  of `android-custom/`, `capacitor.config.ts` and the Capacitor plugin
  versions, baked into the APK and used to name the published web bundle. A
  phone applies only a bundle carrying its own fingerprint, so touching any
  native file automatically forces a full install instead. Do not "simplify"
  that by dropping the fingerprint: the failure it prevents is web code calling
  into native code that isn't there. `webBundleWiring.test.ts` holds the five
  links together.

- **The APK route arrives on its own too, but only Android decides whether it
  is silent.** The download no longer waits for a tap — it happens when the
  update is found, hidden from the notification shade — and the install is
  attempted as the app goes to the *background*, because a self-update kills
  the process and doing that in the foreground closes the app in the user's
  hands. Three things have to hold for the confirmation to be skipped, and
  losing any one of them fails silently back to the pill: the
  `UPDATE_PACKAGES_WITHOUT_USER_ACTION` permission in the manifest (a normal
  permission, and without it `USER_ACTION_NOT_REQUIRED` is ignored with no
  error), Android 12 or newer, and the user's own "allow Covault to install
  apps". A refusal comes back asynchronously as `STATUS_PENDING_USER_ACTION`,
  where the session is abandoned — an app has a session limit, and one refused
  every launch would eventually break its own quiet route — and recorded
  against the running versionCode so it is attempted once per build rather than
  once per launch. Never start the confirmation activity from that callback: it
  arrives while the app is in the background, where Android blocks activity
  starts and the user is in some other app. `apkArrivesByItself.test.ts` pins
  the shape.
- **`CovaultUpdaterPlugin.load()` runs before Capacitor reads the stored
  server path.** That ordering *is* the rollback: a staged web bundle that
  hasn't confirmed two launches gets thrown away before the WebView is pointed
  at it. `useAppUpdate` calling `confirmWebBundle()` a few seconds after mount
  is the other half — remove it and every update silently reverts.
- **The 21MB ONNX runtime is dropped from the build on purpose.**
  `vite.config.ts` deletes it because `lib/aiExtractor.ts` pins the runtime to
  a CDN, which makes the bundled copy unreachable. The two only work as a pair;
  `aiRuntimeSource.test.ts` fails the build if one goes without the other. The
  model weights come from huggingface.co regardless, so the AI fallback has
  never worked offline.
- **A settings toggle that "works" may not be saving.** The UI applies changes
  optimistically and `saveSettingToDb` only logs failures, so a missing column
  is indistinguishable from success. Check the column exists.
- **Recurring charges are never written to the database.**
  `lib/projectedTransactions.ts` already includes the current month's
  occurrences in the dashboard total — an occurrence whose date has passed is
  emitted with `is_projected: false`, so it counts exactly like a real row. A
  `lib/recurringExecutor.ts` used to also insert a real row per due date; every
  subscription was therefore counted twice, and because those rows carried
  label `Automatic` they queued up in Review, where the user deleted them by
  hand — which put them back in scope for the next day's run, so they returned
  every morning. Do not re-add a DB-writing catch-up. Rows already in the DB
  with `source: 'executor'` are left alone and are still skipped as projection
  sources.

- **A failed budgets read may not replace the budgets on screen.** The limits
  and the hidden-category list are the only things the `budgets` table holds,
  and `loadUserBudgets` used to answer any failed read by putting
  `SYSTEM_CATEGORIES` into app state — reading "I could not ask" as "you have
  not set any". It happened: four requests go out together at the start of a
  load, the access token rotated in that instant, and the budgets read alone
  came back 401 while settings, transactions and overrides succeeded. The user
  found every limit back at 500 and their hidden categories showing. Worse than
  a wrong screen — the limits shown are what the settings screen writes back, so
  the starter figures sat one tap from being saved over the real ones. The rule
  is the one `fetchTransactionsFor` already follows: an empty answer is an
  answer, a failed request is not. See `lib/budgetFallback.ts`, which also holds
  why the `user_uuid`/`user_id` fallback fires only on 400/404 — answering a 401
  by asking for a column the schema lacks turned a recoverable failure into a
  certain one. `budgetsSurviveFailedRead.test.ts` pins all of it.

- **A quiet capture writes no widget delta.** The listener stays silent about
  six kinds of alert — a price alert or promo, one matching a user skip rule,
  a charge already on the books as recurring, money coming in (a deposit, an
  e-Transfer received, payroll), a charge that did not go through (declined,
  failed, cancelled), and an alert about money where no money moved (a balance,
  a statement, a minimum payment due) — and each of them means the
  JS pipeline will produce no row (the recurring one is already counted by the
  projection; income is never recorded at all). The optimistic widget delta
  used to be recorded anyway, so a
  "BTC is trading at $112,013.15" alert put six figures of spending and a
  phantom review item on the home screen, a payday deposit landed as a
  purchase that ate the month's remaining balance, and a declined $37.67 landed
  as a second copy of a charge that had already gone through for real the day
  before — where they stayed until the
  app was next opened: only a fresh snapshot discards a delta. The delta is
  gated on the same `captureQuietly` flag as the notification;
  `widgetQuietCaptures.test.ts`, `quietIncomeAlerts.test.ts` and
  `quietNonSpendingAlerts.test.ts` hold them together, the latter two also
  pinning the listener's phrase lists to the parser's own.

- **The setup flow's instructions have to survive leaving the app.** Every step
  hands the screen to Android's Settings, where none of Covault's text exists
  any more — and the step that matters most is the one where the switch REFUSES
  to move. Told in advance, a user carries on; arriving at a dead switch with
  nothing on screen, they conclude the app is broken, which is what the first
  one did. An app cannot draw over Settings (Android blocks overlays there —
  that is how tapjacking is prevented), so a Toast posted on the way out is the
  only surface left. `STEP_HINT` in `NotificationAccessGuide.tsx` holds the
  words and the plugin's `showHint` posts whatever it is handed, from the UI
  thread — the Java deliberately has no copy of its own to drift from.
  `setupHintOutsideTheApp.test.ts` pins that, and pins that a Play Store install
  is never promised a refusal that is not coming: `getRestrictedSettingsInfo`
  reads the installing package, and a store install gets two steps rather than
  four.

- **The listener may only go quiet where the parser would refuse the row.**
  Every list mirrored into `NotificationListener.java` is a copy of one the
  parser already rejects on, never a new opinion of the native side's own. That
  is the whole safety argument for silencing anything at all: the worst a
  faithful copy can cost is an announcement of something that was never going
  to appear in Review, whereas an opinion held only on the phone can cost a
  purchase outright — the listener runs with the app closed and nothing
  downstream can recover a spend it decided to ignore. The mirror tests parse
  both files and fail the build on drift, so a phrase added on one side only
  breaks CI rather than shipping. The one asymmetry that is deliberate:
  `BILL_NOTICE_PHRASES` beats a spending word ("minimum **payment** due"),
  because a statement reminder was otherwise captured as a purchase for the
  minimum payment, while `available balance` and `available credit` stay in
  `STOP_PHRASES`, where a spending word in the same sentence still overrules
  them — some cards append the balance to a real purchase alert.

- **A real charge cancels at most ONE projected occurrence, and it does so by
  resemblance rather than by an exact match.** The projection is a guess that a
  recurring charge is coming; once the charge lands, showing the guess too
  counts the money twice. That test used to demand the same vendor spelling,
  the same amount to the cent, the same day and the same category, so a
  premium reported at $477.45 on its due date and captured at $477.46 the next
  day sat on the dashboard twice. It is now "looks like the same charge"
  (`lib/duplicateCharge.ts`) — but paired off one-to-one, closest first,
  because the household has two Fizz charges a month three days apart and a
  single unpaired sweep would let the first of them cancel both. Do not
  simplify either half back: exactness put a phantom row on the dashboard,
  and an unpaired sweep drops a real expected one.
  `duplicateChargeDrift.test.ts` pins both.

- **An auto-filed capture is never a soft duplicate.** Auto-filing is the one
  path that records a purchase the user never sees, and the soft-duplicate rule
  deliberately inserts a lookalike rather than risk losing a charge — the two
  together filed a second copy of one charge straight to the dashboard with
  nothing in Review to say so. The insert still happens; only the filing is
  refused. `softDuplicateNotFiledSilently.test.ts` holds it.

- **A budget limit change that REDUCES the total is always allowed, even while
  the total is still over the income.** The limits screen used to refuse any
  save whose result came out above the monthly income, and looked only at that
  result — which trapped every new user whose income was under $3,500, because
  the starter set is seven categories at $500 and they were over the line
  before touching anything. Lowering a limit still left them over, so lowering
  was refused too: the only escape the app offered was to claim a bigger
  income. `lib/budgetAllocation.ts` holds the rule and
  `budgetAllocation.test.ts` pins it. Do not "restore" the simpler check.

- **The intro's setup steps write each answer as it is given, and never render
  `SYSTEM_CATEGORIES`.** Two separate reasons, both easy to undo by accident.
  The writing: the capture step leaves the app for Android's settings, where the
  WebView is routinely destroyed, so a flow that collected answers and committed
  them at the end would commit at a moment many users never reach —
  `lib/onboardingProgress.ts` therefore only has to remember WHICH step, never
  what was typed. The ids: `budgets` has no id column, so a loaded row is
  `budget:<name>` while the starter constants carry fixed UUIDs, and
  `hiddenCategories` stores whichever id was on screen when the eye was tapped
  — rendering the constants would let a category be hidden under one id and
  un-hidden under another the moment the real load landed. The step waits on
  `categoriesLoaded` instead. `onboardingProgress.test.ts` pins both, along with
  every step being skippable: the intro is now the only thing between a new user
  and their app, and it must never be able to trap them.

- **"We have heard nothing from this bank" is an inference, and the app says
  so.** Android exposes no way for an ordinary app to read whether ANOTHER
  app's notifications are enabled — `areNotificationsEnabled` and
  `getNotificationChannels` are scoped to the caller, the per-package variants
  are system APIs, and the listener's ranking data only describes notifications
  that were actually posted, which is no help when the complaint is that none
  are. So `lib/bankHeartbeat.ts` records the one observable thing — the last
  time each bank reached us — and the warning is worded as a guess with a
  button to the page that fixes it. Do not reword it into a statement of fact,
  and do not shorten the silence window: the same silence is what a quiet week
  on a rarely-used card looks like.

- **The user's list of capture sources is authoritative, and "never asked" is a
  third state.** `isMonitoredApp` used to check the hardcoded ~350-bank list
  FIRST and only then the user's choices, so unticking a built-in bank appeared
  to work and changed nothing — while `autoDetectBankingApps`, which is add-only
  and runs on every launch, put back anything removed. The stored list now wins
  once `monitored_apps_chosen` is set, INCLUDING when it is empty, which is a
  real answer. Losing that flag reads as "we have not asked" and quietly
  restores the defaults; setting it too early freezes a seed as though the user
  had chosen it. Only `saveMonitoredApps` raises it, and it is never lowered.
  Both lists — the phone's `monitored_apps` and the web selection — must be
  written together, which is what `applySourceSelection` is for: writing one
  alone gives you notifications that are read and then thrown away, in silence.
  `captureSourceSelection.test.ts` pins all of it.

- **Two apps reporting one tap are matched on AMOUNT AND TIME, never on the
  merchant.** Google Wallet re-announces every tap-to-pay purchase the card's
  own app announces. It was excluded outright for years because the first
  attempt at collapsing the pair compared merchant names — and a wallet is
  precisely the source that parses the merchant badly, so it failed exactly
  when needed. Step 4d instead drops a capture whose amount matches one another
  app reported within five minutes, and the first reporter keeps the row. Do not
  widen that window to reach the bank-versus-email case: an email arrives hours
  or a day later and is a separate rule (step 4e) with its own one-to-one
  pairing, because at that range amount alone would eat real purchases. The
  exclusion list still exists but is empty; it is the only thing that beats a
  user's own choice.

- **An email capture is never auto-filed, never hides the user's mail, and never
  writes a widget delta.** Mail is the least reliable source the app has — a
  truncated snippet the mail app chose, with the merchant buried in prose — so
  it always goes to Review. Hiding it would delete something Covault does not
  own and cannot put back. And most banks announce a purchase twice, so an email
  capture is routinely discarded moments later; a delta written for one would
  show the purchase twice on the home screen until the app was next opened.

- **The budget order comes from `lib/budgetOrder.ts`, not from the database.**
  `budgets` has no primary key and no sort column, and `loadUserBudgets` reads
  it with a plain `select=*`, so PostgREST returns Postgres's heap order — which
  moves a row to the end the moment it is UPDATEd. Editing one budget's limit
  therefore sent that vial to the bottom of the dashboard on the next load. An
  `order=` on the query cannot fix it (there is nothing worth ordering on), so
  the order is fixed in code and every consumer inherits it from the one sorted
  list in app state. `budgetOrder.test.ts` pins it.

## Do not read

- `android/` — generated by CI (`rm -rf android && npx cap add android`) and
  gitignored. Custom native source lives in `android-custom/`.
- `dist/`, `node_modules/`.
- `supabase/migrations/*.sql` marked **SUPERSEDED** in their header.

## Conventions

- Surgical, behaviour-preserving changes. No broad rewrites unless asked.
- Never wrap imports in `try`/`catch`.
- Enum/label ↔ DB mapping belongs in `lib/hooks/transactionMappers.ts`.
- New bank or vendor pattern ⇒ add a parser test.
- Never commit secrets. `.env` and `*credentials*`/`*secrets*` are gitignored.
- `npm run verify` before committing.

## Verification reality

CI type-checks, tests and builds an APK. **Nothing runs the app.** Compile-green
is not evidence for: notification capture, tray suppression, on-device AI, the
home-screen widget, haptics, or anything visual. Those need a device or
`npm run dev`. Say so plainly rather than implying a green build means it works.