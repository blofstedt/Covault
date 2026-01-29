#!/bin/bash
# Sync custom Android resources into the Capacitor android project.
# Run this AFTER `npx cap sync android`.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ANDROID_DIR="$PROJECT_DIR/android"
CUSTOM_DIR="$PROJECT_DIR/android-custom"
MAIN_DIR="$ANDROID_DIR/app/src/main"
JAVA_DIR="$MAIN_DIR/java/com/covault/app"
RES_DIR="$MAIN_DIR/res"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "Error: android/ directory not found. Run 'npx cap add android' first."
  exit 1
fi

echo "Syncing custom Android resources..."

# --- ICONS ---
# Remove default Capacitor launcher icons (the "two T's" placeholder)
# so our adaptive icon in mipmap-anydpi-v26 takes effect
for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  dir="$RES_DIR/mipmap-$density"
  if [ -d "$dir" ]; then
    echo "Removing default icons from mipmap-$density/"
    rm -f "$dir/ic_launcher.png" "$dir/ic_launcher.webp"
    rm -f "$dir/ic_launcher_round.png" "$dir/ic_launcher_round.webp"
    rm -f "$dir/ic_launcher_foreground.png" "$dir/ic_launcher_foreground.webp"
  fi
done

# Copy custom icon resources
mkdir -p "$RES_DIR/drawable"
mkdir -p "$RES_DIR/mipmap-anydpi-v26"
mkdir -p "$RES_DIR/values"

cp -v "$CUSTOM_DIR/res/drawable/ic_covault_foreground.xml" "$RES_DIR/drawable/"
cp -v "$CUSTOM_DIR/res/drawable/ic_launcher_legacy.xml" "$RES_DIR/drawable/" 2>/dev/null || true
cp -v "$CUSTOM_DIR/res/mipmap-anydpi-v26/ic_launcher.xml" "$RES_DIR/mipmap-anydpi-v26/"
cp -v "$CUSTOM_DIR/res/mipmap-anydpi-v26/ic_launcher_round.xml" "$RES_DIR/mipmap-anydpi-v26/"
cp -v "$CUSTOM_DIR/res/values/ic_launcher_background.xml" "$RES_DIR/values/"

# --- JAVA FILES ---
mkdir -p "$JAVA_DIR"
cp -v "$CUSTOM_DIR/MainActivity.java" "$JAVA_DIR/"
cp -v "$CUSTOM_DIR/CovaultNotificationPlugin.java" "$JAVA_DIR/"
cp -v "$CUSTOM_DIR/NotificationListener.java" "$JAVA_DIR/"
cp -v "$CUSTOM_DIR/BootReceiver.java" "$JAVA_DIR/"

# --- MANIFEST ---
cp -v "$CUSTOM_DIR/AndroidManifest.xml" "$MAIN_DIR/AndroidManifest.xml"

echo ""
echo "Done! Custom Android resources synced."
echo "Default Capacitor icons removed — your custom Covault icon will be used."
echo "Build: cd android && ./gradlew assembleDebug"
