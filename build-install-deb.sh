#!/bin/bash
set -e
VERSION=$(tr -d '[:space:]' < VERSION)
echo "Building amorist $VERSION..."
cargo tauri build --bundles deb --config "{\"version\": \"$VERSION\"}"
DEB="src-tauri/target/release/bundle/deb/amorist_${VERSION}_amd64.deb"
echo "Removing old amorist package..."
sudo dpkg -r amorist 2>/dev/null || true
echo "Installing new package..."
sudo dpkg -i "$DEB"
sudo gtk-update-icon-cache -f /usr/share/icons/hicolor 2>/dev/null || true
echo ""
echo "Installed:"
dpkg -l amorist | grep amorist
echo ""
which amorist
