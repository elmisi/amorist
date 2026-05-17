#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INSTALL_DIR="/opt/amorist"
BIN_PATH="/usr/local/bin/amorist"

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
else
  ID="unknown"
  ID_LIKE=""
  PRETTY_NAME="$(uname -s)"
fi

case "${ID:-}" in
  ubuntu|debian)
    PLATFORM="Ubuntu/Debian"
    APT_PACKAGES=(python3 xdg-utils)
    ;;
  *)
    if [[ "${ID_LIKE:-}" == *"debian"* ]]; then
      PLATFORM="Ubuntu/Debian"
      APT_PACKAGES=(python3 xdg-utils)
    else
      echo "Unsupported system: ${PRETTY_NAME:-unknown}." >&2
      echo "This installer currently supports Ubuntu/Debian systems." >&2
      exit 1
    fi
    ;;
esac

for command in sudo install apt-get; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

VERSION="$(tr -d '[:space:]' < VERSION)"
APT_PACKAGES_TEXT=""
for package in "${APT_PACKAGES[@]}"; do
  if [[ -n "$APT_PACKAGES_TEXT" ]]; then
    APT_PACKAGES_TEXT+=", "
  fi
  APT_PACKAGES_TEXT+="$package"
done

cat <<SUMMARY
amorist installer

Detected system: ${PRETTY_NAME:-unknown}
Platform: $PLATFORM
Project path: $ROOT_DIR
Version: $VERSION

This script will:
  1. Run: sudo apt-get update
  2. Install these apt packages: $APT_PACKAGES_TEXT
  3. Copy the launcher and web assets to: $INSTALL_DIR
  4. Create or replace this command: $BIN_PATH
  5. Verify that the amorist command is available in PATH

After installation you should be able to run:
  amorist file.md

SUMMARY

read -r -p "Continue? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *)
    echo "Installation cancelled."
    exit 0
    ;;
esac

echo "Installing runtime prerequisites..."
sudo apt-get update
sudo apt-get install -y "${APT_PACKAGES[@]}"

echo "Installing amorist into $INSTALL_DIR..."
sudo rm -rf "$INSTALL_DIR"
sudo install -d "$INSTALL_DIR"
sudo cp -a bin web VERSION README.md "$INSTALL_DIR/"

sudo install -d "$(dirname "$BIN_PATH")"
sudo ln -sfn "$INSTALL_DIR/bin/amorist" "$BIN_PATH"
sudo chmod +x "$INSTALL_DIR/bin/amorist"

if ! command -v amorist >/dev/null 2>&1; then
  echo "amorist was installed, but it is not visible in PATH." >&2
  exit 1
fi

echo "Installed: $(command -v amorist)"
echo "Version: $(amorist --version)"
echo "Usage: amorist file.md"
