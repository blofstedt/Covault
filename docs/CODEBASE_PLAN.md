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
  a failed save and restore the last saved value. Tests cover a failed response,
  a missing row, and two quick changes to the same choice. Review the remaining
  save paths for the same failure.
- [ ] Write one current database setup path. The README currently points to
  the August schema sync while later migrations change sharing, privacy, and
  other behavior. Verify a fresh database and an existing database before
  replacing the instructions. Never infer deployed schema from the files alone.
- [ ] Confirm the build workflow needs each permission it grants. Keep release
  publishing separate from ordinary validation.

### 2. Give features clear boundaries

- [x] Use a dashboard setting as the first example. The settings data layer
  now owns the column mapping and checks the save result; the dashboard owns
  the person's choice and restores it when saving fails. Follow this boundary
  as other settings flows change.
- [ ] Put related screen code together as each feature changes. A feature can
  own its screen, small controls, hook, data operations, and tests. Keep
  genuinely shared controls in `components/ui` or `components/shared`; do not
  create a generic component for a single use.
- [ ] Split `notificationProcessor.ts` along stable decisions, one at a time:
  whether an alert is spending, whether it is a duplicate, which category it
  belongs to, and how the accepted result is saved. Test the user-visible
  capture and notification behavior before replacing a custom step.
- [ ] Evaluate whether the existing React Query cache should own more server
  reads. Its first use is Review's ignored-alert rules. Compare a small
  migration against the current failed-read, stale-answer, and first-paint
  behavior before deciding whether budgets, transactions, or settings belong
  there too. The current split is a starting point, not a permanent rule.

### 3. Make the design easier to keep consistent

- [ ] Gather the card, button, sheet, and motion values that screens repeat.
  Start with the existing controls and the budget interaction's 320 ms curve.
  Replace copies only after comparing the rendered screens.
- [ ] Give dialogs and sheets one accessible interaction pattern: initial
  focus, Escape, return focus, scroll locking, and reduced motion. Check it on
  the phone, where the keyboard and system sheets change the layout.
- [ ] Add a small set of repeatable visual checks for the dashboard, Review,
  onboarding, and settings. Include empty and populated states at phone size.
  Screenshots help spot drift; a real device check still decides whether motion
  feels smooth.

### 4. Strengthen checks without a rewrite

- [x] Enable strict TypeScript checking. The initial 11 errors were nullable
  values and have been fixed without changing the intended data flow. Keep it
  on for new work; do not add casts merely to make it pass.
- [ ] Add behavior tests beside changed features. Keep source-text tests only
  for relationships that cannot reasonably be exercised, such as generated
  Android wiring and mirrored native rules.
- [ ] Review dependencies and build tools on a schedule. Verify the current
  stable version, license, and audit result before adding a package. Avoid
  adding a state library until a concrete shared-state problem calls for it.

## Decisions to challenge

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
