# Lint checks

Covault runs ESLint in `npm run verify` and in both Android build workflows.
The lint command permits no warnings, so a recommended rule set's warnings
also fail verification. The Claude Code Stop hook fixes and checks the files
changed during a turn.

| Code | Checks |
| --- | --- |
| JavaScript and TypeScript | ESLint recommended rules, TypeScript syntax and unused variables, Unicorn correctness rules |
| React components | React recommended rules, hook call order and effect dependencies, hot-reload exports |
| React Query | TanStack Query recommended rules for query dependencies and stable cache usage |
| Accessible controls | JSX accessibility rules, with `NumericFormat` treated as an input |
| Tailwind classes | Unknown classes and contradictory classes |
| Vitest tests in `Tests` | Valid assertions, missing assertions and focused tests |
| Component tests | Testing Library recommended React rules, including awaited user events and queries, accessible queries, and no side effects inside retrying assertions |
| Browser tests in `e2e` | Playwright recommended rules, plus awaited page and locator actions; focused tests, fixed sleeps and forced actions fail lint |
| Runtime validation in `App/Lib/Transactions/Validation`, plus `app/lib/money/manualAmount.ts` | Type-aware TypeScript rules for unchecked values and promises, unsafe casts, exhaustive switches, explicit `any`, and type-only imports |
| Shared controls | Database and native-plugin imports are forbidden; native buttons need an explicit type |
| Feature imports | Cross-feature runtime imports use public entries; same-feature siblings, type-only imports and the narrow lazy chart entry remain allowed |
| Dashboard and Review components | Direct Supabase imports are forbidden; use their data hooks and actions |

Component tests mount through `test/renderWithProviders.tsx`. Importing the
bare Testing Library `render` in a component test fails lint. The Testing
Library plugin recognizes this provider helper without mistaking ReactDOM's
`root.render` for a Testing Library call.

`test/__tests__/regressions/lintEnforcement.test.ts` runs invalid and valid examples through
the real ESLint configuration. It checks that browser waits, component user
events, unsafe validation casts, lost validation promises and shared-control
imports are actually rejected. It also checks React, accessibility, conditional
hooks and missing effect dependencies with rejected and accepted examples.

## Tooling upgrades

ESLint 10 uses the official `@eslint/compat` adapter for the React and JSX
accessibility plugins, which still declare older ESLint peer ranges and use
removed APIs. Only those plugins are adapted. Unicorn's current rules run
directly. The committed `.npmrc` makes ordinary local and CI installations use
the same peer-resolution setting; it does not establish compatibility by
itself. The real rule probes above verify the checks the app relies on.

`.eslint/unicorn-baseline.js` records the previously reviewed Unicorn 65 rule
selection while the installed plugin supplies the latest implementations.
It contains configuration data, not an older plugin dependency. New recommended
rules are reviewed separately instead of silently changing the application's
naming, formatting or control-flow policy during a package upgrade. The two
expanded guard-format rules remain disabled for the reasons documented in
`eslint.config.js`; correctness, promise, validation and import checks remain
enforced.

React Hooks retains hook-order and effect-dependency checks. Its newer React
Compiler migration diagnostics are not enabled because this application does
not use that compiler. Introducing it and its additional checks is a separate
change. TypeScript remains on 5.8 as requested; its proposed 7.x upgrade is
deferred.

## Limits

Lint does not prove that a schema checks the right business rules. Validation
tests must supply accepted and rejected inputs and check the saved result.
It also does not prove that a control is usable on a phone or that the live
database's access rules are correct.

Legacy application code keeps its existing TypeScript lint settings. The
new type-aware rules apply to the validation boundary, rather than reporting
every existing untyped database row at once. Existing accessibility exceptions
for dismissing backdrops and deliberately focused inputs remain documented in
`eslint.config.js`.

ESLint does not inspect the custom Java, SQL, Python or shell sources. Android
compilation and the repository's native mirror tests cover different failures.
Database setup checks are described in `DATABASE_SETUP.md`; none of these
checks should be described as Java or SQL lint.

## New plugin versions

The added plugins are pinned to the stable versions checked on 2026-10-03:

- `eslint-plugin-playwright` 2.12.0, MIT. See its [official repository](https://github.com/mskelton/eslint-plugin-playwright).
- `eslint-plugin-testing-library` 7.16.2, MIT. See its [official repository](https://github.com/testing-library/eslint-plugin-testing-library).

Their npm metadata and licenses at the matching Git tags were checked before
installation. After the Tailwind 4 migration and the 2026-10-04 development-tool
upgrade, both the full and production-only npm audits report zero known
vulnerabilities. The compatibility adapter is `@eslint/compat` 2.1.1,
[Apache-2.0](https://github.com/eslint/rewrite/blob/main/LICENSE).
Audit results can change as new advisories are published. The existing plugin
peer-range limitations still need the actual rule checks described above.
