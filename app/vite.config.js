import { defineConfig } from 'vite';
import { viteSingleFile } from
  'vite-plugin-singlefile';

export default defineConfig({
  base: './',   // relative paths so the page works under /rlv/ on GitHub Pages
  plugins: [viteSingleFile()],
  build: {
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
  },
});
