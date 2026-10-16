#!/bin/bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
VERSION=$(tr -d '[:space:]' < VERSION)
echo "Building amorist $VERSION AppImage..."
amorist_bundle_dir=$(mktemp -d)
trap 'rm -rf -- "$amorist_bundle_dir"' EXIT
python3 src-tauri/linux/prepare-appimage.py "$amorist_bundle_dir/decoders.json"
export APPIMAGE_EXTRACT_AND_RUN=1
cargo tauri build --bundles appimage --config "$amorist_bundle_dir/decoders.json" --config "{\"version\": \"$VERSION\"}"
APPIMAGE_PATH="src-tauri/target/release/bundle/appimage/amorist_${VERSION}_amd64.AppImage"
test -f "$APPIMAGE_PATH"
echo ""
echo "Built: $APPIMAGE_PATH"
echo "Register it in 'Open with' with:"
echo "    \"$APPIMAGE_PATH\" --install-desktop"
