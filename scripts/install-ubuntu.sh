#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f /etc/os-release ]]; then
  echo "This installer targets Ubuntu/Debian systems." >&2
  exit 1
fi

# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID:-}" != "ubuntu" && "${ID_LIKE:-}" != *"debian"* ]]; then
  echo "This installer targets Ubuntu/Debian systems. Detected: ${PRETTY_NAME:-unknown}." >&2
  exit 1
fi

for command in npm cargo rustc sudo apt-get; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    echo "Install Node.js/npm and Rust before running this script." >&2
    exit 1
  fi
done

echo "Installing Ubuntu build prerequisites..."
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  file \
  libayatana-appindicator3-dev \
  libgtk-3-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  librsvg2-dev \
  patchelf \
  pkg-config

echo "Installing JavaScript dependencies from package-lock.json..."
npm ci

echo "Building Ubuntu .deb package..."
npm run tauri:build -- --bundles deb --ci

mapfile -t DEBS < <(find src-tauri/target/release/bundle/deb -type f -name '*.deb' -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
if [[ "${#DEBS[@]}" -eq 0 ]]; then
  echo "No .deb package was produced." >&2
  exit 1
fi

DEB_PATH="${DEBS[0]}"
echo "Installing $DEB_PATH..."
sudo apt-get install -y "$DEB_PATH"

if ! command -v amorist >/dev/null 2>&1; then
  echo "amorist was installed, but it is not visible in PATH." >&2
  exit 1
fi

echo "Installed: $(command -v amorist)"
echo "Usage: amorist file.md"
