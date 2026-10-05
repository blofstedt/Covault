#!/usr/bin/env bash
# Runs only the isolated test APK on one explicitly selected Android emulator.
set -euo pipefail
cd "$(dirname "$0")/.."

RESULTS_DIR="${COVAULT_ANDROID_RESULTS:-$PWD/android-e2e-results}"
mkdir -p "$RESULTS_DIR/logs" "$RESULTS_DIR/reports" "$RESULTS_DIR/screenshots"
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
APP_ID=com.covault.app.test
BANK_ID=com.covault.fakebank
STAGE=preflight
LOGCAT_PID=
DEVICE_READY=0

collect_results() {
  local status="$?"
  trap - EXIT
  set +e
  if [ "$DEVICE_READY" = 1 ]; then
    if [ "$status" != 0 ]; then
      python3 scripts/android-emulator-preflight.py --serial "$ANDROID_SERIAL" diagnostics \
        > "$RESULTS_DIR/logs/startup-diagnostics.txt" 2>&1
    fi
    adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$RESULTS_DIR/screenshots/final.png"
    adb -s "$ANDROID_SERIAL" shell dumpsys notification > "$RESULTS_DIR/logs/notifications.txt"
    adb -s "$ANDROID_SERIAL" shell dumpsys webviewupdate > "$RESULTS_DIR/logs/webview.txt"
    adb -s "$ANDROID_SERIAL" shell getprop > "$RESULTS_DIR/logs/device-properties.txt"
    adb -s "$ANDROID_SERIAL" logcat -b crash -d > "$RESULTS_DIR/logs/crashes.txt"
  fi
  if [ -n "$LOGCAT_PID" ]; then
    kill "$LOGCAT_PID" 2>/dev/null
    wait "$LOGCAT_PID" 2>/dev/null
  fi
  if [ -d android/app/build/outputs/androidTest-results/connected ]; then
    cp -R android/app/build/outputs/androidTest-results/connected "$RESULTS_DIR/reports/native"
  fi
  if [ -d android/app/build/reports/androidTests/connected ]; then
    cp -R android/app/build/reports/androidTests/connected "$RESULTS_DIR/reports/native-html"
  fi
  python3 - "$RESULTS_DIR/reports/orchestration-junit.xml" "$status" "$STAGE" <<'PY'
import sys
from xml.etree.ElementTree import Element, SubElement, ElementTree

failed = sys.argv[2] != "0"
suite = Element("testsuite", name="Android emulator orchestration", tests="1", failures=str(int(failed)))
case = SubElement(suite, "testcase", name="Native suite and Maestro orchestration")
if failed:
    SubElement(case, "failure", message=f"Stopped during {sys.argv[3]}").text = "See the build, instrumentation, Maestro and logcat artifacts."
ElementTree(suite).write(sys.argv[1], encoding="utf-8", xml_declaration=True)
PY
  printf 'Exit status: %s\nLast stage: %s\n' "$status" "$STAGE" > "$RESULTS_DIR/run-state.txt"
  exit "$status"
}
trap collect_results EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for tool in adb apkanalyzer maestro python3; do
  if ! command -v "$tool" >/dev/null; then
    echo "Required tool not found: $tool" >&2
    exit 2
  fi
done
case "$ANDROID_SERIAL" in
  emulator-[0-9]*) ;;
  *) echo "Refusing to run on a physical device: $ANDROID_SERIAL" >&2; exit 2 ;;
esac
# Gradle's connected test task enumerates attached devices. Refuse a shared ADB
# session so no other emulator or phone can be included in that task.
ATTACHED="$(adb devices | awk 'NR > 1 && NF { print $1 }')"
if [ "$ATTACHED" != "$ANDROID_SERIAL" ]; then
  echo "Exactly one emulator must be attached, matching ANDROID_SERIAL=$ANDROID_SERIAL." >&2
  printf 'Attached devices:\n%s\n' "$ATTACHED" >&2
  exit 2
fi
if [ "$(adb -s "$ANDROID_SERIAL" shell getprop ro.kernel.qemu | tr -d '\r')" != 1 ]; then
  echo "Selected device is not an Android emulator." >&2
  exit 2
fi
DEVICE_READY=1
for file in \
  android/gradlew \
  android/app/build/outputs/apk/debug/app-debug.apk \
  android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk \
  android/fake-bank/build/outputs/apk/debug/fake-bank-debug.apk \
  scripts/android-emulator-preflight.py \
  test/android/configure-device.sh \
  e2e/android/flows/manual-entry-smoke.yaml \
  e2e/android/flows/notification-review.yaml; do
  if [ ! -f "$file" ]; then
    echo "Required test input not found: $file" >&2
    exit 2
  fi
done

