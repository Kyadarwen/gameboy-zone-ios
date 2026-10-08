#!/usr/bin/env bash
# Builds the iOS app WITHOUT code signing and packs it into dist/GameboyZone.ipa.
# SideStore (or any sideloader) signs it with your own Apple ID when it installs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/ios/App"

# CocoaPods projects build from the workspace; Swift Package projects from the project.
if [ -d App.xcworkspace ]; then
  target=(-workspace App.xcworkspace)
else
  target=(-project App.xcodeproj)
fi

xcodebuild "${target[@]}" \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$PWD/build" \
  MARKETING_VERSION="1.0" \
  CURRENT_PROJECT_VERSION="${BUILD_NUMBER:-1}" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  -quiet \
  build

APP_PATH="$PWD/build/Build/Products/Release-iphoneos/App.app"
[ -d "$APP_PATH" ] || { echo "Build finished but App.app is missing"; exit 1; }

# The game engine must be inside the app for offline play.
for f in public/index.html public/emulatorjs/loader.js public/emulatorjs/cores/gambatte-wasm.data public/emulatorjs/cores/mgba-wasm.data; do
  [ -f "$APP_PATH/$f" ] || { echo "Missing from app: $f"; exit 1; }
done

DIST="$ROOT/dist"
rm -rf "$DIST" && mkdir -p "$DIST/Payload"
cp -R "$APP_PATH" "$DIST/Payload/"
(cd "$DIST" && zip -qry GameboyZone.ipa Payload && rm -rf Payload)
echo "Built $(du -h "$DIST/GameboyZone.ipa" | cut -f1) dist/GameboyZone.ipa"
