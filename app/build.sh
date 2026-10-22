#!/usr/bin/env bash
# Build the single-file RLV app into dist/index.html.
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
fi

set -euo pipefail

echo "Using node $(node -v) and npm $(npm -v)"

npm install
npm run build
