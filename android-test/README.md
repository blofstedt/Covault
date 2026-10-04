# Genuine Android notification tests

This folder is copied into a disposable generated Android project only by
`scripts/prepare-android-tests.sh`. Normal APK builds do not contain the helper,
instrumentation or fake data. The app APK uses `com.covault.app.test`, is labelled
Covault CI, has a separate deep-link scheme and is marked `testOnly`. Install
all three APKs with `adb install -t`. The instrumentation APK has its own
explicit test-only manifest, as that flag is not inherited from the target app.
Do not publish these APKs as app updates.

## Build and run

Run the normal Capacitor add/sync and `scripts/sync-android.sh` first. Then run
`scripts/prepare-android-tests.sh`. It is repeatable and requires the production
NotificationListener to have been copied. From the generated Android folder,
build `:app:assembleDebug :app:assembleDebugAndroidTest :fake-bank:assembleDebug` and run
`:app:connectedDebugAndroidTest` on an isolated API 35 or newer emulator.

The files are:

- App: `android/app/build/outputs/apk/debug/app-debug.apk`.
- Tests: `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`.
- Bank: `android/fake-bank/build/outputs/apk/debug/fake-bank-debug.apk`.
- Runner: `com.covault.app.test.test/androidx.test.runner.AndroidJUnitRunner`.
- Normal JUnit XML: `android/app/build/outputs/androidTest-results/connected/`.

The tests grant their required notification permissions and listener access,
then restore posting permission, disconnect the listener and clean up their
alerts and test preferences. They refuse to run against a different app ID or
version. They require no backend, login, HTTP server or actual banking app.
The runner selects `com.covault.app.NativeCaptureTest` explicitly so Capacitor's
generated sample test is excluded. The blocked-notification case revokes the
actual runtime grant through Android's no-kill notification permission test API,
as the platform's own CTS tests do. The [Android 16 permission API](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/core/java/android/permission/PermissionManager.java)
defines that hook; the [instrumentation launcher](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android16-release/cmds/am/src/com/android/commands/am/Instrument.java)
permits test APIs by default.
The case fails explicitly if that hook is unavailable; it never substitutes an
AppOps setting or skips the denied-permission assertions.

## Post a real bank alert with ADB

The helper has the application ID `com.covault.fakebank`. Its exported receiver
posts through Android's NotificationManager. It never calls Covault directly.

After installing the APKs, use `android-test/configure-device.sh permissions`
to grant both apps posting permission and grant the test app listener access.
ADB respects `ANDROID_SERIAL`. The optional `ADB` variable selects a binary.

Post the standard purchase with:

```sh
adb shell am broadcast --include-stopped-packages \
  -n com.covault.fakebank/.BankNotificationReceiver \
  -a com.covault.fakebank.POST --es scenario purchase --ei id 701
```

It posts title `Covault CI Bank` and body `You made a purchase at SECOND CUP for
$12.34.` The native capture vendor is `SECOND CUP`; the app tidies it to
`Second Cup`. No taught rule means it waits in Review.

Supported `scenario` values are `purchase`, `income`, `declined` and `hold`.
Optional string extras `amount` and `vendor` replace `12.34` and `SECOND CUP`.
An amount must have exactly two decimal places. Each `id` is a separate Android
notification; reusing it replaces that helper alert. Commands return result 0
on success and result 1 with a reason on failure. Missing posting permission
fails explicitly.

The same receiver accepts `com.covault.fakebank.CANCEL_ALL` to clear its alerts
and `com.covault.fakebank.INSPECT` to return its actual active notifications in
the ordered broadcast result extra `notifications`. Instrumentation reads that
result to check whether Covault removed the original.

For a fresh UI test, `android-test/configure-device.sh seed` also seeds the
native chosen-source preferences using `run-as` in the separate test app. Run
it after `pm clear`, before launching the Activity or enabling a listener that
starts the app process. It refuses to overwrite preferences in a running app.
Any later Maestro `clearState` removes this seed, so seed after the last clear.
The authenticated test bootstrap also keeps the web selection aligned.

## What the native tests prove

- A live purchase is in the actual on-disk queue before its original bank alert
  disappears, and the replacement notification has the correct amount and
  merchant. Draining that queue returns the purchase once and clears disk.
- Blocking Covault's posting permission keeps the bank alert while still
  saving the capture. Restoring permission allows a later purchase to be
  replaced safely.
- A source the user disabled leaves its alert alone, produces no queued
  capture and does not increase the widget's spending. Re-enabling it works.
- Income and declined payments reach the durable queue quietly for web
  classification, preserve the original alerts and do not change widget
  spending. A completed purchase does change spending.
- Disconnecting and reconnecting the OS listener rescans the original without
  posting another replacement or counting the expense twice on the widget.
  The native queue deliberately contains live and scan records, which the web
  pipeline deduplicates. The test does not claim to verify web deduplication.

The Activity and WebView are never opened by these native tests. They run in
the app's instrumentation process, so "unopened" does not mean a killed process
or force-stopped app. They verify durable disk bytes and service reconnection,
not process-death recovery. Separate Maestro flows check app reopen and the
WebView handoff. Force-stop is a different Android state and capture during it
is not an expectation.

The widget assertions check the native snapshot and merged totals used by its
renderer. They do not prove launcher placement, bitmap appearance, resize
behavior, motion smoothness, OEM battery handling or a physical phone.

## Dependency checks

Latest stable versions were checked against Google's release pages on
2026-10-04: [AndroidX Test](https://developer.android.com/jetpack/androidx/releases/test)
runner 1.7.0 and JUnit extension 1.3.0,
[UI Automator](https://developer.android.com/jetpack/androidx/releases/test-uiautomator)
2.4.0, and [Biometric](https://developer.android.com/jetpack/androidx/releases/biometric)
1.1.0, the same stable biometric library used by the normal APK workflow.
Google Maven POMs for these exact versions declare Apache License 2.0. The bank
helper adds no library dependencies. Native dependencies remain outside npm's
vulnerability audit. An OSV Maven query for these four exact direct dependencies
returned no known advisories on 2026-10-04. This is not a scan of Gradle's resolved
transitive dependency tree, which was unavailable without the Android SDK. See
the PR verification notes for the executed checks and remaining gaps.
