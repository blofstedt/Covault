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
| Vitest tests in `__tests__` | Valid assertions, missing assertions and focused tests |
| Component tests | Testing Library recommended React rules, including awaited user events and queries, accessible queries, and no side effects inside retrying assertions |
| Browser tests in `e2e` | Playwright recommended rules, plus awaited page and locator actions; focused tests, fixed sleeps and forced actions fail lint |
| Runtime validation in `lib/validation`, plus `lib/manualAmount.ts` | Type-aware TypeScript rules for unchecked values and promises, unsafe casts, exhaustive switches, explicit `any`, and type-only imports |
| Shared controls | Database and native-plugin imports are forbidden; native buttons need an explicit type |
| Dashboard and Review components | Direct Supabase imports are forbidden; use their data hooks and actions |

Component tests mount through `test/renderWithProviders.tsx`. Importing the
bare Testing Library `render` in a component test fails lint. The Testing
Library plugin recognizes this provider helper without mistaking ReactDOM's
`root.render` for a Testing Library call.

`lib/__tests__/lintEnforcement.test.ts` runs invalid and valid examples through
the real ESLint configuration. It checks that browser waits, component user
events, unsafe validation casts, lost validation promises and shared-control
imports are actually rejected.

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
installation. The installation audit still reports the same six existing high
severity findings in the Tailwind 3 build-tool chain. The production-only audit
reports no known vulnerabilities. These checks do not establish a clean full
dependency audit.
