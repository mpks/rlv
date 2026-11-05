#!/usr/bin/env bash
# Build the single-file web version of RLV into app/dist/index.html,
# the same page the GitHub Pages workflow publishes.
#
#   ./build.sh            build only
#   ./build.sh --preview  build, then serve it at http://localhost:4173/
#                         (closest to GitHub Pages; Ctrl+C to stop)
#   ./build.sh --open     build, then open dist/index.html in the browser
#
# Vite needs Node >= 20.19 or >= 22.12. CCP4 ships its own Node 16 in
# /opt/xtal/ccp4-9/bin, which can sit ahead of nvm on PATH, so we load nvm
# explicitly and put its Node first for this script only.

cd "$(dirname "$0")" || exit 1

# Load nvm (it is a shell function, not available in scripts by default).
# Done before 'set -e -u' because nvm.sh is not compatible with them.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null || { echo "nvm: Node 22 not installed (run: nvm install 22)"; exit 1; }
  export PATH="$NVM_BIN:$PATH"
  hash -r
fi

set -euo pipefail

echo "Using node $(node -v) and npm $(npm -v)"
case "$(node -v)" in
  v2[2-9].*|v[3-9]?.*) ;;
  *) echo "Node $(node -v) is too old for Vite: need Node 22 (nvm install 22)"; exit 1 ;;
esac

# Same as CI: install exactly what package-lock.json says, without changing it.
npm ci
npm run build

echo
echo "Built: $(pwd)/dist/index.html"

case "${1:-}" in
  --preview) npx vite preview ;;
  --open)    xdg-open dist/index.html >/dev/null 2>&1 & ;;
esac
