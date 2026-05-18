#!/usr/bin/env bash
set -Eeuo pipefail

guard_destructive_path() {
  local p="$1"
  case "$p" in
    ""|"/"|"$HOME"|"$HOME/"|"$HOME/.local"|"$HOME/.local/"|"$HOME/.local/share"|"$HOME/.local/share/"|"$HOME/.local/bin"|"$HOME/.local/bin/"|"/opt"|"/opt/"|"/usr"|"/usr/"|"/usr/local"|"/usr/local/"|"/usr/local/bin"|"/usr/local/bin/")
      echo "amorist: refusing destructive operation on protected path: $p" >&2
      exit 1 ;;
  esac
}

if [[ "$(id -u)" -eq 0 ]]; then
  SCOPE="system"
  INSTALL_DIR="/opt/amorist"
  BIN_PATH="/usr/local/bin/amorist"
else
  SCOPE="user"
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/amorist"
  BIN_PATH="$HOME/.local/bin/amorist"
fi
EXPECTED_BIN_TARGET="$INSTALL_DIR/bin/amorist"

BIN_STATUS="not present"
if [[ -L "$BIN_PATH" ]]; then
  BIN_TARGET="$(readlink -f "$BIN_PATH" || true)"
  if [[ "$BIN_TARGET" == "$EXPECTED_BIN_TARGET" ]]; then
    BIN_STATUS="symlink to $BIN_TARGET"
  else
    BIN_STATUS="symlink to $BIN_TARGET (will not remove automatically)"
  fi
elif [[ -e "$BIN_PATH" ]]; then
  BIN_STATUS="exists but is not a symlink (will not remove automatically)"
fi

cat <<SUMMARY
amorist uninstaller

Scope: $SCOPE  (no privilege escalation)

This script will:
  1. Remove the installed app directory: $INSTALL_DIR
  2. Remove the command link: $BIN_PATH

Current command status: $BIN_STATUS

It does not touch python3 or xdg-utils on your system.

SUMMARY

read -r -p "Continue? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *) echo "Uninstall cancelled."; exit 0 ;;
esac

echo "Removing amorist files..."
guard_destructive_path "$INSTALL_DIR"
rm -rf "$INSTALL_DIR"

if [[ -L "$BIN_PATH" ]]; then
  BIN_TARGET="$(readlink -f "$BIN_PATH" || true)"
  if [[ "$BIN_TARGET" == "$EXPECTED_BIN_TARGET" || -z "$BIN_TARGET" ]]; then
    rm -f "$BIN_PATH"
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
  if [[ "$BIN_TARGET" == "$EXPECTED_BIN_TARGET" || -z "$BIN_TARGET" ]]; then
    echo "Could not remove $BIN_PATH." >&2
    exit 1
  fi
fi

echo "Uninstalled amorist."
