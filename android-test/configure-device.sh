#!/usr/bin/env bash
set -euo pipefail

# ADB respects ANDROID_SERIAL, so CI targets only its own emulator.
ADB="${ADB:-adb}"
APP='com.covault.app.test'
BANK='com.covault.fakebank'
MODE="${1:-permissions}"
if [ "$MODE" != permissions ] && [ "$MODE" != seed ]; then
  echo "Usage: configure-device.sh [permissions|seed]" >&2
  exit 2
fi
PACKAGE_INFO="$("$ADB" shell dumpsys package "$APP")"
if [[ "$PACKAGE_INFO" != *versionName=android-ci* ]]; then
  echo "Install the isolated Covault CI APK first. Refusing to modify another app." >&2
  exit 1
fi
"$ADB" shell pm grant "$APP" android.permission.POST_NOTIFICATIONS
"$ADB" shell pm grant "$BANK" android.permission.POST_NOTIFICATIONS
"$ADB" shell appops set "$APP" POST_NOTIFICATION allow

if [ "$MODE" = seed ]; then
  # Only after pm clear and before the first Activity/listener is started.
  # Overwriting prefs in a running app would race its in-memory cache.
  if [ -n "$("$ADB" shell pidof "$APP" | tr -d '\r')" ]; then
    echo "Stop the disposable test app before seeding native preferences." >&2
    exit 1
  fi
  "$ADB" shell run-as "$APP" mkdir -p shared_prefs
  "$ADB" shell run-as "$APP" sh -c "'cat > shared_prefs/covault_prefs.xml'" <<'XML'
<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="monitored_apps_chosen" value="true" />
    <string name="monitored_apps">["com.covault.fakebank"]</string>
    <boolean name="hide_bank_notifications" value="true" />
</map>
XML
fi

"$ADB" shell cmd notification allow_listener "$APP/com.covault.app.NotificationListener"
"$ADB" shell am broadcast --include-stopped-packages -n "$BANK/.BankNotificationReceiver" -a "$BANK.CANCEL_ALL"
echo "Configured genuine bank alerts and isolated test app notification access."
