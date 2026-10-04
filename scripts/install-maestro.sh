#!/usr/bin/env bash
# Local CLI only. No Maestro Cloud account, API key or installer shell profile edits.
set -euo pipefail

# Latest stable release verified against the official release metadata and
# checksums_sha256.txt on 2026-10-04. Maestro is licensed Apache-2.0.
# https://github.com/mobile-dev-inc/Maestro/releases/tag/cli-2.11.0
MAESTRO_VERSION=2.11.0
MAESTRO_SHA256=5384593cb4e7a106489e75a821d157dd43f4e438df6bc308b72e82c685e1283a

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <new installation directory>" >&2
  exit 2
fi
INSTALL_DIR="$1"
if [ -e "$INSTALL_DIR" ]; then
  echo "Refusing to overwrite an existing Maestro installation: $INSTALL_DIR" >&2
  exit 2
fi
for tool in curl unzip python3 java; do
  if ! command -v "$tool" >/dev/null; then
    echo "Required tool not found: $tool" >&2
    exit 2
  fi
done

DOWNLOAD_DIR="$(mktemp -d)"
trap 'rm -rf "$DOWNLOAD_DIR"' EXIT
curl --fail --silent --show-error --location --retry 3 --connect-timeout 30 --max-time 300 \
  "https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip" \
  --output "$DOWNLOAD_DIR/maestro.zip"
python3 - "$DOWNLOAD_DIR/maestro.zip" "$MAESTRO_SHA256" <<'PY'
import hashlib
import sys

with open(sys.argv[1], "rb") as archive:
    checksum = hashlib.file_digest(archive, "sha256").hexdigest()
if checksum != sys.argv[2]:
    sys.exit(f"Maestro checksum mismatch: expected {sys.argv[2]}, got {checksum}")
print(f"Verified Maestro SHA256: {checksum}")
PY
unzip -q "$DOWNLOAD_DIR/maestro.zip" -d "$DOWNLOAD_DIR/extracted"
test -f "$DOWNLOAD_DIR/extracted/maestro/bin/maestro"
chmod +x "$DOWNLOAD_DIR/extracted/maestro/bin/maestro"

# Keep CLI state next to this disposable CI installation. Nothing writes to a
# developer's existing ~/.maestro or shell startup files.
export XDG_STATE_HOME="$DOWNLOAD_DIR/state"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
ACTUAL_VERSION="$("$DOWNLOAD_DIR/extracted/maestro/bin/maestro" --version)"
if [ "$ACTUAL_VERSION" != "$MAESTRO_VERSION" ]; then
  echo "Unexpected Maestro version: $ACTUAL_VERSION" >&2
  exit 1
fi
mkdir -p "$(dirname "$INSTALL_DIR")"
mv "$DOWNLOAD_DIR/extracted/maestro" "$INSTALL_DIR"
printf 'Installed Maestro %s at %s\n' "$MAESTRO_VERSION" "$INSTALL_DIR"
if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$INSTALL_DIR/bin" >> "$GITHUB_PATH"
fi
