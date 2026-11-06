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
//   C    crystal frame on / off (same as the sidebar switch)
//   N/P  next / previous experiment in the list becomes the active one
//        (wraps around at the ends)
//   R    spin on / off
//   F    fullscreen on / off
//   I    show only indexed spots      (again: all spots)
//   Shift+I  show only integrated spots  (again: all spots)
//   U    show only unindexed spots    (again: all spots)
//   Shift+U  show all spots
//   T    show / hide the active experiment's spots
//   ?    show / hide the list of all shortcuts (Esc closes it)
// Ignored while typing in a field or while a dialog is open, so Tab still
// moves between fields there.

function _initShortcuts() {
  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key === 'Escape' && _shortcutsShown()) {
      _toggleShortcuts(false);
      return;
    }
    if (_typingInField(e.target) || _dialogOpen()) return;
    if (e.key === '?') {
      e.preventDefault();
      _toggleShortcuts();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();   // don't move keyboard focus
      document.getElementById('btn-collapse')?.click();
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      document.getElementById('btn-open-dials')?.click();
    } else if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      document.getElementById('tog-crystal-frame')?.click();
    } else if ('nNpP'.includes(e.key)) {
      e.preventDefault();
      _stepActiveExperiment(e.key.toLowerCase() === 'n' ? 1 : -1);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      document.getElementById('btn-spin')?.click();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      document.getElementById('btn-fullscreen')?.click();
    } else if (e.key === 'i' || e.key === 'I') {
      // Shift (not the letter's case) decides, so Caps Lock doesn't matter.
      e.preventDefault();
      _toggleShowMode(e.shiftKey ? 'integrated' : 'indexed');
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      _toggleActiveExperiment();
    } else if (e.key === 'u' || e.key === 'U') {
      e.preventDefault();
      if (e.shiftKey) _setShowMode('all');
      else            _toggleShowMode('unindexed');
    }
  });
}

/**
 * Select "Show spots: <mode>" in the sidebar, or "All" if <mode> is
 * already selected. Clicks the radio button, so it behaves exactly like
 * clicking it.
 */
function _toggleShowMode(mode) {
  const cur = document.querySelector('input[name="show-group"]:checked');
  _setShowMode(cur?.value === mode ? 'all' : mode);
}

function _setShowMode(mode) {
  document.querySelector(`input[name="show-group"][value="${mode}"]`)
    ?.click();
}

/**
 * Click the show/hide switch in the active experiment's row of the
 * sidebar list (so it behaves exactly like clicking it).
 */
function _toggleActiveExperiment() {
  const radio = document.querySelector('#exp-list .exp-radio:checked');
  radio?.closest('.exp-row')?.querySelector('.toggle')?.click();
}

/**
 * Make the next (step = 1) or previous (step = -1) experiment in the
 * sidebar list the active one, wrapping around at the ends. Clicks its
 * radio button, so it behaves exactly like clicking it.
 */
function _stepActiveExperiment(step) {
  const radios = [...document.querySelectorAll('#exp-list .exp-radio')]
    .filter(r => !r.disabled);
  if (radios.length === 0) return;
  const cur = radios.findIndex(r => r.checked);
  const next = cur < 0
    ? (step > 0 ? 0 : radios.length - 1)
    : (cur + step + radios.length) % radios.length;
  radios[next].click();
  radios[next].closest('.exp-row')
    ?.scrollIntoView({ block: 'nearest' });
}

// ── Shortcut list ("?") ───────────────────

const SHORTCUTS = [
  ['Mouse', [
    ['Drag', 'rotate'],
    ['Shift + drag', 'roll'],
    ['Right-drag', 'pan'],
    ['Scroll', 'zoom'],
    ['Double-click a spot', 'rotate around it'],
    ['Click the green dot', 'rotate around the origin'],
    ['Click a spot', 'select it'],
    ['Shift / Ctrl + click', 'add to / remove from the selection'],
    ['Gizmo: drag / click axis', 'rotate / look along that axis'],
  ]],
  ['Keys', [
    ['W / S', 'zoom in / out'],
    ['A / D', 'move left / right'],
    ['Q / E', 'move down / up'],
    ['C', 'crystal frame on / off'],
    ['R', 'spin on / off'],
    ['F', 'fullscreen on / off'],
    ['I', 'only indexed spots / all'],
    ['Shift + I', 'only integrated spots / all'],
    ['U', 'only unindexed spots / all'],
    ['Shift + U', 'all spots'],
    ['N / P', 'next / previous experiment'],
    ['T', 'show / hide the active experiment'],
    ['Tab', 'show / hide the sidebar'],
    ['O', 'open files'],
    ['?', 'show / hide this list'],
  ]],
  ['Desktop app', [
    ['Ctrl +  /  −  /  0', 'bigger / smaller / normal text'],
  ]],
];

let _shortcutsEl = null;

function _shortcutsShown() {
  return !!_shortcutsEl && _shortcutsEl.style.display !== 'none';
}

function _toggleShortcuts(show = !_shortcutsShown()) {
  if (!_shortcutsEl) {
    const wrap = document.getElementById('canvas-wrap');
    if (!wrap) return;
    _shortcutsEl = document.createElement('div');
    _shortcutsEl.id = 'shortcuts';
    const close = document.createElement('button');
    close.className = 'sc-close';
    close.textContent = '×';
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => _toggleShortcuts(false));
    _shortcutsEl.appendChild(close);
    for (const [title, rows] of SHORTCUTS) {
      const h = document.createElement('div');
      h.className = 'sc-title';
      h.textContent = title;
      _shortcutsEl.appendChild(h);
      for (const [key, what] of rows) {
        const row = document.createElement('div');
        row.className = 'sc-row';
        const k = document.createElement('span');
        k.className = 'sc-key';
        k.textContent = key;
        const w = document.createElement('span');
        w.textContent = what;
        row.append(k, w);
        _shortcutsEl.appendChild(row);
      }
    }
    wrap.appendChild(_shortcutsEl);
  }
  _shortcutsEl.style.display = show ? 'block' : 'none';
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
