# Android emulator tests

The **Android emulator checks** workflow installs a separate Covault test APK
on an Android 16 emulator, API 36. It runs native notification tests, then Maestro
flows against the app's actual installed WebView. It uses synthetic account
and household data, with no Supabase credentials or real bank account.

## What runs

| Check | Behavior exercised |
| --- | --- |
| Native instrumentation | Genuine Android bank notifications, durable capture, notification permission and source filtering, listener reconnect, and widget totals. See [native test details](../android-test/README.md). |
| Manual entry | Seeded dashboard row; invalid keyboard text and zero cannot be saved; Enter advances to the vendor; a $12.34 Groceries entry saves; restarting the app preserves it; its editor reopens; Android Back closes it. |
| Notification Review | A helper app posts a real $12.34 Second Cup notification through Android; the app shows one captured row in Review; reopening preserves one row; the editor shows the captured vendor and amount. |

These are test expectations, not a report that a particular run passed. Check
the workflow result and its artifacts for execution evidence. Setup failures
are reported separately from tests that ran.

## Run locally

Use a disposable worktree and emulator. This builds into the generated
`android/` and `dist/` directories, changes the emulator's network and test-app
permissions, and clears the test app's data. It does not stop other processes
or reset the normal Covault app.

Prerequisites: installed repository dependencies, Node 24, Java 21, Python
3.11 or newer, `curl`, `unzip`, Android SDK command-line tools, and a running
Android 16 emulator, API 36. Attach exactly one emulator and no physical device. The
runner refuses other device configurations. The workflow creates its own
Pixel 7 emulator; a local run uses the emulator you already started.

From the repository root:

```sh
bash scripts/build-android-test.sh
(cd android && ./gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest :fake-bank:assembleDebug)

task_maestro_workspace="$(mktemp -d "${TMPDIR:-/tmp}/covault-maestro.XXXXXX")"
bash scripts/install-maestro.sh "$task_maestro_workspace/cli"
PATH="$task_maestro_workspace/cli/bin:$PATH" \
  XDG_STATE_HOME="$task_maestro_workspace/state" \
  ANDROID_SERIAL=emulator-5554 \
  bash scripts/run-android-emulator-tests.sh
```

Replace the serial with the one shown by `adb devices`. The CLI installer
verifies the pinned Maestro 2.11.0 archive checksum and refuses to overwrite
an existing installation. It does not change shell profiles or require a
Maestro Cloud account.

The runner installs the app, instrumentation and fake-bank APKs, puts the
emulator offline, runs the native tests, clears the test app, then restores its
native bank selection and notification access before running the UI flows.
It posts the bank alert between the two flows. Leave `clearState` out of the
flows: it would erase the runner's native setup.

Afterward, the emulator stays offline with the test apps installed. Restore
its network through the emulator settings or discard this disposable device.
Do not use this runner on a device whose state you need to preserve.

## Post a genuine bank notification manually

After the runner has configured the test app, post another real OS alert with:

```sh
ANDROID_SERIAL=emulator-5554 adb shell am broadcast --include-stopped-packages \
  -n com.covault.fakebank/.BankNotificationReceiver \
  -a com.covault.fakebank.POST --es scenario purchase --ei id 701
```

The helper posts **Covault CI Bank** with the body "You made a purchase at
SECOND CUP for $12.34." Covault normalizes the vendor to **Second Cup**. This
goes through Android's notification listener; it does not inject a transaction
directly into the WebView.

Use a new notification ID for a new alert. Reusing an ID replaces the same
helper notification. The [native runbook](../android-test/README.md) explains
the other scenarios, permissions and safe preference seeding.

## Read the results

GitHub uploads `android-emulator-results-<run id>-<attempt>` even when a step
fails, retaining it for three days. Local results default to
`android-e2e-results/`:

- `run-state.txt` names the last stage and its exit status.
- `reports/` contains native and Maestro JUnit reports, native HTML reports,
  and an orchestration report. A setup failure has a separate not-started report.
- `logs/` contains build and flow output, logcat, crash logs, notification
  state, and WebView/device versions where available.
- `screenshots/` contains device captures after native tests, after manual
  entry, and at exit. The flows also capture the completed manual form, its
  reopened editor, and the notification Review screen.
- `maestro/` contains each flow's command output and failure artifacts.

The flows use Maestro's Android WebView devtools hierarchy. In the pinned CLI,
HTML IDs and then accessible labels become resource IDs; visible text remains
a text selector. CSS selectors are for web tests, not these native flows.
See [Maestro's WebView guidance](https://docs.maestro.dev/extra-materials/troubleshooting/known-issues)
and [selector reference](https://docs.maestro.dev/reference/selectors/core-selectors).
If a selector fails, inspect the captured hierarchy and screenshot before
changing the expected behavior.

## Isolation and limits

The test build requires both Android test mode and an explicit opt-in. Its
bootstrap supplies only a synthetic session and a local persistent fake
backend. Other external requests are refused, and the runner disables device
networking. The APK uses `com.covault.app.test`, a separate deep-link scheme,
the **Covault CI** name and Android's `testOnly` flag. The fake bank is
`com.covault.fakebank`. Normal builds do not include this bootstrap, helper or
instrumentation. Do not publish these APKs as app updates.

Passing these checks does not verify Google sign-in, real Supabase or database
security rules, actual bank formats, clipboard paste, OEM background/battery
policies, or a physical phone. Widget tests check native data and totals, not
launcher placement or bitmap appearance. Screenshots show specific emulator
states; they do not prove animation smoothness, refresh-rate performance,
every keyboard, or every screen size. Native “unopened app” tests run in an
instrumentation process and do not claim force-stop or process-death recovery.

The [test tool audit](ANDROID_TEST_TOOL_AUDIT.md) records known upstream
vulnerabilities and audit gaps. Passing functional tests is not a clean audit.

## Cost

This workflow uses a standard GitHub-hosted runner and the local Maestro CLI,
without a paid device service or Maestro Cloud. Standard runner usage is free
for public repositories; private repositories and artifact storage have their
own allowances. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
Maestro's CLI is [Apache-2.0 licensed](https://github.com/mobile-dev-inc/Maestro/blob/cli-2.11.0/LICENSE).

A paid physical-device service, such as
[AWS Device Farm](https://aws.amazon.com/device-farm/pricing/), is an optional
later step for device-specific evidence. It is not required or configured by
this workflow.
