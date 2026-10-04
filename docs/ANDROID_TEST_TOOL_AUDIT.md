# Android test tool audit

Checked on 2026-10-04. This is a recorded audit result, not a claim that the
toolchain has no vulnerabilities.

## Application dependencies

This change adds no npm application dependencies and leaves the lockfile
unchanged. The current main lockfile has six high-severity findings in the
Tailwind 3 development-tool dependency chain. The separate Tailwind 4 upgrade
in [PR 320](https://github.com/blofstedt/Covault/pull/320) addresses that chain.
This Android testing PR does not merge that upgrade.

## Android test libraries

The exact latest stable AndroidX versions, their Apache-2.0 licenses and direct
OSV query results are documented in [the native test README](../test/android/README.md).
Those direct queries found no known advisories. The full resolved Gradle
transitive dependency tree has not been audited.

## Maestro

The installer pins the latest stable [Maestro CLI 2.11.0](https://github.com/mobile-dev-inc/Maestro/releases/tag/cli-2.11.0)
and verifies its published SHA256. Maestro uses Apache-2.0. It runs locally on
the GitHub runner, without Maestro Cloud, credentials or a paid plan.

A scan of the distribution's embedded Maven metadata identified 70 coordinates
among 194 JAR files. An [OSV](https://osv.dev/) batch query matched 61 unique
advisory IDs across 16 coordinates, including one critical, 24 high, 34 moderate
and two low findings. Metadata scanning does not cover every JAR or establish
whether an advisory is exploitable through these test commands. It is also not
a clean audit.

Affected embedded libraries include Netty 4.1.111.Final, Jackson 2.17.1,
Protobuf 3.21.9 and Commons Compress 1.21. The critical match is
[Netty's TLS SNI fallback routing advisory](https://github.com/netty/netty/security/advisories/GHSA-c4c3-7fpv-j4q5).
No unofficial dependency replacements or older releases were installed.

## GitHub actions

Actions use immutable release commit SHAs. Their current release package-lock
audits also contain known findings: checkout reports one high, setup-node two
high, setup-java two high, upload-artifact five high, and emulator-runner three
moderate findings. setup-android reports none. These counts include the upstream
lockfile's dependency tree and do not establish that every affected package is
present in the action's bundled runtime.

The official source repositories are [checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node),
[setup-java](https://github.com/actions/setup-java),
[upload-artifact](https://github.com/actions/upload-artifact),
[emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner),
and [setup-android](https://github.com/android-actions/setup-android).

## Execution boundary

The new workflow has read-only repository permissions, does not persist Git
credentials and does not receive production secrets. It installs a separate,
test-only app and bank helper on a fresh emulator. Tests use a synthetic local
vault. Airplane mode and disabled Wi-Fi/data prevent external device traffic
during app tests. Artifacts contain only test data and expire after three days.

These choices limit access and exposure. They do not remove the upstream audit
findings. Physical-device services, production login, actual bank apps and live
household data are outside this workflow.
