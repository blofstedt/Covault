# Folder ownership

Covault groups application files by the feature or responsibility that owns
them. Each feature has a public entry point, nearby private children and hooks,
nearby tests, and shared code with a clear reason to be shared. Covault keeps
its existing React, Vite, state, libraries, design and native integration.

## Application and components

| Folder | Owns |
| --- | --- |
| `app/` | Browser entry, root state and routing |
| `app/hooks/` | Authentication, app lifecycle, deep links, notification listening and setup completion |
| `app/data/` | User and household loading, settings and transaction actions |
| `components/Auth/` | Sign-in and recovery |
| `components/Dashboard/` | Home screen, its calculations and month/navigation hooks |
| `components/Review/` | Captured transactions, rules, rows, sheets and review-specific hooks |
| `components/Transactions/` | Manual entry, transaction items and transaction actions |
| `components/Settings/` | Settings dialog and its `sections/` |
| `components/Onboarding/` | Setup router, progress and `steps/` |
| `components/Tour/` | Guided tour, its step definitions and demo screen |
| `components/Notifications/` | Source selection, notification settings, access guide and first-capture dialog |
| `components/Subscription/`, `Updates/` | Subscription screens and update banner |
| `components/Legal/` | Three independent static pages |
| `components/CalendarPicker/` | Calendar control with its own tests |
| `components/ui/` | Flat reusable controls such as AmountInput, buttons, sheets and portals |
| `components/shared/` | Shared visual pieces and surfaces used by several features |

A feature's `index.ts` is its public component entry. Other features import
that entry rather than its private implementation file. Inside the same feature,
children, hooks and helpers use direct sibling imports. Avoid a barrel that
exports every feature, every helper, or every file in `lib/`.

Most supporting components stay flat inside their owner. Add a child folder
when it has its own private files or an independent public component contract;
do not create a folder for every one-file button. Settings sections and
onboarding steps remain visible groups within their owner.

A few narrow entries preserve existing reuse and loading:

- `Dashboard/BalanceSection` and `Dashboard/BudgetSections` also render the intro
  with synthetic data. Their narrow entries avoid loading the whole dashboard
  through a presentation import.
- `Dashboard/BudgetFlowChart` is imported dynamically, keeping d3 out of the
  initial app entry. Do not re-export it eagerly from Dashboard's entry.
- `Legal/PrivacyPolicy`, `Legal/Terms` and `Legal/DeleteAccountRequest` have
  separate entries and separate lazy imports. There is no combined Legal barrel.
- Transaction actions/items, subscription gating, notification dialogs/source
  selection and the tour demo retain their own narrow public entries.
- A type-only import may use the defining module. It does not create a runtime
  dependency or require exposing private behavior through a barrel.

## Shared libraries

| Folder | Responsibility |
| --- | --- |
| `lib/api/` | Supabase client, API helpers, read gates and row mapping |
| `lib/auth/` | Entitlements, OAuth callbacks and account deletion |
| `lib/capture/` | Notification parsing, processing, deduplication, holds, capture sources and review queue |
| `lib/capture/queries/` | Cached notification-rule queries |
| `lib/vendors/` | Vendor names, matching, rules, overrides and community rules |
| `lib/transactions/` | Recurrence, ordering, refunds, duplicate charges and transaction payloads |
| `lib/transactions/validation/` | Shared completed-entry schema |
| `lib/budgets/` | Allocation, category palette/order, visibility, sharing and shield calculations |
| `lib/money/` | Strict amount parsing and currency formatting |
| `lib/native/` | Capacitor bridges, notification setup, updates, haptics and widget snapshots |
| `lib/ai/` | On-device extraction and model storage |
| `lib/cache/` | First-paint storage and the shared query client |
| `lib/time/`, `navigation/`, `observability/`, `settings/`, `ui/` | Dates and server clock, back stack, logging, setting persistence and toast events |
| `lib/hooks/` | Reusable interaction hooks: dialog lifecycle, back handling, current day and animated numbers |

Shared code remains shared when it has several real consumers. The strict
amount parser and entry schema serve both manual entry and captured fuel/held
amount corrections. Vendor overrides connect Review to transaction actions.
Widget and notification bridges belong to shared native infrastructure.
Feature-only hooks live beside the owning screen; app-wide orchestration lives
in `app/`, rather than being mistaken for a generic UI hook.

Domain types and system constants remain at the repository root. Custom native
source remains in `android-custom/`, and SQL remains in `supabase/`. This folder
migration changes neither their behavior nor their ownership.

## Tests and enforcement

Unit and component tests live in the owner's `__tests__/` folder. Cross-module
and source-reading regression checks live in `test/__tests__/regressions/` when
there is no single source owner. `test/` also contains shared provider helpers;
`e2e/` remains the browser suite. Moving a test must update both imports and
source-file paths without weakening its assertions.

`.eslint/feature-entrypoints.mjs` lists the public feature entries. When adding
a feature or an approved narrow entry, update that catalog so enforcement
applies to the new owner.

ESLint rejects cross-feature runtime imports of supporting files in application
code. It accepts same-feature imports, the listed public entries, the narrow
lazy chart import and type-only defining-module imports. It does not impose
component barrels on shared libraries or controls. Tests may directly import
the private behavior they exercise. The lint configuration's existing data and
native boundaries continue to apply at their new paths; legacy shell
presentations retain their prior strict-rule scope.

`folderEntryPoints.test.ts` checks accepted and rejected imports using the real
ESLint configuration. Type checking includes relocated tests. A folder change
also needs the ordinary tests, lint and production build, lazy-chunk inspection,
unchanged native fingerprint and relevant browser checks. These checks do not
establish physical-phone performance or live database behavior.
