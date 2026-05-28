/**
 * filters/filters.js
 *
 * applyFilters() reads store.filters,
 * iterates all spots across all datasets,
 * writes store.visibleSet, and calls
 * applyVisibility() on the points object.
 *
 * Call this whenever any filter changes.
 */

import { store } from '../state/store.js';
import {
  getPointsObject,
} from '../scene/renderer.js';
import {
  applyVisibility,
} from '../scene/points.js';
import {
  setSpotCount,
} from '../ui/statusbar.js';

/**
 * Recompute visibility for every spot
 * and push it to the GPU.
 */
export function applyFilters() {
  const n = totalSpots();
  if (n === 0) return;

  const vis = new Uint8Array(n);
  const f   = store.filters;
  let globalIdx = 0;
  let visible   = 0;

  for (const ds of store.datasets) {
    if (!ds.visible) {
      // Skip entire dataset
      globalIdx +=
        ds.rawData.points.length;
      continue;
    }
    const d = ds.rawData.data;
    const np = ds.rawData.points.length;

    for (let i = 0; i < np; i++) {
      const expKey =
        `${ds.id}:${d.id[i]}`;

      // Experiment visibility
      if (!f.visibleExpts.has(expKey)) {
        globalIdx++;
        continue;
      }

      // Frozen by crystal-frame mode
      if (store.overlays.crystalFrame
          && store.frozenExpts.has(expKey)) {
        globalIdx++;
        continue;
      }

      // Spot category filter
      const integr  = d.integrated_status[i];
      const indexed = d.indexed_status[i];
      const outlier = d.outlier_status[i];
      const mode    = f.showMode;

      if (mode === 'indexed'
          && !indexed) {
        globalIdx++; continue;
      }
      if (mode === 'unindexed'
          && indexed) {
        globalIdx++; continue;
      }
      if (mode === 'integrated'
          && !integr) {
        globalIdx++; continue;
      }

      if (outlier  && !f.showOutliers) {
        globalIdx++; continue;
      }
      if (!outlier && !f.showInliers) {
        globalIdx++; continue;
      }

      // d-spacing filter (Å)
      const dsp = d.d_spacing[i];
      if (dsp < f.dMin
          || dsp > f.dMax) {
        globalIdx++; continue;
      }

      // Image / frame filter
      const z = d.z[i];
      if (f.zMax <= f.zMin
          || z < f.zMin || z > f.zMax) {
        globalIdx++; continue;
      }

      // Spot size (bbox pixel area)
      // stored as px count if available
      if (d.px_count) {
        const px = d.px_count[i];
        if (f.pxMax <= f.pxMin
            || px < f.pxMin
            || px > f.pxMax) {
          globalIdx++; continue;
        }
      }


      vis[globalIdx] = 1;
      visible++;
      globalIdx++;
    }
  }

  store.visibleSet = vis;
  applyVisibility(getPointsObject(), vis);
  setSpotCount(visible, n);
}

/**
 * Helper: total spots across all datasets.
 */
function totalSpots() {
  return store.datasets.reduce(
    (s, d) =>
      s + d.rawData.points.length, 0);
}


// ── Individual filter setters ─────────────
// Each setter updates the store and
// immediately re-runs applyFilters().

export function setDMin(v) {
  const p = parseFloat(v);
  store.filters.dMin = isNaN(p) ? 0 : p;
  applyFilters();
}
export function setDMax(v) {
  const p = parseFloat(v);
  store.filters.dMax =
    isNaN(p) ? Infinity : p;
  applyFilters();
}
export function setZMin(v) {
  const p = parseFloat(v);
  store.filters.zMin = isNaN(p) ? 0 : p;
  applyFilters();
}
export function setZMax(v) {
  const p = parseFloat(v);
  store.filters.zMax =
    isNaN(p) ? Infinity : p;
  applyFilters();
}
export function setPxMin(v) {
  const p = parseFloat(v);
  store.filters.pxMin = isNaN(p) ? 0 : p;
  applyFilters();
}
export function setPxMax(v) {
  const p = parseFloat(v);
  store.filters.pxMax =
    isNaN(p) ? Infinity : p;
  applyFilters();
}
export function setShowMode(mode) {
  store.filters.showMode = mode;
  applyFilters();
}
export function setShowInliers(v) {
  store.filters.showInliers = !!v;
  applyFilters();
}
export function setShowOutliers(v) {
  store.filters.showOutliers = !!v;
  applyFilters();
}
export function setExpVisible(
  datasetId, expId, visible
) {
  const key = `${datasetId}:${expId}`;
  if (visible) {
    store.filters.visibleExpts.add(key);
  } else {
    store.filters.visibleExpts.delete(key);
  }
  applyFilters();
}
