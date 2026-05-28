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
      document.getElementById('toolbar')
        .classList.toggle('hidden');
      document.body
        .classList.toggle('sidebar-hidden');
      document.body
        .classList.toggle('toolbar-hidden');
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
}
