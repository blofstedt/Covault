# Codebase plan

Covault already has a working design language, a large set of capture regression
tests, and notes explaining failures that must not return. Those notes preserve
evidence about what people saw; they do not prove the current implementation is
the best one. Replace custom code when a simpler, established approach can
preserve the behavior. Make changes one working feature at a time and keep the
phone app usable after each step.

## Rules for every change

1. Name the behavior being changed and the person who will notice it. Keep a
   test for a high-risk rule, especially capture, sharing, deletion, and money
   totals. Prefer a test that calls the behavior over one that searches source
   text. Source checks are still useful when they guard native/web parity or
   build wiring.
2. Keep database reads and writes behind feature operations. A screen should
   ask to save a choice, not know the database column name or HTTP response
   shape. Failed reads must not erase data already on screen. Failed writes
   must be visible and must not leave a choice looking saved.
3. Put state with its owner. Form drafts, search text, and an open sheet belong
   to their screen. Supabase owns saved household data. Device storage owns
   phone-specific choices. A shared store is justified only when several
   unrelated screens need the same client-only state.
4. Reuse the category palette and existing controls. Add a shared control when
   two real screens need the same behavior and look. Check light and dark mode,
   a narrow phone, larger text, and reduced motion when changing a screen.
5. Run `npm run verify` before committing. For visual, capture, update, or
   widget changes, also check the changed flow in a running app or on an
   Android phone. CI builds the APK but does not run those flows.

## Work in order

### 1. Make the current workflow dependable

- [x] Use the committed lockfile for local and CI installs. Both Android
  workflows now use `npm ci --legacy-peer-deps`.
- [x] Make the dashboard's ordinary settings and sharing privacy choice report
  a failed save and restore the last saved value. The remaining income, theme,
  budget-limit, and budget-visibility paths now reject successful responses that
  changed no row, preserve the income create fallback, and serialize each
  combined budget-row choice so overlapping changes cannot overwrite or roll
  back each other. Focused and full tests pass; Sol's review found no remaining
  issues. Phone-only behavior is still unverified.
- [ ] Write one current database setup path. The README currently points to
  the August schema sync while later migrations change sharing, privacy, and
  other behavior. Verify a fresh database and an existing database before
  replacing the instructions. The user has no approved read-only way to inspect
  the deployed schema yet, so this remains open. Never infer deployed schema
  from the files alone.
- [x] Confirm the build workflow needs each permission it grants. Keep release
  publishing separate from ordinary validation. The build job now has only
  `contents: read`; the main-branch publisher has `contents: write`, and the
  unused Actions/packages write grants are gone. `appUpdate.test.ts` pins the
  job boundary; its focused 25-test run passed.

### 2. Give features clear boundaries

- [x] Use a dashboard setting as the first example. The settings data layer
  now owns the column mapping and checks the save result; the dashboard owns
  the person's choice and restores it when saving fails. Follow this boundary
  as other settings flows change.
- [ ] Put related screen code together as each feature changes. A feature can
  own its screen, small controls, hook, data operations, and tests. Keep
  genuinely shared controls in `components/ui` or `components/shared`; do not
  create a generic component for a single use.
- [ ] Split `notificationProcessor.ts` along stable decisions, one at a time.
  The first boundary is already in place: `deviceTransactionParser.ts` owns
  spending eligibility, with matching Android wording rules. Its parser,
  pre-authorization, income, non-spending, non-purchase, and capture-source
  behavior suite passed (215 tests). The nearby same-merchant hard-skip versus
  visible possible-duplicate decision is now isolated in
  `notificationDuplicates.ts`; its 8 direct behavior tests and 42-test focused
  duplicate/capture regression set passed. Cross-app same-tap matching and
  email-to-bank duplicate selection now have pure decisions with behavior
  coverage in `captureChannel.ts` and `notificationDuplicates.ts`. Fallback
  category choice is isolated in `notificationCategory.ts`, with focused
  tests for AI precedence, hidden categories, merchant signals, and defaults.
  Shared exact, prefix, and contains matching now lives in
  `vendorRuleMatching.ts`; both personal and partner rules use it. It prefers
  the displayed vendor name over aliases. Behavior tests cover key priority,
  row order, empty keys, and all supported match types. Sol's review found no
  remaining issues.
  The reverse-order bank-upgrades-email match selection is now isolated too;
  its row update remains in the processor. The captured-row insert and
  compatibility retry for optional late-added columns now live in
  `notificationPersistence.ts`, with behavior tests for both retry and failure.
  The post-insert race-recovery keep/rollback decision now lives in
  `notificationDuplicates.ts` with direct result tests; the processor still
  owns the database re-query and delete choreography. Local review/processed
  writes now pass through `notificationMarkers.ts`; behavior tests cover
  permanent captures, retryable rejections, legacy keys, and keeping
  auto-accepted rows out of Review. Auto-filing eligibility now lives in
  `notificationAutoAccept.ts`; direct tests cover each refusal gate, and
  processor tests confirm email, fuel-hold, and foreign-currency captures stay
  in Review even when a learned rule matches. Sol found no remaining issues.
  Learned merchant-rule selection now also lives in
  `decideMerchantRuleChoice`: sibling branches can surface real category
  conflicts, `Other` is not counted as an opinion, and only the rule matching
  the current capture can be applied. Direct decision tests and capture tests
  cover the Wendy's rescue and Costco conflict; Sol found no remaining issues.
  Recurring-charge handling now separately checks whether a matched row is
  this capture's recorded occurrence before attaching today's notification;
  older schedule entries remain untouched. Direct boundary tests and processor
  tests cover both outcomes, and Sol found no remaining issues. The phone's
  saved vendor-map choice now lives in `vendorMapMatching.ts`; tests cover
  primary-key and alias priority, constrained fuzzy matches, ties, and a
  real false-match capture regression. Sol found no remaining issues.
  Conflict suggestions now count only this merchant's past filings, including
  parser aliases; ties still suggest nothing, and suggestions remain in Review.
  Direct behavior tests and Sol's review found no remaining issues. The full
  suite (2,118 tests), type-check, ESLint, and production build pass.
  The Android capture-flow check is still outstanding.
