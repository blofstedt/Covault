# Production dependency update

Verified on 2026-10-04 against each package's official npm registry `latest`
tag and published licence metadata. All 20 direct production dependencies in
the lockfile resolve to their latest stable releases. No prereleases or paid
licences were selected.

The updates proposed by Dependabot and the newer stable patches are:

| Package | Resolved version | Licence |
| --- | --- | --- |
| `@aparajita/capacitor-biometric-auth` | 10.0.0 | MIT |
| `@capacitor/android`, `@capacitor/core`, `@capacitor/cli` | 8.5.2 | MIT |
| `@capacitor/app` | 8.1.2 | MIT |
| `@capacitor/browser` | 8.0.5 | MIT |
| `@capacitor/filesystem` | 8.1.4 | MIT |
| `@capacitor/local-notifications` | 8.3.1 | MIT |
| `@capacitor/share` | 8.0.3 | MIT |
| `@sentry/react` | 11.4.0 | MIT |
| `@supabase/supabase-js` | 2.117.2 | MIT |
| `@tanstack/react-query` | 5.104.1 | MIT |
| `react`, `react-dom` | 19.3.0 | MIT |
| `@types/react`, `@types/react-dom` | 19.3.0 | MIT |

The unchanged runtime dependencies were checked too. Transformers is Apache
2.0, D3 is ISC, and the remaining runtime packages are MIT. The npm registry
publishes the version, licence and integrity for each release, for example
[Sentry 11.4.0](https://registry.npmjs.org/@sentry%2freact/11.4.0),
[biometric auth 10.0.0](https://registry.npmjs.org/@aparajita%2fcapacitor-biometric-auth/10.0.0)
and [Capacitor 8.5.2](https://registry.npmjs.org/@capacitor%2fcore/8.5.2).

## Crash-report privacy

[Sentry's v11 migration guide](https://github.com/getsentry/sentry-javascript/blob/11.4.0/MIGRATION.md)
replaces `sendDefaultPii` with more permissive `dataCollection` defaults. The
app explicitly disables personal information, cookies, headers, request and
response bodies, query parameters, AI inputs and outputs, database query data,
queue data, GraphQL contents and stack-frame variables. Its existing final
checks still strip personal fields and PostgREST query strings from errors.

Console breadcrumbs now have a separate default integration. The app excludes
that integration and retains the final console-breadcrumb rejection. Screen
replay and performance tracing remain disabled.

The privacy tests initialize the actual React SDK through the app's reporter,
then intercept only transport delivery. They inspect the finished reports
offered for sending, including Sentry's instruction to never infer an IP
address. They prove that useful errors, anonymous account identity and build
numbers survive, while personal fields, purchase details and console output
are removed. They use a disposable local endpoint, not a Sentry account.
Deliberately re-enabling IP collection or the console integration makes these
tests fail.

## Native compatibility and the UUID advisory

[Biometric auth 10's release notes](https://github.com/aparajita/capacitor-biometric-auth/blob/v10.0.0/CHANGELOG.md)
identify Capacitor 8 as its major upgrade. It replaces the nested Capacitor 7
packages that version 9 installed. Published API definitions are unchanged
between 9.1.2 and 10.0.0. Its Android module uses SDK 36, a minimum of 24, Java
21 and Android Gradle Plugin 8.13.2, matching the existing Capacitor 8 build.
The app currently makes no calls to this biometric plugin.

Capacitor CLI 8.5.2 includes Xcode 3.0.1, whose UUID 7 dependency is flagged by
[GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).
A narrow override supplies the latest stable
[UUID 14.0.2](https://github.com/uuidjs/uuid/releases/tag/v14.0.2), verified
against its published integrity and [MIT licence](https://github.com/uuidjs/uuid/blob/v14.0.2/LICENSE.md).
Xcode's only UUID operation uses `v4`, which this version retains.

UUID 14 is an ES module. Node's
[CommonJS compatibility support](https://nodejs.org/docs/latest-v22.x/api/modules.html#loading-ecmascript-modules-using-require)
allows that import without a flag from Node 22.12. The actual Xcode helper
generated 1,000 distinct valid project identifiers and Capacitor CLI loaded
successfully under verified Node 22.23.3 and local Node 26.10.0. Capacitor was
not downgraded.

The initial locked audit reported three moderate entries for the UUID issue
and its Xcode/Capacitor CLI parents. The final full npm audit reports zero
known vulnerabilities. This does not audit native Maven dependencies or prove
real sign-in, real database writes or physical-phone behavior.
