# Covault — AI Codebase Reference

## What is Covault?

Personal budget tracking PWA + Android app. Users track spending across budget categories, with automatic transaction capture from Android banking notifications via on-device AI. Supports household sharing with a partner.

**Platforms:** Web (Vercel), Android (Capacitor), PWA (offline via service worker)

## Tech Stack

- **Frontend:** React 19 + TypeScript 5.8, Vite 6
- **Styling:** Tailwind CSS 3.4 (dark mode via `dark:` prefix, safe-area insets)
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Mobile:** Capacitor 8 (Android API 22+)
- **AI:** `@huggingface/transformers` — Xenova/flan-T5-small, ONNX/WASM, runs client-side
- **Viz:** D3 7, Lucide React icons
- **Testing:** Vitest 4, Playwright 1.59
- **No linter/formatter configured**

## Commands

```bash
npm run dev          # Vite dev server on localhost:3000
npm run build        # Production build → dist/
npm run preview      # Preview production build
npm test             # vitest run
npm run cap:build    # Build + sync to Android (vite build → cap sync → sync-android.sh)
npm run cap:sync     # Just sync assets to Android
npx cap open android # Open in Android Studio
```

## Environment Variables

All `VITE_*` vars are embedded at build time by Vite. Store in `.env` at project root (dev) or Vercel dashboard (prod).

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project endpoint |
| `VITE_PUBLIC_SUPABASE_URL` | Alt name (both supported) |
| `VITE_SUPABASE_ANON_KEY` | Supabase public API key |

## Project Structure

```
App.tsx              # Root component: auth → data loading → UI routing
index.tsx            # Entry point, path routing (/privacy, /terms, /)
types.ts             # Core interfaces: Transaction, BudgetCategory, User, AppState, etc.
constants.ts         # 7 default budget categories with fixed UUIDs

components/
  Auth.tsx                     # Login/signup
  Dashboard.tsx                # Main view after auth
  Onboarding.tsx               # First-run flow
  TransactionForm.tsx          # Add/edit transaction modal
  TransactionItem.tsx          # Transaction row display
  BudgetSection.tsx            # Budget card with expand/collapse
  TransactionParsing.tsx       # AI extraction review page
  NotificationSettings.tsx     # Configure monitored banking apps
  SubscribeModal.tsx           # Premium upsell
  PremiumGate.tsx              # Feature gating
  dashboard_components/        # Dashboard sub-components (header, balance, budget list, smart cards, etc.)
  transaction_parsing/         # Parsing sub-components (ActiveBanksCard, AITransactionsEnteredCard, etc.)
  shared/                      # CardWrapper, CloseButton, EmptyState, Spinner
  ui/                          # ConfirmModal, etc.

lib/
  supabase.ts                  # Supabase client init
  notificationProcessor.ts     # Full pipeline: dedup → parse → AI extract → categorize → insert
  aiExtractor.ts               # Flan-T5 extraction + 700+ vendor corrections dict
  deviceTransactionParser.ts   # Regex-based notification text parsing (amount, vendor, income, refund)
  formatVendorName.ts          # Vendor name normalization + fuzzy matching
  covaultNotification.ts       # Capacitor plugin JS interface
  bankingApps.ts               # 150+ known banking app package names
  dateUtils.ts                 # Timezone-aware date parsing
  budgetColors.ts              # Category color palette
  projectedTransactions.ts     # Recurring transaction projection
  recurringExecutor.ts         # Auto-execute recurring txns daily
  smartCards.ts                # AI insight card generation
  entitlement.ts               # Trial + subscription logic
  localNotificationMemory.ts   # In-memory dedup cache (2hr TTL)
  apiHelpers.ts                # Supabase query helpers
  hooks/
    useUserData.ts             # Facade composing all data hooks
    useDataLoading.ts          # Load budgets, transactions from Supabase
    useTransactionOps.ts       # Transaction CRUD
    useNotificationListener.ts # Listen for Android notification events
    useAuthState.ts            # Auth state machine
    useHouseholdLinking.ts     # Partner linking
    useUserSettings.ts         # Settings persistence
    useAppTheme.ts             # Dark/light mode
    transactionMappers.ts      # Supabase row ↔ Transaction mapping
  __tests__/                   # Unit tests

android-custom/                # Custom native plugins (copied to android/ via sync-android.sh)
  NotificationListener.java    # System notification listener service
  CovaultNotificationPlugin.java # Capacitor JS bridge plugin
  MainActivity.java            # Entry point, registers plugin
  BootReceiver.java            # Restart listener on device boot

supabase/
  schema.sql                   # Idempotent migration (IF NOT EXISTS)
  schema_fresh_install.sql     # Destructive fresh setup (DROP ALL)
  migrations/                  # Incremental migrations
```

## Database Schema (Supabase/PostgreSQL)

