#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Meanly One"
EXECUTABLE_NAME="MeanlyOne"
BUILD_DIR="$SCRIPT_DIR/build"
APP_DIR="$BUILD_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$SCRIPT_DIR/Info.plist" "$CONTENTS_DIR/Info.plist"

swiftc \
  "$SCRIPT_DIR/Sources/SovereignApp/main.swift" \
  -o "$MACOS_DIR/$EXECUTABLE_NAME" \
  -framework AppKit \
  -framework WebKit

chmod +x "$MACOS_DIR/$EXECUTABLE_NAME"

echo "Built $APP_DIR"