STAGE=validate-apk-identities
for expected in \
  "$APP_ID|android/app/build/outputs/apk/debug/app-debug.apk" \
  "$APP_ID.test|android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk" \
  "$BANK_ID|android/fake-bank/build/outputs/apk/debug/fake-bank-debug.apk"; do
  package="${expected%%|*}"
  apk="${expected#*|}"
  if [ "$(apkanalyzer manifest application-id "$apk")" != "$package" ]; then
    echo "Refusing to install an APK with the wrong application ID: $apk" >&2
    exit 1
  fi
  manifest_report="$RESULTS_DIR/logs/$package-manifest.xml"
  apkanalyzer manifest print "$apk" > "$manifest_report"
  python3 -c '
import sys
from xml.etree import ElementTree
app = ElementTree.parse(sys.argv[1]).getroot().find("application")
if app is None or app.get("{http://schemas.android.com/apk/res/android}testOnly") != "true":
    sys.exit(f"Refusing to install {sys.argv[2]} without android:testOnly=true; see {sys.argv[1]}")
' "$manifest_report" "$apk"
done

adb -s "$ANDROID_SERIAL" logcat -c
adb -s "$ANDROID_SERIAL" logcat -v threadtime > "$RESULTS_DIR/logs/logcat.txt" 2>&1 &
LOGCAT_PID="$!"

STAGE=install
adb -s "$ANDROID_SERIAL" install -r -t android/app/build/outputs/apk/debug/app-debug.apk
adb -s "$ANDROID_SERIAL" install -r -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s "$ANDROID_SERIAL" install -r -t android/fake-bank/build/outputs/apk/debug/fake-bank-debug.apk

# All app data is synthetic and local. Airplane mode also prevents the native
# updater or WebView from reaching external services during these checks.
STAGE=offline
adb -s "$ANDROID_SERIAL" shell cmd connectivity airplane-mode enable
adb -s "$ANDROID_SERIAL" shell svc wifi disable
python3 scripts/android-emulator-preflight.py --serial "$ANDROID_SERIAL" wait-phone \
  2>&1 | tee "$RESULTS_DIR/logs/phone-service-readiness.txt"
adb -s "$ANDROID_SERIAL" shell svc data disable
if [ "$(adb -s "$ANDROID_SERIAL" shell settings get global airplane_mode_on | tr -d '\r')" != 1 ]; then
  echo "Could not enable airplane mode; refusing to run the offline app tests." >&2
  exit 1
fi

STAGE=native-instrumentation
(cd android && ./gradlew --no-daemon :app:connectedDebugAndroidTest) \
  2>&1 | tee "$RESULTS_DIR/logs/instrumentation.txt"
adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$RESULTS_DIR/screenshots/after-native.png"

# Gradle's connected test runner removes the target APK after instrumentation.
# Install the same validated test APK again for the WebView flows.
STAGE=reinstall-test-app
adb -s "$ANDROID_SERIAL" install -r -t android/app/build/outputs/apk/debug/app-debug.apk

STAGE=reset-test-app
adb -s "$ANDROID_SERIAL" shell am broadcast --include-stopped-packages -n "$BANK_ID/.BankNotificationReceiver" \
  -a "$BANK_ID.CANCEL_ALL"
adb -s "$ANDROID_SERIAL" shell pm clear "$APP_ID"
bash test/android/configure-device.sh seed
bash test/android/configure-device.sh permissions

STAGE=manual-entry-port-preflight
python3 scripts/android-emulator-preflight.py --serial "$ANDROID_SERIAL" check-port 17001 \
  2>&1 | tee "$RESULTS_DIR/logs/manual-entry-port-preflight.txt"
STAGE=manual-entry
maestro --device "$ANDROID_SERIAL" test --driver-host-port 17001 --format junit \
  --output "$RESULTS_DIR/reports/manual-entry-junit.xml" \
  --test-output-dir "$RESULTS_DIR/maestro/manual-entry" \
  e2e/android/flows/manual-entry-smoke.yaml \
  2>&1 | tee "$RESULTS_DIR/logs/manual-entry.txt"
adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$RESULTS_DIR/screenshots/after-manual-entry.png"

STAGE=post-bank-notification
adb -s "$ANDROID_SERIAL" shell am broadcast --include-stopped-packages -n "$BANK_ID/.BankNotificationReceiver" \
  -a "$BANK_ID.POST" --es scenario purchase --ei id 701

STAGE=notification-review-port-preflight
python3 scripts/android-emulator-preflight.py --serial "$ANDROID_SERIAL" check-port 17002 \
  2>&1 | tee "$RESULTS_DIR/logs/notification-review-port-preflight.txt"
STAGE=notification-review
maestro --device "$ANDROID_SERIAL" test --driver-host-port 17002 --format junit \
  --output "$RESULTS_DIR/reports/notification-review-junit.xml" \
  --test-output-dir "$RESULTS_DIR/maestro/notification-review" \
  e2e/android/flows/notification-review.yaml \
  2>&1 | tee "$RESULTS_DIR/logs/notification-review.txt"
STAGE=completed
