#!/usr/bin/env bash
# Copies everything Gameboy Zone needs from the internet INTO the app, so the
# iPhone app plays games with no connection:
#   - the EmulatorJS engine (pinned version) with the Game Boy (Gambatte) and
#     Game Boy Advance (mGBA) cores
#   - the Archivo font used by the interface
# Runs on the cloud build machine before the iOS project is created.
set -euo pipefail

EJS_VERSION="4.2.3"
CDN="https://cdn.emulatorjs.org/${EJS_VERSION}/data"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/www/emulatorjs"

fetch() { # fetch <path inside data/>
  echo "  $1"
  curl -fsSL --retry 4 --retry-delay 3 -o "$OUT/$1" "$CDN/$1"
}

echo "Bundling EmulatorJS ${EJS_VERSION}"
rm -rf "$OUT"
mkdir -p "$OUT/compression" "$OUT/cores/reports"

for f in loader.js emulator.min.js emulator.min.css; do fetch "$f"; done
for f in extract7z.js extractzip.js libunrar.js libunrar.wasm; do fetch "compression/$f"; done

# Two builds of each core: the normal one, and "legacy" for phones whose
# graphics don't support WebGL2. The engine picks the right one itself.
for core in gambatte mgba; do
  fetch "cores/reports/${core}.json"
  fetch "cores/${core}-wasm.data"
  fetch "cores/${core}-legacy-wasm.data"
done

# Menu translations (the engine loads the one matching the phone's language)
# and the license, from the same tagged release.
tmp="$(mktemp -d)"
git clone -q --depth 1 --branch "v${EJS_VERSION}" https://github.com/EmulatorJS/EmulatorJS.git "$tmp/ejs"
cp -R "$tmp/ejs/data/localization" "$OUT/localization"
cp "$tmp/ejs/LICENSE" "$OUT/LICENSE"
rm -rf "$tmp"

# Sanity check: every core must be a real file, not an error page.
for f in "$OUT"/cores/*.data; do
  size=$(wc -c < "$f")
  if [ "$size" -lt 100000 ]; then echo "Core looks broken: $f ($size bytes)"; exit 1; fi
done

echo "Bundling fonts"
python3 "$ROOT/scripts/fetch-fonts.py" "$ROOT/www" || echo "Font download failed; the app will use the system font."

echo "Engine bundle:"
du -sh "$OUT"
