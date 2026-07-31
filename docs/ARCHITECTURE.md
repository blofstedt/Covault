# Covault — architecture reference

Read `CLAUDE.md` first. That routes you to the right file. This document is the
deep detail for when you're already there and need to understand *why*.

Every dated claim below is either re-verified on **2026-08-01** against the live
schema export, or explicitly marked unverified. Nothing carries an old date
forward unchecked.

---

## 1. Repo layout

```
App.tsx / index.tsx      Root state, auth, routing (onboarding → dashboard → review → settings)
constants.ts             The 7 system budget categories + their fixed UUIDs
types.ts                 Domain types: User, BudgetCategory, Transaction, Toast, Recurrence, ...
index.css                Hand-rolled keyframes + the reduced-motion block

components/
  Dashboard.tsx                  Home. Owns SETTING_DB_KEYS and the widget-snapshot push
  TransactionParsing.tsx         The "Review" page (bottom-bar tab)
  BudgetSection.tsx              A budget "vial"
  dashboard_components/          Balance card, BudgetFlowChart (d3), bottom bar, search
    settings_modal_components/   One file per settings section
  transaction_parsing/           Review rows, action sheets, learned-rules card
  ui/                            Portal, ConfirmModal, ToggleSwitch, PageShell, ParsingCard

lib/
  notificationProcessor.ts   THE capture pipeline (1.7k lines — highest-risk file here)
  deviceTransactionParser.ts Regex extraction: amount, vendor, confidence, pre-auth detection
  aiExtractor.ts             On-device flan-T5; few-shot learning from user corrections
  reviewQueue.ts             Single definition of "waiting in Review"
  vendorMatchConfidence.ts   Match scoring + the auto-file threshold
  widgetSnapshot.ts          What the home-screen widget draws
  caughtTransactionOps.ts    File / undo payloads (exact inverses)
  haptics.ts                 Safe wrapper; no-ops on web + reduced motion + when off
  hooks/                     useUserData (facade) → useDataLoading, useTransactionOps,
                             useHouseholdLinking, useUserSettings, useNotificationListener, ...
  __tests__/                 Vitest

android-custom/            SOURCE for native code. scripts/sync-android.sh copies into android/
  NotificationListener.java  Capture + capture notification + tray suppression + widget delta
  CovaultNotificationPlugin.java  JS↔native bridge
  MainActivity.java          Parks notification-tap routes
  CovaultWidgetProvider.java / WidgetRenderer.java / WidgetDeltaStore.java
  res/                       Icons, widget layout, appwidget-provider XML

supabase/
  schema.sql                 Canonical fresh schema
  migrations/                2026_08_01_sync_schema_to_app.sql is the live one; others SUPERSEDED
```

`android/` is generated and gitignored. It used to contain four *tracked* stale
copies of the Java — `NotificationListener.java` was 609 lines against the real
937 — which is exactly the kind of thing an AI opens by mistake. Removed
2026-08-01.

---

## 2. Notification capture

The highest-risk subsystem. Make small changes and back them with tests.

```
Android bank notification
  → NotificationListener.java (native, runs with the app closed)
      persist  → SharedPreferences queue, commit() so it means "on disk"
      notify   → Covault's own "$12.40 at X" notification
      dismiss  → optional tray suppression (opt-in), only if both above succeeded
      then     → widget delta (guarded; may never affect the above)
  → JS: processNotificationWithAI()
      1. in-memory dedup
      2. duplicate check vs transactions + pending_transactions
      3. AI extraction when regex confidence is low
      4. filter non-transactions (balance alerts, OTPs)
      5. duplicate check by vendor + amount
      5a. category: vendor overrides first, then AI guess
      6. insert  (caught_cleared: true if auto-file took it)
      6b. post-insert race recovery (rolls back a losing duplicate insert)
  → Review UI in components/transaction_parsing/
```

**The ordering is the safety property.** A dismissed bank notification cannot be
recovered by `scanActiveNotifications()`, so suppression is gated on: user opted
in, live post (not a rescan), monitored bank app, an amount was parsed, the
notification is clearable, the queue write committed, and Covault's own
notification is actually visible (not blocked at OS level). Any failure leaves
the bank's notification alone.

**Auto-file** (`auto_accept_known_vendors`, off by default) files a capture
straight to its budget when a rule *the user wrote* matches at ≥90%. Scored by
coverage — `matchKey.length / vendorKey.length` — so a rule like `"tim"` scores
0.17 against `TIM HORTONS DOWNTOWN` and does not qualify. Deliberately gated on
the override match, never on the AI's extraction confidence: those measure
different things.

---

## 3. Home-screen widget

RemoteViews — no WebView, no JS — so the app's d3 chart is unreachable and the
donut is drawn natively on a Canvas. It also has **no Supabase session**, so it
cannot fetch.

- The app pushes a pre-computed snapshot to SharedPreferences whenever the
  figures change (`lib/widgetSnapshot.ts`, pushed from `Dashboard.tsx`).
- The native listener appends optimistic **deltas** for captures made with the
  app closed, so a purchase moves the donut within seconds.
- Render = snapshot + deltas newer than it and inside its month. A fresh
  snapshot prunes them, so an optimistic guess the pipeline later rejects
  self-corrects on next app open.
- A midnight `AlarmManager` alarm handles month rollover; a stale month renders
  empty rather than showing last month's figures under this month's name.
