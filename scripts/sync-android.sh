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
# Remove ALL default Capacitor launcher icons (PNGs, WebPs, and XMLs)
# This ensures our custom adaptive icon takes full precedence.

# Remove density-specific PNG/WebP icons (the "two T's" placeholder)
for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  dir="$RES_DIR/mipmap-$density"
  if [ -d "$dir" ]; then
    echo "Cleaning mipmap-$density/"
    rm -f "$dir/ic_launcher.png" "$dir/ic_launcher.webp"
    rm -f "$dir/ic_launcher_round.png" "$dir/ic_launcher_round.webp"
    rm -f "$dir/ic_launcher_foreground.png" "$dir/ic_launcher_foreground.webp"
    rm -f "$dir/ic_launcher_background.png" "$dir/ic_launcher_background.webp"
  fi
done

# Remove Capacitor's default adaptive icon XMLs so ours take precedence
if [ -d "$RES_DIR/mipmap-anydpi-v26" ]; then
  echo "Cleaning mipmap-anydpi-v26/"
  rm -f "$RES_DIR/mipmap-anydpi-v26/ic_launcher.xml"
  rm -f "$RES_DIR/mipmap-anydpi-v26/ic_launcher_round.xml"
fi

# Remove Capacitor's default foreground drawable if it exists
rm -f "$RES_DIR/drawable/ic_launcher_foreground.xml"
rm -f "$RES_DIR/drawable-v24/ic_launcher_foreground.xml"

# Copy custom icon resources
mkdir -p "$RES_DIR/drawable"
mkdir -p "$RES_DIR/mipmap-anydpi-v26"
mkdir -p "$RES_DIR/values"

echo "Copying custom Covault icon resources..."
cp -v "$CUSTOM_DIR/res/drawable/ic_covault_foreground.xml" "$RES_DIR/drawable/"
cp -v "$CUSTOM_DIR/res/drawable/ic_launcher_legacy.xml" "$RES_DIR/drawable/" 2>/dev/null || true
cp -v "$CUSTOM_DIR/res/mipmap-anydpi-v26/ic_launcher.xml" "$RES_DIR/mipmap-anydpi-v26/"
cp -v "$CUSTOM_DIR/res/mipmap-anydpi-v26/ic_launcher_round.xml" "$RES_DIR/mipmap-anydpi-v26/"
cp -v "$CUSTOM_DIR/res/values/ic_launcher_background.xml" "$RES_DIR/values/"

# Verify the icon files are in place
echo ""
echo "Verifying icon setup..."
for f in \
  "$RES_DIR/drawable/ic_covault_foreground.xml" \
  "$RES_DIR/mipmap-anydpi-v26/ic_launcher.xml" \
  "$RES_DIR/mipmap-anydpi-v26/ic_launcher_round.xml" \
  "$RES_DIR/values/ic_launcher_background.xml"; do
  if [ -f "$f" ]; then
    echo "  OK: $(basename "$f")"
  else
    echo "  MISSING: $f"
  fi
done

# Verify no default Capacitor PNGs remain
FOUND_DEFAULT=0
for density in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  dir="$RES_DIR/mipmap-$density"
  if [ -f "$dir/ic_launcher.png" ] || [ -f "$dir/ic_launcher.webp" ]; then
    echo "  WARNING: Default icon still exists in mipmap-$density/"
    FOUND_DEFAULT=1
  fi
done
if [ $FOUND_DEFAULT -eq 0 ]; then
  echo "  OK: No default Capacitor icons remain"
fi

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
echo "Custom Covault icon installed (adaptive icon for API 26+)."
echo "Build: cd android && ./gradlew assembleDebug"
