#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BROWSER="${BROWSER:-}"
if [[ -z "$BROWSER" ]]; then
  for candidate in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
    if command -v "$candidate" >/dev/null 2>&1; then
      BROWSER="$candidate"
      break
    fi
  done
fi

if [[ -z "$BROWSER" ]]; then
  echo "No Chromium-compatible browser found. Set BROWSER=/path/to/browser and retry." >&2
  exit 1
fi

OUT_DIR="$ROOT_DIR/docs/screenshots"
mkdir -p "$OUT_DIR"

TMP_FILE="$(mktemp --suffix=.md)"
SERVER_LOG="$(mktemp)"
trap 'rm -f "$TMP_FILE" "$SERVER_LOG"; [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true' EXIT

cat > "$TMP_FILE" <<'MARKDOWN'
# Draft Notes

## Today

This document shows **Markdown** with inline code, blockquotes, lists, and task items.

> A compact editor for local Markdown files.

- Fast startup
- Browser-native close behavior
- Plain Markdown as the source of truth

- [ ] Review draft
- [x] Save locally
MARKDOWN

./bin/amorist --no-open "$TMP_FILE" > "$SERVER_LOG" 2>&1 &
SERVER_PID="$!"

for _ in {1..80}; do
  if URL="$(awk '/^URL: / { print $2 }' "$SERVER_LOG")" && [[ -n "$URL" ]]; then
    break
  fi
  sleep 0.25
done

if [[ -z "${URL:-}" ]]; then
  echo "amorist did not start." >&2
  cat "$SERVER_LOG" >&2
  exit 1
fi

PORT="${URL#http://127.0.0.1:}"
PORT="${PORT%%/*}"

capture() {
  local mode="$1"
  local output="$2"
  "$BROWSER" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --window-size=1366,860 \
    --screenshot="$OUT_DIR/$output" \
    "http://127.0.0.1:$PORT/?screenshot=$mode" >/dev/null 2>&1
}

capture wysiwyg wysiwyg-mode.png
capture source source-mode.png
capture find find-bar.png
capture empty empty-state.png

echo "Wrote screenshots to $OUT_DIR"
