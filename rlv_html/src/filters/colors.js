/**
 * filters/colors.js
 *
 * Recolour the point cloud by different
 * modes: experiment, resolution, intensity,
 * I/sigma.
 *
 * Each function rewrites the color buffer
 * attribute directly.
 */

import * as THREE from 'three';
import { store } from '../state/store.js';
import {
  getPointsObject,
} from '../scene/renderer.js';

// Golden-ratio hue spacing: maximally
// distinct color for any experiment id,
// no palette limit.
export function expColor(id) {
  // 0.1 offset so id=0 starts at orange,
  // not red (hue 0)
  const hue = (id * 0.618033988749895 + 0.1) % 1.0;
  const c = new THREE.Color();
  c.setHSL(hue, 0.80, 0.55);
  return '#' + c.getHexString();
}

/**
 * Recolour by the current colorMode
 * in store.filters.
 */
export function recolour() {
  const mode = store.filters.colorMode;
  switch (mode) {
    case 'experiment':
      recolourByExperiment(); break;
    case 'resolution':
      recolourByResolution(); break;
    case 'intensity':
      recolourByIntensity(); break;
    case 'ioversigma':
      recolourByIOverSigma(); break;
    default:
      recolourByExperiment();
  }
}

// ── Colour modes ──────────────────────────

export function recolourByExperiment() {
  _recolour((_ds, i) => {
    const expId = _ds.rawData.data.id[i];
    const key = `${_ds.id}:${expId}`;
    const colorId =
      (_ds.colorOffset ?? 0)
      + (expId - (_ds.expOffset ?? 0));
    const hex =
      store.expColorOverrides[key]
      ?? expColor(colorId);
    return new THREE.Color(hex);
  });
}

export function recolourByResolution() {
  // Gather d-spacing range first
  let lo = Infinity, hi = 0;
  for (const ds of store.datasets) {
    for (const d of
        ds.rawData.data.d_spacing) {
      if (d > 0 && d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }
  const range = hi - lo || 1;

  _recolour((_ds, i) => {
    const d =
      _ds.rawData.data.d_spacing[i];
    const t = Math.max(0, Math.min(1,
      (d - lo) / range));
    // low d (high res) → blue (0.66)
    // high d (low res) → red (0)
    const c = new THREE.Color();
    c.setHSL(0.66 * (1 - t), 1, 0.5);
    return c;
  });
}

export function recolourByIntensity() {
  let lo = Infinity, hi = -Infinity;
  for (const ds of store.datasets) {
    const arr = ds.rawData.data.intensity;
    if (!arr) continue;
    for (const v of arr) {
      if (v !== null && v < lo) lo = v;
      if (v !== null && v > hi) hi = v;
    }
  }
  const range = hi - lo || 1;

  _recolour((_ds, i) => {
    const v =
      _ds.rawData.data.intensity?.[i];
    const t = v !== null
      ? Math.max(0, Math.min(1,
          (v - lo) / range))
      : 0.5;
    const c = new THREE.Color();
    c.setHSL(0.66 * (1 - t), 1, 0.5);
    return c;
  });
}

export function recolourByIOverSigma() {
  let hi = 0;
  for (const ds of store.datasets) {
    const I = ds.rawData.data.intensity;
    const s = ds.rawData.data.sigma;
    if (!I || !s) continue;
    for (let i = 0; i < I.length; i++) {
      if (s[i] > 0) {
        const ios = I[i] / s[i];
        if (ios > hi) hi = ios;
      }
    }
  }
  hi = Math.min(hi, 50) || 50;

  _recolour((_ds, i) => {
    const I =
      _ds.rawData.data.intensity?.[i];
    const s =
      _ds.rawData.data.sigma?.[i];
    const ios =
      (I != null && s > 0)
        ? I / s : 0;
    const t = Math.max(0,
      Math.min(1, ios / hi));
    const c = new THREE.Color();
    c.setHSL(0.66 * (1 - t), 1, 0.5);
    return c;
  });
}

// ── Internal helper ───────────────────────

/**
 * Walk every spot, call colorFn(ds, i,
 * globalIdx) → THREE.Color, write to
 * the color buffer.
 */
function _recolour(colorFn) {
  const obj = getPointsObject();
  if (!obj) return;
  const attr = obj.geometry
    .attributes.color;

  let g = 0;
  for (const ds of store.datasets) {
    const n = ds.rawData.points.length;
    for (let i = 0; i < n; i++) {
      const c = colorFn(ds, i, g);
      attr.setXYZ(g, c.r, c.g, c.b);
      g++;
    }
  }
  attr.needsUpdate = true;
}