- The bitmap is clamped (density ≤2×, 720×480). RemoteViews cross a Binder
  transaction with a ~1 MB ceiling; a 4×2 widget at xxhdpi is ~990 KB as
  ARGB_8888 and throws on larger devices.

---

## 4. Database

Five live tables plus `notification_rules`: `settings`, `transactions`,
`budgets`, `overrides`, `banks`. RLS on all of them, `auth.uid()`-based; a
partner sees your rows via `settings.partner_id`.

Enums: `Budgets` (Housing/Groceries/Leisure/Utilities/Transport/Services/Other —
matches `constants.ts` exactly), `Type` (Manual/Automatic), `Recurrence`
(One-time/Biweekly/Monthly).

### Verified 2026-08-01

Present and correct: all 15 `transactions` columns the app writes (including
`caught_cleared`, `confidence`, `source`, `raw_notification`); `overrides`
`match_key`/`match_type`/`updated_at`; `budgets."Visible"` with a capital V.

`2026_08_01_sync_schema_to_app.sql` added `settings.smart_notifications_enabled`,
`auto_accept_known_vendors`, `haptics_enabled`; fixed the
`subscription_status DEFAULT false` contradiction; and installed the partner
linking functions.

### Partner linking runs through RPCs, not REST

`settings` is RLS-gated to your own row, but linking has to touch the *other*
person's row. The old REST calls failed invisibly: the lookup returned zero rows
and the write returned `UPDATE 0` with no error. Loosening the policy cannot fix
it — RLS decides row-by-row and cannot see the client's WHERE clause, so any
policy permissive enough for a code lookup would expose every account's email.

So: `link_partner_by_code(p_code)`, `link_partner_by_email(p_email)`,
`unlink_partner()` — SECURITY DEFINER, pinned `search_path`, granted to
`authenticated`, revoked from PUBLIC. `budgeting_solo` stays client-side: it's a
per-user display preference and each side owns its own row for it.

### Known, deliberate, or unresolved

- **`pending_transactions` does not exist.** Reads treat 404 as empty; writes
  fail silently. Either create it or remove the references — don't half-fix it.
- **`ensureDefaultBudgets`' retry is dead.** Its fallback posts
  `user_id`/`category`/`limit_amount`/`visible`, none of which exist. Harmless,
  but it is not the safety net it appears to be.
- **Theme default disagrees.** `settings.theme_selected` defaults to `'dark'`;
  the app's in-memory default is `'light'`. A new user renders light, then flips.
- **`budgets` unique index** is `unique_user_budget`, a bare `CREATE UNIQUE
  INDEX` rather than a table constraint — so a constraints-only schema export
  appears to show nothing. `ON CONFLICT` accepts either, so the upsert works.
- **`notification_rules.pattern_type`** allows only `exact`/`contains` — narrower
  than `overrides.match_type`, which also allows `prefix`.
- **Unverified:** whether the dead RPCs `get_my_partner_id` and
  `generate_transaction_hash` were ever dropped.

### Tools

`scripts/introspect_schema.sql` — paste into the Supabase SQL editor for a full
read-only dump. `scripts/check_schema_drift.sh` compares live against
`schema.sql`; **not wired into CI**, needs `SUPABASE_SECRET_KEY`, which is how
drift accumulated in the first place.

---

## 5. Money model

- **Refund** = `amount < 0` and `is_income !== true`. `lib/refundMatching.ts`
  pairs it to an expense (same vendor, same |amount|, same budget, ≤30 days),
  hides the refund from every list, strikes through the matched expense, and
  lets the negative amount reduce the budget total.
- **Recurring** — two systems. `lib/recurringExecutor.ts` inserts missing due
  rows (idempotent, backs up 2 months). `lib/projectedTransactions.ts` is
  display-only, projecting 3 months ahead; past occurrences in the current month
  are solidified to `is_projected: false` so dashboard maths matches the DB.
- **`transaction.budget_id`** is the app's UUID; the DB column
  `transactions.budget` is the enum name. `transactionMappers.ts` translates.
- Refunds, income and projected rows are excluded from CSV export.

---

## 6. Subscriptions

`lib/entitlement.ts` is the single source of truth: premium =
`subscription_status === 'active'` OR now < `trial_ends_at`. 14-day trial,
managed by the app, not by Google Play. `trial_consumed` means it never resets
across logout, reinstall or device change.

Google Play Billing is **not implemented** — no billing plugin is installed. The
purchase flow, server-side receipt verification and RTDN handling are all still
to be built.

---

## 7. Testing and verification

`npm run verify` = `typecheck` + `typecheck:unused` + `vitest run` + `build`.

Several tests exist specifically to catch *silent* drift, and are worth knowing
about before you change the thing they guard:

| Test | Catches |
|---|---|
| `tailwindAnimatePlugin.test.ts` | The plugin being removed while ~40 of its classes are still used |
| `widgetPalette.test.ts` | The Java widget palette drifting from `budgetColors.ts` |
| `widgetAutoFileThreshold.test.ts` | The Java auto-file threshold drifting from the TS constant |
| `caughtTransactionOps.test.ts` | Undo no longer being the exact inverse of file |
| `bulkAccept.test.ts` | Bulk accept picking up AI guesses instead of user rules |

**CI never runs the app.** Capture, suppression, on-device AI, the widget,
haptics and anything visual can only be verified on a device or in `npm run dev`.
