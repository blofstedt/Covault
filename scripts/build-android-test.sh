#!/usr/bin/env bash
# Build only an isolated CI APK. Production builds never invoke this script.
set -euo pipefail
cd "$(dirname "$0")/.."
export COVAULT_ANDROID_TEST=1
export VITE_SUPABASE_URL=https://covault-android.invalid
export VITE_PUBLIC_SUPABASE_URL=
export VITE_SUPABASE_ANON_KEY=synthetic-android-key
export VITE_SENTRY_DSN=
./node_modules/.bin/vite build --mode android-e2e
if [ ! -d android ]; then
  ./node_modules/.bin/cap add android
fi
./node_modules/.bin/cap sync android
bash scripts/sync-android.sh
bash scripts/prepare-android-tests.sh