**Tables:** `budgets`, `transactions`, `pending_transactions`, `settings`, `vendor_overrides`

All tables use RLS: `auth.uid() = user_id` + partner access policies.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `budgets` | Budget categories per user | id, category, limit_amount, user_id, visible. UNIQUE(user_id, category) |
| `transactions` | Confirmed transactions | id, user_id, vendor, amount, date, category_id (FK→budgets), recurrence, label, is_projected, is_income |
| `pending_transactions` | AI-parsed awaiting review | id, user_id, extracted_vendor, extracted_amount, confidence, status (pending/approved/rejected) |
| `settings` | 1 row per user | user_id (PK), partner_id, monthly_income, subscription_status, trial_* |
| `vendor_overrides` | User reclassification memory | vendor_name → category_id mapping |

**Transaction labels:** `'Automatic'` (AI-added), `'Manual'` (user-entered). The `TransactionLabel` enum has only these two values.

**7 default budget categories** (fixed UUIDs in constants.ts): Housing, Groceries, Transport, Utilities, Leisure, Services, Other.

## Notification Processing Pipeline

```
Android NotificationListener.java (system service)
  → Intercepts banking app notifications
  → Regex-parses vendor/amount from raw text
  → Broadcasts to CovaultNotificationPlugin.java (Capacitor bridge)
  → JS event: 'transactionDetected'
  → useNotificationListener hook
  → processNotificationWithAI() in notificationProcessor.ts:
      1. In-memory dedup (2hr TTL cache)
      2. deviceTransactionParser.ts: regex parsing (amount, vendor, income, refund, non-financial filtering)
      3. aiExtractor.ts: Flan-T5 model (is transaction? vendor? category?)
      4. Database dedup (fuzzy vendor match + ±3 day window)
      5. Category assignment (vendor_overrides → AI suggestion → default)
      6. Insert: high confidence (≥80%) → transactions table; lower → pending_transactions
```

**Three-layer dedup:**
1. In-memory cache (key: `bankAppId|amount|timestamp`, 2hr TTL)
2. DB lookup (fuzzy vendor + same amount within ±3 day window)
3. Pending review queue (user approves/rejects)

## Architecture Patterns

**State management:** React useState + custom hooks (no Redux/Zustand). Data flows top-down via props. `useUserData` is a facade hook composing `useDataLoading`, `useTransactionOps`, `useHouseholdLinking`, etc.

**Routing:** Path-based in index.tsx (no React Router): `/` → App, `/privacy` → PrivacyPolicy, `/terms` → Terms.

**Auth:** Supabase Google OAuth. Redirect URLs: `com.covault.app://auth/callback` (Android), web domain (prod). Handled by `useDeepLinks` hook.

**Dark mode:** Tailwind `dark:` prefix, CSS class-based (configured in tailwind.config.js). Theme stored in settings.

## Coding Conventions

- **Components:** Functional + hooks, `PascalCase.tsx`
- **Hooks:** `useXxx.ts`
- **Utils:** `camelCase.ts`
- **Constants:** `UPPER_SNAKE_CASE`
- **Imports:** `@/*` path alias (maps to project root), destructured named exports
- **Styling:** Tailwind utility classes only (no CSS-in-JS). `dark:` for dark mode. `p-safe-top`/`pb-safe-bottom` for mobile safe areas.
- **TypeScript:** Not strict mode. `skipLibCheck: true`. Target ES2022. JSX react-jsx.
- **Error handling:** try/catch in async ops, `console.error` for logging, `<ErrorBoundary>` wraps main sections.

## Android Notes

- Custom Java plugins live in `android-custom/` and are synced to `android/` via `scripts/sync-android.sh`
- `NotificationListener.java` requires `BIND_NOTIFICATION_LISTENER_SERVICE` permission (user must grant in Android Settings)
- `QUERY_ALL_PACKAGES` permission for listing installed apps
- Capacitor config: app ID `com.covault.app`, HTTPS scheme, mixed content allowed
- Build: `npm run cap:build` → open in Android Studio → Run/Build APK

## Common Gotchas

- **Env vars not working on Android:** `.env` must exist before `npm run cap:build` (Vite embeds at build time)
- **`@types/react` warnings in IDE:** Pre-existing — some files show implicit `any` errors that don't affect the build
- **TransactionLabel enum:** Only has `AUTOMATIC` and `MANUAL` — no `EDITED` or `AUTO_ADDED` values. Don't reference non-existent enum members.
- **Timezone:** Transactions stored as `DATE` type. Use `dateUtils.ts` for local timezone conversions.
- **Dedup strictness:** Two legitimate purchases from the same vendor within 1 minute may be deduped. Window configurable in `notificationProcessor.ts`.
- **AI model:** Flan-T5 is ~250MB on first load, cached by browser. Lazy-loaded on first notification.
