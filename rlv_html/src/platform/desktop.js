/**
 * platform/desktop.js
 *
 * Extra behaviour when the viewer runs inside the Tauri desktop app.
 * In a normal browser none of this runs and the page behaves as before.
 *
 * The Linux web engine used by Tauri (WebKitGTK) handles some browser
 * features poorly, so the app replaces them with native versions:
 *
 *  - Open → Browse…: native file dialog with .expt/.refl filters, starting
 *    in the last folder used (remembered between sessions).
 *  - Drag and drop: the window receives dropped files natively (as paths);
 *    they are read and passed to the same handler the web page uses.
 *  - Zoom: Ctrl + scroll and Ctrl +/−/0 zoom the whole interface, as in a
 *    browser. The level is remembered.
 *
 * Files are read by the app's `read_file` command (src-tauri/src/lib.rs).
 */

import { setPendingFile } from '../ui/dialog.js';
import { handleDroppedFiles, setDragHighlight } from '../ui/dropzone.js';
import { showError } from '../ui/statusbar.js';

/** True when running inside the Tauri app. */
export const isDesktop =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const LAST_DIR_KEY = 'rlv.lastDir';
const ZOOM_KEY = 'rlv.zoom';

export async function initDesktop() {
  if (!isDesktop) return;

  // Loaded only in the app; in a browser these modules are never used.
  const { invoke } = await import('@tauri-apps/api/core');
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const { open } = await import('@tauri-apps/plugin-dialog');
  const webview = getCurrentWebview();

  /** Read a file from disk and wrap it as a browser File. */
  async function readAsFile(path) {
    const bytes = await invoke('read_file', { path });
    return new File([bytes], _basename(path));
  }

  // ── Open dialog: native Browse… ────────────────────────────

  function hookBrowse(kind, label) {
    const input = document.getElementById(`dlg-${kind}-input`);
    if (!input) return;
    // Clicking the "Browse…" label clicks this hidden <input type="file">.
    // Cancel that, and show the native dialog instead.
    input.addEventListener('click', async e => {
      e.preventDefault();
      try {
        const path = await open({
          title: `Select ${label}`,
          defaultPath: _load(LAST_DIR_KEY) ?? undefined,
          multiple: false,
          directory: false,
          filters: [
            { name: label, extensions: [kind] },
            { name: 'All files', extensions: ['*'] },
          ],
        });
        if (!path) return;                        // cancelled
        _save(LAST_DIR_KEY, _dirname(path));
        setPendingFile(kind, await readAsFile(path));
      } catch (err) {
        showError(err?.message || String(err));
        console.error(err);
      }
    });
  }
  hookBrowse('expt', 'DIALS experiment (.expt)');
  hookBrowse('refl', 'DIALS reflections (.refl)');

  // ── Drag and drop ───────────────────────────────────────────

  await webview.onDragDropEvent(async ({ payload }) => {
    if (payload.type === 'enter' || payload.type === 'over') {
      setDragHighlight(true);
    } else if (payload.type === 'leave') {
      setDragHighlight(false);
    } else if (payload.type === 'drop') {
      setDragHighlight(false);
      // Read only the files the viewer uses (not e.g. a dropped image stack).
      const paths = payload.paths.filter(p => /\.(expt|refl)$/i.test(p));
      if (paths.length === 0) return;
      try {
        _save(LAST_DIR_KEY, _dirname(paths[0]));
        handleDroppedFiles(await Promise.all(paths.map(readAsFile)));
      } catch (err) {
        showError(err?.message || String(err));
        console.error(err);
      }
    }
  });

  // ── Zoom ────────────────────────────────────────────────────

  const STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  let zoom = Number(_load(ZOOM_KEY)) || 1;

  async function setZoom(z) {
    zoom = Math.min(STEPS.at(-1), Math.max(STEPS[0], z));
    _save(ZOOM_KEY, String(zoom));
    await webview.setZoom(zoom);
  }
  const zoomIn  = () => setZoom(STEPS.find(s => s > zoom + 1e-6) ?? zoom);
  const zoomOut = () => setZoom([...STEPS].reverse().find(s => s < zoom - 1e-6) ?? zoom);

  if (zoom !== 1) setZoom(zoom);

  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
    else if (e.key === '-')             { e.preventDefault(); zoomOut(); }
    else if (e.key === '0')             { e.preventDefault(); setZoom(1); }
  });

  // Ctrl + scroll. Over the 3D view the scroll zooms the camera instead
  // (its handler calls preventDefault), the same as in a browser.
  window.addEventListener('wheel', e => {
    if (!e.ctrlKey || e.defaultPrevented) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn(); else if (e.deltaY > 0) zoomOut();
  }, { passive: false });
}

// ── Helpers ───────────────────────────────────────────────────

function _basename(path) {
  return path.split(/[\\/]/).pop();
}

function _dirname(path) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : path;
}

// localStorage can be unavailable; these settings are only conveniences.
function _load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function _save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}
