#!/bin/bash
#
# Builds DesktopNote.app.
#
#   ./build-app.sh            full build (editor bundle + Swift + .app)
#   ./build-app.sh --skip-js  reuse the existing editor bundle

set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="DesktopNote"
BUNDLE_ID="com.yumin.desktopnote"
VERSION="1.0.0"
APP_DIR="build/$APP_NAME.app"
CONTENTS="$APP_DIR/Contents"

SKIP_JS=0
[[ "${1:-}" == "--skip-js" ]] && SKIP_JS=1

# ── 1. Editor bundle ────────────────────────────────────────────────────────
if [[ $SKIP_JS -eq 0 ]]; then
  echo "==> Building editor bundle"
  ( cd editor-web && [[ -d node_modules ]] || npm install )
  ( cd editor-web && npm run build )
fi

if [[ ! -f editor-web/dist/editor.bundle.js ]]; then
  echo "error: editor-web/dist/editor.bundle.js is missing (run without --skip-js)" >&2
  exit 1
fi
cp editor-web/dist/editor.bundle.js Sources/DesktopNote/Resources/Editor/editor.bundle.js

# ── 2. App icon ─────────────────────────────────────────────────────────────
if [[ ! -f Sources/DesktopNote/Resources/AppIcon.icns ]]; then
  echo "==> Generating app icon"
  ./make-icon.swift Sources/DesktopNote/Resources/AppIcon.icns || \
    echo "    (icon generation skipped)"
fi

# ── 3. Swift executable ─────────────────────────────────────────────────────
echo "==> Building Swift executable"
swift build -c release

# ── 4. Assemble the bundle ──────────────────────────────────────────────────
echo "==> Assembling $APP_DIR"
rm -rf "$APP_DIR"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

cp ".build/release/DesktopNote" "$CONTENTS/MacOS/$APP_NAME"
cp -R Sources/DesktopNote/Resources/. "$CONTENTS/Resources/"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>          <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>          <string>$BUNDLE_ID</string>
    <key>CFBundleName</key>                <string>DesktopNote</string>
    <key>CFBundleDisplayName</key>         <string>DesktopNote</string>
    <key>CFBundlePackageType</key>         <string>APPL</string>
    <key>CFBundleShortVersionString</key>  <string>$VERSION</string>
    <key>CFBundleVersion</key>             <string>$VERSION</string>
    <key>CFBundleInfoDictionaryVersion</key> <string>6.0</string>
    <key>CFBundleIconFile</key>            <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>      <string>12.0</string>
    <key>NSHighResolutionCapable</key>     <true/>
    <key>NSPrincipalClass</key>            <string>NSApplication</string>
    <key>NSSupportsAutomaticTermination</key> <false/>
    <key>NSSupportsSuddenTermination</key> <false/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$CONTENTS/PkgInfo"

# Ad-hoc signature. Not notarised, but enough for Gatekeeper to offer
# "Open Anyway" instead of reporting the app as damaged.
codesign --force --deep --sign - "$APP_DIR" 2>/dev/null

echo
echo "Built $APP_DIR"
echo "Run with: open $APP_DIR"
