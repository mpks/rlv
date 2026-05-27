/**
 * ui/dropzone.js
 *
 * Drag-and-drop file loading onto the 3D
 * canvas.  Drop an .expt + .refl pair
 * (multi-select both in the file manager,
 * then drag) to load them.
 *
 * If data is already present a small dialog
 * asks whether to add or replace.
 */

import { store } from '../state/store.js';

let _onLoad = null;
let _dlg    = null;

export function initDropZone(onLoad) {
  _onLoad = onLoad;
  _dlg    = _buildDialog();

  const wrap =
    document.getElementById('canvas-wrap');
  if (!wrap) return;

  wrap.addEventListener('dragover', e => {
    if (!_hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    wrap.classList.add('drag-over');
  });

  wrap.addEventListener('dragleave', e => {
    if (!wrap.contains(e.relatedTarget)) {
      wrap.classList.remove('drag-over');
    }
  });

  wrap.addEventListener('drop', e => {
    e.preventDefault();
    wrap.classList.remove('drag-over');
    _handleDrop(e.dataTransfer.files);
  });
}

// ── Drop handling ─────────────────────────

function _handleDrop(fileList) {
  const files = Array.from(fileList);
  const expt  = files.find(f =>
    f.name.toLowerCase().endsWith('.expt'));
  const refl  = files.find(f =>
    f.name.toLowerCase().endsWith('.refl'));

  if (!expt && !refl) return;

  if (!expt || !refl) {
    const which = expt ? '.refl' : '.expt';
    alert(
      `Also drop the ${which} file —`
      + ` select both in your file manager`
      + ` before dragging.`);
    return;
  }

  if (store.datasets.length === 0) {
    _onLoad(expt, refl, 'replace');
  } else {
    _showDialog(expt, refl);
  }
}

// ── Add / replace dialog ──────────────────

function _showDialog(expt, refl) {
  _dlg.querySelector('#dmd-name')
    .textContent =
      `${expt.name}  +  ${refl.name}`;

  _dlg.querySelector('#dmd-add')
    .onclick = () => {
      _dlg.style.display = 'none';
      _onLoad(expt, refl, 'add');
    };

  _dlg.querySelector('#dmd-replace')
    .onclick = () => {
      _dlg.style.display = 'none';
      _onLoad(expt, refl, 'replace');
    };

  _dlg.querySelector('#dmd-cancel')
    .onclick = () => {
      _dlg.style.display = 'none';
    };

  _dlg.style.display = 'flex';
}

function _buildDialog() {
  const overlay =
    document.createElement('div');
  overlay.style.cssText =
    'display:none;position:fixed;inset:0;'
    + 'background:rgba(0,0,0,.7);'
    + 'align-items:center;'
    + 'justify-content:center;z-index:9999';

  overlay.innerHTML = `
    <div style="background:#111118;
                border:1px solid #2a2a3a;
                border-radius:10px;
                padding:24px;width:380px">
      <div style="font-size:15px;
                  font-weight:600;
                  color:#eee;
                  margin-bottom:8px">
        Load dropped files
      </div>
      <div id="dmd-name"
           style="font-size:11px;
                  color:#666;
                  margin-bottom:12px;
                  word-break:break-all">
      </div>
      <div style="font-size:12px;
                  color:#aaa;
                  margin-bottom:20px">
        Data is already loaded.
        Add these spots to the current view,
        or replace everything?
      </div>
      <div style="display:flex;
                  justify-content:flex-end;
                  gap:8px">
        <button id="dmd-cancel"
          style="padding:6px 16px;
                 background:transparent;
                 border:1px solid #333;
                 border-radius:4px;
                 color:#999;cursor:pointer">
          Cancel
        </button>
        <button id="dmd-replace"
          style="padding:6px 16px;
                 background:transparent;
                 border:1px solid #333;
                 border-radius:4px;
                 color:#999;cursor:pointer">
          Replace
        </button>
        <button id="dmd-add"
          style="padding:6px 16px;
                 background:#152a42;
                 border:1px solid #185FA5;
                 border-radius:4px;
                 color:#7ab8f5;
                 cursor:pointer;
                 font-weight:600">
          Add
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  return overlay;
}

// ── Helpers ───────────────────────────────

function _hasFiles(e) {
  return e.dataTransfer?.types
    ?.includes('Files') ?? false;
}
