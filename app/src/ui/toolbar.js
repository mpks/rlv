/**
 * ui/toolbar.js
 */

import { onResize, alignToVector, setSpin }
  from '../scene/renderer.js';

function _stopSpin() {
  setSpin(false);
  document.getElementById('btn-spin')
    ?.classList.remove('active');
}
import { store } from '../state/store.js';

function _activeExpt() {
  if (!store.activeExp) return null;
  const { datasetId, expId } = store.activeExp;
  const ds = store.datasets
    .find(d => d.id === datasetId);
  if (!ds) return null;
  return ds.rawData
    .experiments?.[expId - (ds.expOffset ?? 0)]
    ?? null;
}

function _wire(id, getVec) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const v = getVec();
    if (v) { _stopSpin(); alignToVector(v); }
  });
}

export function initToolbar() {
  const collapse =
    document.getElementById('btn-collapse');
  if (collapse) {
    collapse.addEventListener('click', () => {
      document.getElementById('sidebar')
        .classList.toggle('hidden');
      document.body
        .classList.toggle('sidebar-hidden');
      collapse.textContent =
        collapse.textContent.trim() === '‹'
          ? '›' : '‹';
      setTimeout(onResize, 300);
    });
  }

  const spinBtn =
    document.getElementById('btn-spin');
  if (spinBtn) {
    spinBtn.addEventListener('click', () => {
      const on =
        !spinBtn.classList.contains('active');
      spinBtn.classList.toggle('active', on);
      setSpin(on);
    });
  }

  _wire('btn-align-rot',
    () => _activeExpt()?.rotation_axis);
  _wire('btn-align-beam',
    () => _activeExpt()?.beam_vector);
  _wire('btn-align-astar',
    () => _activeExpt()?.recip_latt_vectors?.[0]);
  _wire('btn-align-bstar',
    () => _activeExpt()?.recip_latt_vectors?.[1]);
  _wire('btn-align-cstar',
    () => _activeExpt()?.recip_latt_vectors?.[2]);

  const fsBtn =
    document.getElementById('btn-fullscreen');
  const fsExpand =
    document.getElementById('fs-icon-expand');
  const fsCompress =
    document.getElementById('fs-icon-compress');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement
          .requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });
    document.addEventListener(
      'fullscreenchange', () => {
        const full = !!document.fullscreenElement;
        fsExpand.style.display =
          full ? 'none' : '';
        fsCompress.style.display =
          full ? '' : 'none';
        setTimeout(onResize, 50);
      });
  }

  _initShortcuts();
}

// ── Keyboard shortcuts ────────────────────
//   Tab  show / hide the sidebar (same as the ‹ button)
//   O    open files (same as the Open button)
// Ignored while typing in a field or while a dialog is open, so Tab still
// moves between fields there.

function _initShortcuts() {
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (_typingInField(e.target) || _dialogOpen()) return;
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();   // don't move keyboard focus
      document.getElementById('btn-collapse')?.click();
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      document.getElementById('btn-open-dials')?.click();
    }
  });
}

function _typingInField(t) {
  return !!t && (t.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

/** True if the Open dialog, the Remote dialog or a colour picker is open. */
function _dialogOpen() {
  const shown = id => {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el).display !== 'none';
  };
  return shown('dlg-open') || shown('dlg-remote')
    || !!document.querySelector('.cp-popup');
}
