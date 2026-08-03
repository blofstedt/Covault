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
| "I got a duplicate" | `lib/notificationProcessor.ts` — dedup is steps 1, 2, 5 and the post-insert race recovery |
| "it picked the wrong category" | `lib/hooks/useVendorMatcher.ts`, `lib/vendorMatchConfidence.ts`, step 5a of the processor |
| "a new restaurant landed in Other" | `lib/merchantCategorySignals.ts` — the offline descriptor/POS-prefix guess, applied in step 5c |
| "the review list / badge is wrong" | `lib/reviewQueue.ts` — the single definition of "waiting"; the list, badge and widget all read it |
| "the widget is stale or wrong" | `lib/widgetSnapshot.ts` → `android-custom/WidgetDeltaStore.java` → `android-custom/WidgetRenderer.java` |
| "notifications look wrong / didn't arrive" | `lib/appNotifications.ts` (JS-posted) and `android-custom/NotificationListener.java` (native, fires with app closed) |
| "tapping a notification goes to the wrong place" | `lib/hooks/useNotificationRoute.ts`, `android-custom/MainActivity.java` |
| "partner sharing / linking is broken" | `lib/hooks/useHouseholdLinking.ts` + the RPCs in `supabase/migrations/2026_08_01_sync_schema_to_app.sql` |
| "a setting doesn't stick" | `SETTING_DB_KEYS` in `components/Dashboard.tsx` → `lib/hooks/useUserSettings.ts` → `lib/hooks/useDataLoading.ts`. **Usually a missing DB column** — see Invariants |
| "an edit didn't save" | `lib/hooks/useTransactionOps.ts`. If it's a **vendor rename**, also `lib/formatVendorName.ts` — it has previously overwritten the user's own capitalisation |
| "the numbers are wrong" | `components/dashboard_components/useDashboardTotals.ts`, `lib/refundMatching.ts`, `lib/projectedTransactions.ts` |
| "last month's entries are still listed" / "the list is in the wrong order" | `lib/transactionOrdering.ts` (one month, chronological) → `lib/hooks/useCurrentDay.ts` (the single clock) → `components/Dashboard.tsx` |
| "a modal/sheet looks broken or is cut off" | `components/ui/Portal.tsx` — overlays inside `<main>` need it; see Invariants |
| "the animation is janky" | `index.css`, `components/BudgetSection.tsx`, `components/dashboard_components/BudgetFlowChart.tsx` |
| "the app didn't offer me the update" / "it didn't update itself" | `lib/appUpdate.ts` (the check) → `lib/hooks/useAppUpdate.ts` (when, and which of the two routes) → `android-custom/CovaultUpdaterPlugin.java` (install, or unpack) |
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