- [ ] Evaluate whether the existing React Query cache should own more server
  reads. The current bounded use is Review's ignored-alert rules; tests cover a
  failed refetch, prefetching, and user-scoped cache entries, while sign-out
  clears the cache. Transactions and budgets remain on the existing load path,
  which protects first paint, failed reads, and out-of-order answers
  (`firstPaintCache`, `budgetFallback`, and `readGate`). The planned comparison
  of another low-risk read on a phone has not been done, so no wider migration
  decision is claimed yet.

### 3. Make the design easier to keep consistent

- [x] Gather the card, button, sheet, and motion values that screens repeat.
  `docs/UI_VISUAL_CHECKS.md` records the current shared values and differences.
  The account-free visual page compares the real populated and empty dashboard,
  Review, onboarding, add-entry, and settings components in browser renders;
  no broad restyle was made before an Android comparison.
- [ ] Give dialogs and sheets one accessible interaction pattern: initial
  focus, Escape, return focus, scroll locking, and reduced motion. Modal and
  sheet surfaces now share `useDialogInteraction`, including nested layers;
  tests cover focus containment/return, Escape order, scroll restoration, and
  inert walkthrough content. The visible walkthrough layer keeps focus and
  Escape handling above stage dialogs mounted later, and the calendar now names
  its month controls and announces month changes. Entrances use the shared
  320 ms curve and honor reduced motion. Dismissals now use that same curve;
  reduced-motion users close immediately, while actions that submit or confirm
  retain their existing lifecycle. A physical-phone keyboard, safe-area, and
  motion check is still outstanding.
- [x] Add a small set of repeatable visual checks for the dashboard, Review,
  onboarding, and settings. `visual-tests/index.html` supplies example and
  empty fixtures at a phone viewport; the same components are rendered in dark
  and light mode without Supabase credentials. Browser screenshots passed a
  visual inspection; Android WebView motion and native safe areas remain
  unverified.

### 4. Strengthen checks without a rewrite

- [x] Enable strict TypeScript checking. The initial 11 errors were nullable
  values and have been fixed without changing the intended data flow. Keep it
  on for new work; do not add casts merely to make it pass.
- [x] Add behavior tests beside changed features. The extracted duplicate
  decision has direct decision tests; the shared dialogs now have keyboard,
  focus-return, and scroll-lock behavior tests. Source checks remain only for
  build wiring where the behavior runs outside the unit-test process.
- [x] Review dependencies and build tools on a schedule. The new DOM test
  environment was checked against npm's latest stable release and its MIT
  license. The 17 advisories in the installed tree were cleared: PostCSS is
  8.5.28, Vite 6.4.3, and Vitest 4.1.11, with compatible transitive fixes.
  Transformers.js moved to 4.3.0 (Apache-2.0) to fix its vulnerable `sharp`
  dependency. The AI model store now uses the versioned WASM and loader URLs
  supplied by ONNX Runtime, which are separate from the Transformers.js
  package. Readiness markers are tied to that package/runtime identity and
  remain stable across temporary blob URLs created during retries. `npm audit`
  reports no known vulnerabilities. `.github/dependabot.yml` asks for monthly,
  grouped npm and GitHub Actions update proposals; Dependabot does not
  auto-merge them, and the repository does not enforce reviewer approval
  before merge. No state library was added.

## Decisions to challenge

- State ownership is currently split three ways: `App.tsx` holds saved budgets,
  transactions, and settings in one React state object; `firstPaintCache.ts`
  restores a bounded snapshot on launch; React Query caches Review's ignored
  notification rules. Keep this map explicit while changing data flow. The
  next small experiment should move one low-risk server read into React Query
  and compare launch, offline return, failed reads, and account switching with
  the existing flow. Add Zustand only if a concrete client-only value needs
  sharing across unrelated screens after that separation. It should not become
  a second home for Supabase rows.
- The app has a custom REST wrapper, direct fetches, Supabase client calls, and
  schema-name fallbacks. Check whether a typed data layer and generated database
  types can replace some of this without losing support for a database that is
  still in use. Start by verifying the actual deployed schema.
- The app keeps server data in a large React state object and also has a
  first-paint cache. Compare that arrangement with the query library already
  installed. Measure startup, offline return, failed reads, and a partner's
  updates before moving the core data.
- Many tests inspect source text. Replace one with a behavior test whenever a
  feature is changed. Keep a small number of source checks where they enforce
  native/web parity or build wiring that cannot run in the unit test process.
- Several dialogs and animations are built by hand. Compare them with the
  shared controls already present and with established accessible primitives.
  Keep custom motion only where it visibly earns its cost on the Android phone.

## How to judge progress

Each completed item should name the files it moved or changed, the behavior it
protected, and the check that passed. For UI work, record whether someone saw
the change render on a phone. A shorter file or a greener build alone is not
evidence that the app got easier to change or better to use.
