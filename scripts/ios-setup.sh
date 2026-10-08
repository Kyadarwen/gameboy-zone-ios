#!/usr/bin/env bash
# Gives the generated iOS project Gameboy Zone's icon, launch screen and
# settings. Runs on the cloud Mac after `npx cap add ios`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/ios/App/App"
PLIST="$APP/Info.plist"
PB=/usr/libexec/PlistBuddy

setkey() { # setkey <key> <type> <value>: add or replace a key
  "$PB" -c "Delete :$1" "$PLIST" 2>/dev/null || true
  "$PB" -c "Add :$1 $2 $3" "$PLIST"
}

echo "Info.plist"
setkey CFBundleDisplayName string "Gameboy Zone"
# Light status-bar text on the dark purple background.
setkey UIStatusBarStyle string UIStatusBarStyleLightContent
setkey UIViewControllerBasedStatusBarAppearance bool false
# Play in portrait or either landscape direction (on-screen controls adapt).
"$PB" -c "Delete :UISupportedInterfaceOrientations" "$PLIST" 2>/dev/null || true
"$PB" -c "Add :UISupportedInterfaceOrientations array" "$PLIST"
"$PB" -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST"
"$PB" -c "Add :UISupportedInterfaceOrientations:1 string UIInterfaceOrientationLandscapeLeft" "$PLIST"
"$PB" -c "Add :UISupportedInterfaceOrientations:2 string UIInterfaceOrientationLandscapeRight" "$PLIST"
setkey ITSAppUsesNonExemptEncryption bool false

echo "App icon"
ICONSET="$APP/Assets.xcassets/AppIcon.appiconset"
rm -f "$ICONSET"/*.png
cp "$ROOT/resources/AppIcon-1024.png" "$ICONSET/AppIcon-1024.png"
cat > "$ICONSET/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "AppIcon-1024.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON

echo "Launch screen"
SPLASH="$APP/Assets.xcassets/Splash.imageset"
if [ -d "$SPLASH" ]; then
  for f in "$SPLASH"/*.png; do cp "$ROOT/resources/splash-2732.png" "$f"; done
else
  echo "  (no Splash image set in this Capacitor version; skipped)"
fi

echo "Done"
