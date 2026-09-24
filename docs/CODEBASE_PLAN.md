# Codebase plan

This file tracks unfinished work. `CLAUDE.md` is the single source of current
repository rules. Completed work belongs in Git history.

## 1. Make data setup and saves dependable

- [ ] Document one database setup path for a fresh vault and one migration path
  for an existing vault. Verify both against a real database before changing
  the README. Check the deployed schema before removing column-name fallbacks.
- [ ] Review setting writes outside the dashboard's current save boundary.
  Exercise a failed response, an empty response, and two quick changes to the
  same choice. The UI must show failure and restore the last accepted value.
- [ ] Review Android build workflow permissions. Keep validation permissions
  separate from permissions needed to publish a release.

## 2. Establish feature and state boundaries

- [ ] Group a screen, its small controls, hook, data operations, and behavior
  tests together when that feature changes. Move a control into shared UI only
  after two screens use the same behavior and appearance.
- [ ] Split `lib/notificationProcessor.ts` one decision at a time: spending
  classification, duplicate detection, category selection, and save. Preserve
  capture behavior with tests at the notification input boundary.
- [ ] Try one low-risk server read in React Query. Compare first paint, offline
  return, failed reads, stale responses, account switching, and partner updates
  with the current behavior before moving budgets, transactions, or settings.
- [ ] Verify the deployed schema, then assess generated database types and a
  typed data layer for the current REST wrapper and schema fallbacks.
- [ ] Add a shared client-state store only if unrelated screens need the same
  device-only state after server and screen state have clear owners.

## 3. Make tests cover the running experience

- [ ] Verify live Supabase access policies against a disposable local database
  after the database setup sequence is validated. The browser fixture covers
  concurrent local test users but cannot certify database row security.
- [ ] Add repeatable phone-size browser checks for dashboard, Review,
  onboarding, and settings, including empty and populated states. Inspect each
  image before accepting a baseline. Check changed motion on an Android phone.
- [ ] Replace source-text assertions for web behavior with rendered component
  tests as those features change. Keep source checks for Java/web parity and
  build wiring that cannot run in Vitest.

## 4. Keep the design consistent

- [ ] Inventory repeated button, sheet, and motion values. Centralize a value
  only after comparing its current rendered uses in light and dark mode.
- [ ] Apply one accessible dialog and sheet interaction pattern across the
  remaining overlays: initial focus, Escape, focus return, scroll locking,
  reduced motion, and keyboard-safe layout. Check the affected flow on a phone.
- [ ] Review dependencies and build tools periodically. Check the current
  stable version, license, and installation audit before adding a package.
