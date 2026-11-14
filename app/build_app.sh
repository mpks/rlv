#!/usr/bin/env bash
# Build the RLV desktop app (Tauri) on this machine.
#
#   ./build_app.sh             all Linux packages: AppImage, .deb, .rpm
#   ./build_app.sh --appimage  just the AppImage (quicker)
#   ./build_app.sh --run       build just the program, then start it
#
# Results go to src-tauri/target/release/ (the program: rlv) and
# src-tauri/target/release/bundle/ (the packages).
#
# Needs Node 22 (via nvm; CCP4's Node 16 can sit ahead of it on PATH, so it
# is put first for this script only) and Rust (rustup / cargo).

cd "$(dirname "$0")" || exit 1

# Load nvm (a shell function, not available in scripts by default).
# Done before 'set -e -u' because nvm.sh is not compatible with them.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null || { echo "nvm: Node 22 not installed (run: nvm install 22)"; exit 1; }
  export PATH="$NVM_BIN:$PATH"
  hash -r
fi

set -euo pipefail

echo "Using node $(node -v), npm $(npm -v)"
case "$(node -v)" in
  v2[2-9].*|v[3-9]?.*) ;;
  *) echo "Node $(node -v) is too old: need Node 22 (nvm install 22)"; exit 1 ;;
esac
command -v cargo >/dev/null || { echo "Rust not found: install it from https://rustup.rs"; exit 1; }

# Install packages only when needed: no node_modules yet, or
# package-lock.json changed since the last install.
if [ ! -f node_modules/.package-lock.json ] \
   || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci
fi

case "${1:-}" in
  --appimage) npx tauri build --bundles appimage ;;
  --run)      npx tauri build --no-bundle ;;
  "")         npx tauri build ;;
  *)          echo "Unknown option: $1 (use --appimage or --run)"; exit 1 ;;
esac

out=src-tauri/target/release
echo
echo "Program:  $(pwd)/$out/rlv"
if [ -d "$out/bundle" ]; then
  echo "Packages:"
  find "$out/bundle" -maxdepth 2 -type f \
    \( -name '*.AppImage' -o -name '*.deb' -o -name '*.rpm' \) \
    -printf '  %p\n' 2>/dev/null || true
fi

if [ "${1:-}" = "--run" ]; then
  exec "$out/rlv"
fi
