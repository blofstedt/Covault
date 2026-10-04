#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/android"
TEST_SOURCE="$REPO_ROOT/android-test"
for required in settings.gradle app/build.gradle app/src/main/AndroidManifest.xml; do
  if [ ! -f "$ANDROID_DIR/$required" ]; then
    echo "Missing android/$required. Run Capacitor add/sync and scripts/sync-android.sh first." >&2
    exit 1
  fi
done
if [ ! -f "$ANDROID_DIR/app/src/main/java/com/covault/app/NotificationListener.java" ]; then
  echo "Production NotificationListener is missing. Run scripts/sync-android.sh first." >&2
  exit 1
fi

mkdir -p "$ANDROID_DIR/app/src/androidTest"
cp -R "$TEST_SOURCE/instrumentation/." "$ANDROID_DIR/app/src/androidTest/"
mkdir -p "$ANDROID_DIR/fake-bank"
cp -R "$TEST_SOURCE/fake-bank/." "$ANDROID_DIR/fake-bank/"
cp "$TEST_SOURCE/app-test.gradle" "$ANDROID_DIR/app/covault-android-test.gradle"

# Replace only our generated blocks so preparing the same project is repeatable.
python3 - "$ANDROID_DIR" <<'PY'
from pathlib import Path
import re
import sys

android = Path(sys.argv[1])
blocks = {
    'settings.gradle': "include ':fake-bank'\nproject(':fake-bank').projectDir = new File(rootProject.projectDir, 'fake-bank')",
    'app/build.gradle': "apply from: 'covault-android-test.gradle'",
}
for relative, content in blocks.items():
    path = android / relative
    text = path.read_text()
    text = re.sub(r'\n?// BEGIN COVAULT ANDROID TEST\n.*?// END COVAULT ANDROID TEST\n?', '\n', text, flags=re.S)
    path.write_text(text.rstrip() + '\n\n// BEGIN COVAULT ANDROID TEST\n' + content + '\n// END COVAULT ANDROID TEST\n')

# A separate app ID must not change Java component names. Resolve relative names
# before manifest merging, using the unchanged production namespace explicitly.
manifest = android / 'app/src/main/AndroidManifest.xml'
text = manifest.read_text()
text = re.sub(r'(android:name=")\.([^\"]+)(")', r'\1com.covault.app.\2\3', text)
if 'android:testOnly=' not in text:
    text = re.sub(r'<application\b', '<application android:testOnly="true"', text, count=1)
text = text.replace('android:label="@string/app_name"', 'android:label="Covault CI"')
text = text.replace('android:label="@string/title_activity_main"', 'android:label="Covault CI"')
text = text.replace('android:scheme="com.covault.app"', 'android:scheme="com.covault.app.test"')
manifest.write_text(text)
PY

echo "Prepared disposable Covault CI app, Android instrumentation and :fake-bank."
echo "Build with android/gradlew assembleDebug assembleAndroidTest :fake-bank:assembleDebug."
