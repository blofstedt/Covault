# Folder ownership

Covault groups application code by the feature or responsibility that owns it.
Each feature has a clear public entry, privately owned components, nearby hooks
and tests, and shared code only where multiple real consumers need it.

## Application and components

| Folder | Owns |
| --- | --- |
| `App.tsx` | Root application component and routing |
| `app/` | Browser bootstrap, global types, constants, and styles |
| `app/hooks/` | App-wide authentication, lifecycle, deep links, notification listening, and setup completion |
| `app/data/` | User and household loading, settings, and transaction actions |
| `app/components/Auth.tsx` | Sign-in and recovery |
| `app/components/Dashboard/` | Home screen and dashboard-specific features |
| `app/components/review/` | Review feature entry, capture rules, and row review |
| `app/components/transactions/` | Manual entry, transaction items, and transaction actions |
| `app/components/settings/` | Settings feature entry and owned sections |
| `app/components/Onboarding/` | Setup flow and its owned steps |
| `app/components/tour/` | Guided tour and demo screen |
| `app/components/notifications/` | Notification settings, source selection, access guide, and first-capture dialog |
| `app/components/subscription/` and `updates/` | Subscription screens and update banner |
| `app/components/legal/` | Independent static legal pages |
| `app/components/common/` | Reusable components shared across features |

Simple components live as files directly in their owning folder. Shared simple
controls belong directly in `app/components/common/`. Once a component owns
subcomponents, give it a same-name PascalCase folder with an `index.ts` that
default-exports its main component. Its simple children remain files inside
that folder; children that own further components get their own folders.
Tests alone do not make a component complex.

Component folders use PascalCase. Structural folders use lowercase names,
preferably one word; use camelCase when multiple words are necessary. Never
create `app/app`. The root application lives in `App.tsx`; its bootstrap lives
in `app/index.tsx`. Keep runtime imports within their owner, and use public
feature entries when importing from another feature. Type-only imports may
point to their defining module. Shared pure helpers such as `cardSurface.ts`
and `getBudgetIcon.tsx` remain files directly in `common`.

Only share a component or helper when it has multiple real consumers. Feature-
private hooks and helpers stay beside the feature or component that owns them.

A few narrow entries preserve reuse or loading behavior:

- `Dashboard/DashboardBalanceSection.tsx` is used by both Dashboard and the tour.
  `Dashboard/budgetSections` also serves the intro with synthetic data.
- `Dashboard/BudgetFlowChart` is dynamically imported, keeping d3 out of the
  initial app entry. Do not re-export it eagerly from Dashboard's entry.
- `legal/PrivacyPolicy.tsx`, `legal/Terms.tsx`, and `legal/DeleteAccountRequest.tsx` have
  separate entries and lazy imports. There is no combined Legal barrel.
- Transaction actions and items, subscription gating, notification dialogs
  and source selection, and the tour demo retain narrow entries.
- A component entry exports its default implementation and only the named
  types or helpers that callers actually use. Avoid catch-all `export *`
  barrels.

## Shared libraries

| Folder | Responsibility |
| --- | --- |
| `app/lib/api/` | Supabase client, API helpers, read gates, and row mapping |
| `app/lib/auth/` | Entitlements, OAuth callbacks, and account deletion |
| `app/lib/capture/` | Notification parsing, processing, deduplication, holds, capture sources, and review queue |
| `app/lib/capture/queries/` | Cached notification-rule queries |
| `app/lib/vendors/` | Vendor names, matching, rules, overrides, and community rules |
| `app/lib/transactions/` | Recurrence, ordering, refunds, duplicate charges, and transaction payloads |
| `app/lib/transactions/validation/` | Shared completed-entry schema |
| `app/lib/budgets/` | Allocation, category palette and order, visibility, sharing, and shield calculations |
| `app/lib/money/` | Strict amount parsing and currency formatting |
| `app/lib/native/` | Capacitor bridges, notification setup, updates, haptics, and widget snapshots |
| `app/lib/ai/` | On-device extraction and model storage |
| `app/lib/cache/` | First-paint storage and the shared query client |
| `app/lib/time/`, `navigation/`, `observability/`, `settings/`, `ui/` | Dates and server clock, back stack, logging, setting persistence, and toast events |

Shared code stays shared when multiple real consumers need it. The strict
amount parser and entry schema serve manual entry and captured fuel or held
amount corrections. Vendor overrides connect Review to transaction actions.
Widget and notification bridges belong to shared native infrastructure.
App-wide orchestration lives under `app/`; it does not belong in a generic UI
hook group.

Custom native source remains in `native/android/`, and SQL remains in
`supabase/`. Domain types, constants, and global styles live under `app/`.

## Tests and enforcement

Colocated tests live in the owning folder's `__tests__/` directory. Cross-module
and source-reading regression checks live in `test/__tests__/regressions/` when
there is no single source owner. `test/` also contains shared provider helpers;
`e2e/` contains the browser suite. Moving a test must update its imports and
source-file paths without weakening its assertions.

`.eslint/feature-entrypoints.mjs` lists the public feature entries. When adding
a feature or an approved narrow entry, update that catalog so enforcement
applies to the new owner.

ESLint rejects cross-feature runtime imports of private components and
supporting files. It accepts same-owner imports, listed public entries, the
narrow lazy chart import, and type-only imports from their defining modules.
Tests may directly import the private behavior they exercise. The lint
configuration's data and native boundaries continue to apply at their new
paths.

`folderEntryPoints.test.ts` checks accepted and rejected imports using the real
ESLint configuration. Type checking includes relocated tests. The ordinary
tests, lint, and production build should also pass after a folder change;
inspect the lazy chunk and unchanged native fingerprint, and run relevant
browser checks. These checks do not establish physical-phone performance or
live database behavior.
