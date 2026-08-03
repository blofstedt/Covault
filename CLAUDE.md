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
