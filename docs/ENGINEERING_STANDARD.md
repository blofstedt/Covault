# Engineering standard for Covault

This guide is for an agent changing Covault. Read `CLAUDE.md` first for the app's
specific failure history. Use this guide to make new work consistent and easier to
verify. Existing code is evidence of current behavior, not a model to copy in every
detail.

## What the reference projects teach

| Reference | Pattern to use here | Boundary |
| --- | --- | --- |
| `sender-ui/src/app/new` | Keep a redesigned area on one set of semantic style values and shared controls. Put response parsing at the data boundary. Mount component tests with shared app providers, local controlled-state harnesses, user actions, and accessibility checks. | Covault uses Tailwind, not Material UI. Copy the ownership and test structure, not the theme API or company terminology. |
| `shinier-mock-server/packages/libs/mock-server` | Make runtime state explicit, create it per test, and test behavior through the public boundary. Keep transport details out of product decisions. | Covault has no Express server. Apply this to Supabase and native adapters rather than copying routes or recipes. |
| `claude-plugin-marketplace` | Keep agent guidance short, route to focused references, and enforce mechanical rules with checks. Validate live artifacts rather than trusting documentation alone. | Plugin packaging, release rules, and OneSpan setup do not belong here. |
| `frontend-tools` | Give tests temporary resources and stub external commands or services. Clean up after each test and state exactly which platforms were exercised. | Its CLI and operating system setup are unrelated to the budget app. |

The examples are useful because they express decisions in code and tests. They are
not templates for new dependencies or a reason to rebuild working features.
Sender UI's visual Playwright configuration sets one worker because its mock
server uses a fixed account. That is evidence of a state leak risk, not a pattern
to carry into Covault.

## Current Covault starting point

`lib/notificationProcessor.ts`, `lib/hooks/useDataLoading.ts`, and
`components/Dashboard.tsx` carry several decisions each. Split them only while
changing a real behavior, with a test at the public boundary first. Many current
Vitest files inspect source text. Preserve the ones that protect Java/web parity
or build wiring; replace a source assertion with a behavior check when working
on that feature. There is no authenticated browser test fixture yet, so browser
coverage currently stops at the sign-in screen.

## Contract for each change

1. State the user-visible behavior and its failure cost before editing. A missed
   purchase, a wrong balance, a hidden error, and a visual mismatch need different
   checks.
2. Find the owner of the behavior. Keep a screen, its small controls, data
   operations, and tests close together when changing that feature. Put a control
   in `components/ui` or `components/shared` only after two real uses show the
   same behavior and appearance.
3. Keep boundaries explicit. A component asks for a domain operation such as
   saving a budget limit. The data layer owns table names, request shapes, schema
   fallbacks, and response validation. Treat a failed read separately from an
   empty result. A failed write must be visible and must not leave an unsaved
   choice looking saved.
4. Put state with its owner. A form draft and an open sheet belong to the screen.
   Supabase owns saved household data. Device storage owns phone choices. Use
   React Query for a server read only after checking its stale-answer, failed-read,
   sign-out, and first-paint behavior. Add a client state library only for a
   demonstrated need shared by unrelated screens.
5. Parse untrusted input once at entry. This includes notification text, native
   plugin payloads, stored JSON, and Supabase responses. Give the rest of the
   feature a typed value. Do not replace runtime checks with a TypeScript cast.
   Model distinct states explicitly when optional fields permit contradictory
   combinations.
6. Record which behavior checks passed. A typecheck, a browser screenshot, and
   an Android phone check prove different things. Say what remains unverified.

## Visual and interaction rules

- Reuse `lib/budgetColors.ts`, `getBudgetIcon`, and the existing cards and controls.
  `components/shared/cardSurface.ts` owns the common surface used by ordinary
  cards and Review cards; their variant borders remain with each component.
  Choose a new color or component variant centrally before using it on a screen.
  Keep light and dark appearances paired.
- Give every part of one gesture the same duration and easing. The budget expand
  uses 320 ms and `cubic-bezier(0.32, 0.72, 0.24, 1)`. Other interactions may
  differ, but their moving parts must share a clock. Respect reduced motion.
- Check a narrow phone, larger text, the safe area, the keyboard, and focus
  movement for a changed sheet or form. A modal must receive initial focus,
  close with Escape where a keyboard exists, and return focus to its trigger.
- Measure motion on an Android WebView before calling it smooth. A desktop
  screenshot cannot show frame drops, and the app's CI never opens the screen.

