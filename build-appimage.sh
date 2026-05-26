#!/bin/bash
set -e
VERSION=$(tr -d '[:space:]' < VERSION)
echo "Building amorist $VERSION AppImage..."
cd src-tauri && cargo tauri build --bundles appimage --config "{\"version\": \"$VERSION\"}"
APPIMAGE=$(ls -1 target/release/bundle/appimage/amorist_${VERSION}_amd64.AppImage 2>/dev/null | head -1)
echo ""
echo "Built: src-tauri/$APPIMAGE"
echo "Register it in 'Open with' with:"
echo "    \"src-tauri/$APPIMAGE\" --install-desktop"
