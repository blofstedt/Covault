# GitHub Actions dependency audit

Checked on 2026-10-04 for PR 310. All workflow actions use immutable commit
SHAs from their latest stable official releases. Existing job permissions,
release conditions, artifact names and paths are unchanged.

## Releases and licenses

Release tags and their commit SHAs were checked through the official GitHub
API. Licenses were read at those release tags. These are free software
licenses, with no paid action subscription required.

| Action | Stable release | Commit SHA | License |
| --- | --- | --- | --- |
| checkout | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) | `3d3c42e5aac5ba805825da76410c181273ba90b1` | [MIT](https://github.com/actions/checkout/blob/v7.0.1/LICENSE) |
| setup-node | [v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0) | `820762786026740c76f36085b0efc47a31fe5020` | [MIT](https://github.com/actions/setup-node/blob/v7.0.0/LICENSE) |
| setup-java | [v6.0.1](https://github.com/actions/setup-java/releases/tag/v6.0.1) | `de7274f081f381c8f8158605e0321c36c376e2e6` | [MIT](https://github.com/actions/setup-java/blob/v6.0.1/LICENSE) |
| setup-android | [v4.0.4](https://github.com/android-actions/setup-android/releases/tag/v4.0.4) | `be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd` | [MIT](https://github.com/android-actions/setup-android/blob/v4.0.4/LICENSE) |
| cache | [v6.1.0](https://github.com/actions/cache/releases/tag/v6.1.0) | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | [MIT](https://github.com/actions/cache/blob/v6.1.0/LICENSE) |
| upload-artifact | [v7.0.1](https://github.com/actions/upload-artifact/releases/tag/v7.0.1) | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | [MIT](https://github.com/actions/upload-artifact/blob/v7.0.1/LICENSE) |
| download-artifact | [v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1) | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` | [MIT](https://github.com/actions/download-artifact/blob/v8.0.1/LICENSE) |
| android-emulator-runner | [v2.38.0](https://github.com/ReactiveCircus/android-emulator-runner/releases/tag/v2.38.0) | `a421e43855164a8197daf9d8d40fe71c6996bb0d` | [Apache-2.0](https://github.com/ReactiveCircus/android-emulator-runner/blob/v2.38.0/LICENSE) |

All eight action manifests use Node 24 internally. That runtime is separate
from the application's selected Node version. These workflows use GitHub's
standard hosted Ubuntu runners; execution of the refreshed pins still needs
the PR's CI result.

## Audit results

The official release `package.json` and `package-lock.json` files were copied
to disposable directories and checked with npm audit against the public npm
registry, both with and without development dependencies. No upstream packages
were installed and no upstream scripts were run. Counts below are affected npm
packages, including findings inherited through dependencies, not unique
advisory IDs.

| Action | Full lock findings | Runtime lock findings |
| --- | ---: | --- |
| checkout | 35 | 1 high |
| setup-node | 5 | 2 high |
| setup-java | 2 | 2 high |
| setup-android | 3 | 0 |
| cache | 18 | 2 high |
| upload-artifact | 42 | 5 high |
| download-artifact | 44 | 5 high, 1 critical |
| android-emulator-runner | 40 | 3 moderate |

The application's separate npm audit reports **zero findings**. This change
adds no application packages and does not change its lockfile. The earlier
[Android test tool audit](ANDROID_TEST_TOOL_AUDIT.md) records the application
dependency state at the time that testing change was prepared.

The upstream action audits are not clean. Key affected runtime packages include:

- `undici` in checkout, setup-node, setup-java, cache and both artifact actions.
  Examples include [response splitting](https://github.com/advisories/GHSA-r53p-7pc4-xj5r)
  and [WebSocket decompression denial of service](https://github.com/advisories/GHSA-3wwx-pv8p-q78v).
- `brace-expansion` in setup-node, setup-java, cache and both artifact actions,
  including [quadratic expansion](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr).
  download-artifact also includes
  [@isaacs/brace-expansion resource consumption](https://github.com/advisories/GHSA-7h2j-956f-4vf2).
- `fast-xml-parser` in both artifact actions. download-artifact's 5.3.4 lock
  includes the critical
  [DOCTYPE entity-name encoding bypass](https://github.com/advisories/GHSA-m7jm-9gc2-mpf2).
  Other findings include
  [entity expansion](https://github.com/advisories/GHSA-8gc5-j5rx-235r)
  and [XML comment/CDATA injection](https://github.com/advisories/GHSA-gh4j-gqv2-49f6).
  upload-artifact also includes a
  [fast-xml-builder XML injection](https://github.com/advisories/GHSA-5wm8-gmm8-39j9).
- `lodash` in both artifact actions, including
  [template imports code injection](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)
  and [prototype pollution](https://github.com/advisories/GHSA-f23m-r3pf-42rh).
- `minimatch` in download-artifact, including
  [glob matching denial of service](https://github.com/advisories/GHSA-7r86-cg39-jmmj).
- `uuid` in android-emulator-runner's action dependencies, including
  [missing buffer bounds checks](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

These are lockfile matches. They do not prove that every affected dependency
is included in the bundled JavaScript or that a workflow input reaches an
affected operation. No exploitation or bundled-code reachability review was
performed. Development-only findings are included in the full counts because
they matter when building the upstream actions; Covault runs their published
bundles instead.

## Permissions and remaining verification

Validation jobs retain read-only repository permissions. Only the main-branch
push release job has repository write access, and it downloads the release
artifact produced by the build it depends on. Pull requests cannot publish an
app release. The regression test checks that upload/download relationship and
the existing event and permission restrictions without pinning a particular
action version.

Immutable SHAs prevent release tags from silently moving; they do not fix
known upstream dependency findings. Latest stable vendor releases are retained
without unofficial dependency overrides. Actual hosted-runner artifact transfer,
Android builds and release publishing require CI verification. This update has
not been tested on a physical phone or against the live household database.