## Test layers

| Risk | First check | Additional check |
| --- | --- | --- |
| Pure money, date, matching, or capture rule | Vitest calls the exported behavior with examples that could occur in a household. Include a case that must be rejected. | Test the joined capture or save flow when separate decisions could disagree. |
| Data boundary or saved choice | Vitest uses a fresh fake client for each test and checks success, empty result, failure, and two quick writes where order matters. | Browser test when the UI can show a false saved state. |
| Screen behavior and accessibility | Component test for visible state and user action. | Playwright for layout, focus, navigation, browser APIs, or screenshot comparison. |
| Native listener, widget, or update | Keep a focused parity or build-wiring check where Java cannot run in Vitest. | Exercise the changed path on an Android device. |

Use one test's own data for each Vitest case. Reset fake clocks, mocks, module
caches, and temporary files after it. Prefer the real domain function over a test
that searches source text. Keep source checks only for a real cross-language or
build contract. Do not raise a coverage number by testing constants or mirroring
an implementation.

Component tests use `test/renderWithProviders.tsx`. It mounts the same query
client as the app and clears that cache and the rendered DOM after each test.
Keep a small controlled-state harness beside the test when a parent screen owns
the value under test. Use Testing Library actions and visible results, and scan
changed dialog semantics with axe. Direct `render` imports in component test
files fail lint so new tests follow the same setup.

Two current examples set the bar for changing tests. The behavioral cases in
`lib/__tests__/reviewRulesQuery.test.ts` show that a failed read retains cached
rules. Its source checks for the Review button and root provider should become
rendered interaction checks once an isolated authenticated UI fixture exists.
`lib/__tests__/budgetExpandHotPath.test.ts` guards a real Android performance
failure, but its source checks do not measure frames. Keep those checks until a
phone measurement can replace them; do not call a passing regex a smooth
animation.

### Browser test isolation contract

The browser suite must be able to run with multiple workers. A green serial run
does not establish that. Before adding authenticated browser tests:

1. Provide a test-only backend or disposable Supabase project. The normal suite
   must never read or mutate a household's live vault. Each test creates its own
   user, vault, and records, or receives a unique namespace that all server state
   uses. A fixed shared account is incompatible with parallel writes.
2. Use a fresh browser context per test. Do not share local storage, cookies,
   IndexedDB, or a signed-in page across tests. Give each test its own clock and
   generated output path. Seed through a fixture before navigation, then remove
   that fixture's server state during teardown.
3. Route every test dependency through the same fixture. A mock response for one
   endpoint while another request reaches live Supabase is an unsafe partial
   test. Unexpected network requests must fail the test.
4. Run two tests that create the same kind of record concurrently, then repeat
   the suite with multiple workers and in a different order. Confirm that each
   test sees only its own data. Keep parallel mode enabled after this proof.
5. Use stable roles and accessible names for actions. Use a dedicated test ID
   when repeated controls make a locator ambiguous. Freeze time and disable
   motion for deterministic screenshots; inspect the image before accepting a
   baseline. A browser screenshot does not certify Android motion.

`e2e/auth-theme.e2e.ts` is the first parallel browser check. It runs the sign-in
screen with Supabase disabled and proves separate browser storage. Run it with
`./node_modules/.bin/playwright test --workers=2`. It does not cover an
authenticated vault or server-side data isolation. Build the disposable backend
fixture described above before adding those flows. `npm run verify` does not run
Playwright.

## Checks that should become automatic

The current `eslint.config.js` already checks React hooks, accessibility, query
usage, Tailwind class names, and Vitest tests. Keep exceptions narrow and explain
them beside the rule. The shared UI layer now forbids direct Supabase and native
plugin imports; extend this boundary to new feature directories as they appear.

Add stricter rules in verified steps rather than switching them on globally and
burying useful findings under old violations. The next candidates are type-aware
promise handling, consistent type imports, unnecessary casts, exhaustive variants,
and unused suppression cleanup. For each rule, inspect current violations, fix
safe ones, document any behavior-sensitive exception, and make the final lint
gate fail on new violations. Avoid large generated suppression files that need
regeneration whenever another branch merges.

Keep `npm run verify` as the pre-push gate. It checks TypeScript, ESLint, Vitest,
and the web build. For a visual or native change, add the relevant running-app or
phone check and report its result separately. When adding a dependency, verify
the current stable release, license, and installation audit against authoritative
sources before committing it.
