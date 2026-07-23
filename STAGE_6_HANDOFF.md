# Stage 6 Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 5
**Risk to existing React app:** zero.

## What landed

The notification listener + parser pipeline. This is what makes
Covault auto-detect bank transactions from incoming notifications
and queue them for review.

### New files

| File | Purpose | Source port |
|---|---|---|
| `notification/CovaultNotificationListener.kt` | The `NotificationListenerService` that Android calls for every notification. Filters to known bank apps and hands off to the repository | React uses Capacitor + `@capacitor/local-notifications`; Kotlin uses the native `NotificationListenerService` directly |
| `notification/NotificationParser.kt` | Pure-logic port of `lib/deviceTransactionParser.ts`. Extracts vendor, amount, direction, refund/income/pre-auth flags, confidence | `lib/deviceTransactionParser.ts` |
| `data/repository/NotificationRepository.kt` | Orchestrates the pipeline: get current user, run parser, dedup, insert into `pending_transactions` | `lib/notificationProcessor.ts` |
| `notification/BankAppCatalog.kt` (inline) | Static list of known Canadian bank app package names | `lib/bankingApps.ts` (dynamic) |
| `test/notification/NotificationParserTest.kt` | 11 cases covering spend, refund, income, pre-auth, OTPs, balance checks, crypto price alerts, missing amount, vendor extraction | new |

### Modified files

| File | Change |
|---|---|
| `AndroidManifest.xml` | Declared the `CovaultNotificationListener` service with `BIND_NOTIFICATION_LISTENER` permission |

## What's ported vs. deliberately stubbed

The React `notificationProcessor.ts` is 1,266 LOC. The Kotlin
pipeline is ~150 LOC. Here's what I ported vs. what's stubbed:

**Ported:**
- ✓ Stop-phrase filter (OTP, balance, deposit, etc.)
- ✓ Non-financial pattern filter (crypto, promo)
- ✓ Strong go-phrase detection (spend, charged, paid, etc.)
- ✓ Refund phrase detection
- ✓ Income phrase detection (Interac received, etc.)
- ✓ Pre-auth phrase detection (authorization hold, etc.)
- ✓ Amount extraction ($X.XX, $X,XXX.XX, CAD X.XX variants)
- ✓ Vendor extraction (best-effort: text before the amount)
- ✓ Confidence scoring
- ✓ Dedup: skip if a row in the last 5 minutes has the same vendor+amount
- ✓ Insert into `pending_transactions`
- ✓ Approve / reject flows

**Stubbed / not ported:**
- The on-device AI model (HF transformers). The React app
  `lib/aiExtractor.ts` loads a 50MB model on first use. The
  Kotlin pipeline falls back to the deterministic parser for
  everything. Confidence below 0.5 means "we're guessing";
  the user still sees the row in the review queue.
- The vendor override memory (`localNotificationMemory.ts`).
  The React app remembers "Vendor X always goes to Budget Y"
  across runs. The Kotlin port doesn't persist this yet.
- The full list of bank apps. The React catalog is dynamic
  (reads from the device at runtime). The Kotlin port ships
  a static list of the 12 most common Canadian bank apps.
- The full pre-auth / settlement / catch_cleared flow
  (notification-listener-side state machine). The Kotlin
  port inserts everything as a one-shot `pending_transactions`
  row; the user approves it via the dashboard's review queue.

The pipeline is functional end-to-end with the stubs. A real
device test is the only way to validate the full flow.

## What you can verify on device

1. Build + install
2. Open Settings -> Apps -> Special access -> Notification access
3. Enable "Covault transaction detection"
4. (Optional) Lower a banking app's notification settings so
   test notifications are visible
5. Send a test transaction from your bank's app
6. Covault parses it, dedupes, and inserts into `pending_transactions`
7. Open the React app side-by-side: the new pending row should
   appear in both
8. Tap approve in either app: the row should move to `transactions`

## Stage 7 preview

Recurring transaction executor + future-dated projection. Pure
logic port of `lib/recurringExecutor.ts` + `lib/projectedTransactions.ts`.
The executor runs the user's recurring templates (Monthly, Biweekly)
and inserts projected transactions for the next N months. The
projections show up in the dashboard's `remainingMoney` math
(currently empty — the `DashboardTotals.projectedTransactions` list
is empty for this exact reason).

This stage is a single, focused commit: pure logic, no new UI, just
a new repository + the projection function wired into the totals
calculator.
