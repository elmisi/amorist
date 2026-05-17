#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="/opt/amorist"
BIN_PATH="/usr/local/bin/amorist"

for command in sudo rm readlink; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

BIN_STATUS="not present"
if [[ -L "$BIN_PATH" ]]; then
  BIN_TARGET="$(readlink -f "$BIN_PATH" || true)"
  if [[ "$BIN_TARGET" == "$INSTALL_DIR/bin/amorist" ]]; then
    BIN_STATUS="symlink to $BIN_TARGET"
  else
    BIN_STATUS="symlink to $BIN_TARGET (will not remove automatically)"
  fi
elif [[ -e "$BIN_PATH" ]]; then
  BIN_STATUS="exists but is not a symlink (will not remove automatically)"
fi

cat <<SUMMARY
amorist uninstaller

This script will:
  1. Remove the installed app directory: $INSTALL_DIR
  2. Remove the command link: $BIN_PATH

Current command status: $BIN_STATUS

It will not remove system packages such as python3 or xdg-utils.

SUMMARY

read -r -p "Continue? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *)
    echo "Uninstall cancelled."
    exit 0
    ;;
esac

echo "Removing amorist files..."
sudo rm -rf "$INSTALL_DIR"

if [[ -L "$BIN_PATH" ]]; then
  BIN_TARGET="$(readlink -f "$BIN_PATH" || true)"
  if [[ "$BIN_TARGET" == "$INSTALL_DIR/bin/amorist" || -z "$BIN_TARGET" ]]; then
    sudo rm -f "$BIN_PATH"
  else
    echo "Left $BIN_PATH in place because it points to: $BIN_TARGET" >&2
  fi
elif [[ -e "$BIN_PATH" ]]; then
  echo "Left $BIN_PATH in place because it is not an amorist symlink." >&2
fi

if [[ -e "$INSTALL_DIR" ]]; then
  echo "Could not fully remove $INSTALL_DIR." >&2
  exit 1
fi

if [[ -L "$BIN_PATH" ]]; then
  BIN_TARGET="$(readlink -f "$BIN_PATH" || true)"
  if [[ "$BIN_TARGET" == "$INSTALL_DIR/bin/amorist" || -z "$BIN_TARGET" ]]; then
    echo "Could not remove $BIN_PATH." >&2
    exit 1
  fi
fi

echo "Uninstalled amorist."
