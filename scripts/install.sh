#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ensure_writable_parent() {
  local target="$1" ancestor
  ancestor="$(dirname -- "$target")"
  while [[ ! -e "$ancestor" ]]; do
    ancestor="$(dirname -- "$ancestor")"
    [[ "$ancestor" == "/" ]] && break
  done
  if [[ ! -w "$ancestor" ]]; then
    echo "amorist: cannot write to $ancestor (needed to create $target)." >&2
    echo "Fix the permission and re-run." >&2
    exit 1
  fi
}

guard_destructive_path() {
  local p="$1"
  case "$p" in
    ""|"/"|"$HOME"|"$HOME/"|"$HOME/.local"|"$HOME/.local/"|"$HOME/.local/share"|"$HOME/.local/share/"|"$HOME/.local/bin"|"$HOME/.local/bin/"|"/opt"|"/opt/"|"/usr"|"/usr/"|"/usr/local"|"/usr/local/"|"/usr/local/bin"|"/usr/local/bin/")
      echo "amorist: refusing destructive operation on protected path: $p" >&2
      exit 1 ;;
  esac
}

guard_bin_path() {
  local bin_path="$1" expected="$2" current
  [[ ! -e "$bin_path" && ! -L "$bin_path" ]] && return 0
  if [[ ! -L "$bin_path" ]]; then
    echo "amorist: $bin_path exists and is not a symlink. Refusing to overwrite." >&2
    echo "Remove it manually if you want amorist to manage this path." >&2
    exit 1
  fi
  current="$(readlink -- "$bin_path")"
  if [[ "$current" != "$expected" ]]; then
    echo "amorist: $bin_path is a symlink to $current, not a managed amorist target." >&2
    echo "Remove it manually if you want amorist to manage this path." >&2
    exit 1
  fi
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "amorist requires python3 on PATH. Install it with your package manager and re-run." >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  SCOPE="system"
  INSTALL_DIR="/opt/amorist"
  BIN_DIR="/usr/local/bin"
else
  SCOPE="user"
  INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/amorist"
  BIN_DIR="$HOME/.local/bin"
fi
BIN_PATH="$BIN_DIR/amorist"

ensure_writable_parent "$INSTALL_DIR"
ensure_writable_parent "$BIN_DIR"

guard_bin_path "$BIN_PATH" "$INSTALL_DIR/bin/amorist"

if [[ "$SCOPE" == "user" && -L /usr/local/bin/amorist ]]; then
  legacy_target="$(readlink -- /usr/local/bin/amorist)"
  if [[ "$legacy_target" == /opt/amorist/bin/amorist ]]; then
    echo "Note: a previous system-wide install is present at /opt/amorist." >&2
    echo "      Run ./scripts/uninstall.sh as root to remove it." >&2
    echo "      This installer will not touch it." >&2
    echo "" >&2
  fi
fi

VERSION="$(tr -d '[:space:]' < VERSION)"

cat <<SUMMARY
amorist installer

Scope: $SCOPE  (no privilege escalation)
Project path: $ROOT_DIR
Version: $VERSION

This script will:
  1. Verify python3 is available
  2. Stage the launcher and web assets into a sibling directory, then
     atomically swap it into: $INSTALL_DIR
  3. Create or update the command symlink at: $BIN_PATH
     (only replaces an existing symlink already managed by amorist;
      refuses to overwrite an unrelated file)
  4. (If missing) create the directory: $BIN_DIR
  5. Report whether $BIN_DIR is on your PATH

After installation you should be able to run:
  amorist file.md

SUMMARY

read -r -p "Continue? [y/N] " CONFIRM
case "$CONFIRM" in
  y|Y|yes|YES) ;;
  *) echo "Installation cancelled."; exit 0 ;;
esac

echo "Installing amorist into $INSTALL_DIR..."

STAGE_DIR="$INSTALL_DIR.amorist-stage.$$"
guard_destructive_path "$STAGE_DIR"
rm -rf "$STAGE_DIR"
install -d "$STAGE_DIR"
cp -a bin web VERSION README.md "$STAGE_DIR/"
chmod +x "$STAGE_DIR/bin/amorist"

guard_destructive_path "$INSTALL_DIR"
OLD_DIR=""
if [[ -e "$INSTALL_DIR" ]]; then
  OLD_DIR="$INSTALL_DIR.amorist-old.$$"
  guard_destructive_path "$OLD_DIR"
  mv "$INSTALL_DIR" "$OLD_DIR"
fi
mv "$STAGE_DIR" "$INSTALL_DIR"
if [[ -n "$OLD_DIR" ]]; then
  rm -rf "$OLD_DIR"
fi

install -d "$BIN_DIR"
ln -sfn "$INSTALL_DIR/bin/amorist" "$BIN_PATH"

RESOLVED="$(command -v amorist 2>/dev/null || true)"
if [[ -z "$RESOLVED" ]]; then
  case ":$PATH:" in
    *":$BIN_DIR:"*)
      echo "amorist was installed at $BIN_PATH, but is still not visible on PATH." >&2
      echo "This usually means the shell has cached an older PATH lookup. Try: hash -r" >&2
      exit 1 ;;
    *)
      echo "Installed: $BIN_PATH"
      echo "Version: $("$BIN_PATH" --version)"
      echo "Note: $BIN_DIR is not on PATH yet."
      echo "Add this to your shell rc (~/.bashrc or ~/.zshrc) and restart the shell:"
      echo "  export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac
elif [[ "$RESOLVED" != "$BIN_PATH" ]]; then
  echo "Installed: $BIN_PATH" >&2
  echo "Warning: 'amorist' on PATH currently resolves to $RESOLVED (earlier on PATH)." >&2
  echo "Either remove the older install or move $BIN_DIR earlier in PATH." >&2
  echo "Version of the new install: $("$BIN_PATH" --version)"
else
  echo "Installed: $RESOLVED"
  echo "Version: $(amorist --version)"
  echo "Usage: amorist file.md"
fi
