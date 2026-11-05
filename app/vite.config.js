import { defineConfig } from 'vite';
import { viteSingleFile } from
  'vite-plugin-singlefile';
import { execSync } from 'node:child_process';

// Version shown in the corner of the 3D view. From git: "v0.1.4" on a
// tagged commit, "v0.1.4-3-gabc1234" three commits later, "-dirty" if
// there are uncommitted changes. RLV_VERSION overrides it.
function appVersion() {
  if (process.env.RLV_VERSION) return process.env.RLV_VERSION;
  try {
    return execSync('git describe --tags --always --dirty', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: './',   // relative paths so the page works under /rlv/ on GitHub Pages
  plugins: [viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  build: {
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
});
