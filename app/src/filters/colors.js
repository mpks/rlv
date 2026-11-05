/**
 * filters/colors.js
 *
 * Spot colours: by experiment (default), or by a quantity chosen in the
 * "Colour by" menu (resolution, intensity, I/sigma, sigma, spot size,
 * image index).
 *
 * Each function rewrites the color buffer
 * attribute directly.
 */

import * as THREE from 'three';
import { store } from '../state/store.js';
import {
  getPointsObject,
} from '../scene/renderer.js';

/**
 * Default colour of spots in no lattice (experiment id -1): white, as in
 * the DIALS viewer. Each experiment can change it with the second circle
 * in its row of the experiment list (for the id -1 spots on its images).
 * As in DIALS, spots that are merely not indexed yet (e.g. strong.refl,
 * before indexing) keep their experiment's colour.
 */
export const UNINDEXED_COLOR = '#ffffff';

/** Experiment a spot belongs to for colour and show/hide (always >= 0). */
export function spotOwner(ds, i) {
  return ds.rawData.data.owner?.[i] ?? ds.rawData.data.id[i];
}

/** True if spot i belongs to no lattice (experiment id -1). */
export function isUnindexed(ds, i) {
  return ds.rawData.data.id[i] < 0;
}

/** Colour ('#rrggbb') of experiment expId's indexed/integrated spots. */
export function expColorOf(ds, expId) {
  return store.expColorOverrides[`${ds.id}:${expId}`]
    ?? expColor((ds.colorOffset ?? 0) + (expId - (ds.expOffset ?? 0)));
}

/** Colour ('#rrggbb') of experiment expId's unindexed spots. */
export function unindexedColorOf(ds, expId) {
  return store.unindexedColorOverrides[`${ds.id}:${expId}`]
    ?? UNINDEXED_COLOR;
}

/**
 * Colour ('#rrggbb') of spot i of dataset ds in "experiment" mode: the
 * experiment's unindexed colour (white) for spots in no lattice (id -1),
 * else the experiment's colour. (Integrated-but-not-indexed spots keep the
 * experiment colour and are made fainter instead; see spotOpacityFactor.)
 */
export function spotColor(ds, i) {
  const expId = spotOwner(ds, i);
  return isUnindexed(ds, i)
    ? unindexedColorOf(ds, expId)
    : expColorOf(ds, expId);
}

/** True if spot i is integrated but not indexed (a predicted position). */
export function isIntegratedOnly(ds, i) {
  const d = ds.rawData.data;
  return !d.indexed_status[i] && !!d.integrated_status[i];
}

/**
 * Extra opacity factor for spot i: the "Integrated, not indexed" slider
 * for integrated-only spots, 1 for all others.
 */
export function spotOpacityFactor(ds, i) {
  return isIntegratedOnly(ds, i) ? store.integratedOpacity : 1;
}

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

// ── Colour by ─────────────────────────────

/**
 * The "Colour by" options. Each value getter returns a number for spot i,
 * or NaN when the spot has no such value (shown grey).
 */
export const COLOR_MODES = [
  { id: 'experiment', label: 'Experiment' },
  { id: 'resolution', label: 'Resolution (Å)',
    value: (d, i) => d.d_spacing[i] > 0 ? d.d_spacing[i] : NaN },
  { id: 'intensity',  label: 'Intensity',
    value: (d, i) => d.intensity?.[i] ?? NaN },
  { id: 'ioversigma', label: 'I/σ',
    value: (d, i) => d.sigma?.[i] > 0 ? d.intensity[i] / d.sigma[i] : NaN },
  { id: 'sigma',      label: 'σ(I)',
    value: (d, i) => d.sigma?.[i] > 0 ? d.sigma[i] : NaN },
  { id: 'spotsize',   label: 'Spot size (pixels)',
    value: (d, i) => d.px_count?.[i] > 0 ? d.px_count[i] : NaN },
  { id: 'image',      label: 'Image index', fullRange: true,
    value: (d, i) => Number.isFinite(d.z?.[i]) ? d.z[i] : NaN },
  // Experiment number within its dataset, on a smooth scale: readable
  // where there are too many experiments for distinct colours (e.g. many
  // one-image sweeps). Needs the dataset, so it uses dsValue.
  { id: 'expnum',     label: 'Experiment number', fullRange: true,
    dsValue: (ds, i) => spotOwner(ds, i) - (ds.expOffset ?? 0) },
];

/** Value of the chosen quantity for spot i of dataset ds (NaN if none). */
function _valueOf(mode, ds, i) {
  return mode.dsValue ? mode.dsValue(ds, i) : mode.value(ds.rawData.data, i);
}

/** Colour of spots that have no value for the chosen quantity. */
export const NO_VALUE_COLOR = '#555555';

// Current colour scale, set by recolour(): { mode, lo, hi, count }
let _scale = { mode: COLOR_MODES[0], lo: 0, hi: 1, count: 0 };
const _scaleListeners = [];

/** Call cb(scale) whenever the colour scale changes (for the legend). */
export function onColorScaleChange(cb) { _scaleListeners.push(cb); }

/**
 * Value range shown by the colour scale, over all loaded datasets: the
 * 2nd to 98th percentile (so a few extreme spots don't squash everything
 * into one colour), or min to max for modes with fullRange.
 */
function _computeScale(mode) {
  const vals = [];
  for (const ds of store.datasets) {
    for (let i = 0; i < ds.rawData.points.length; i++) {
      const v = _valueOf(mode, ds, i);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  if (vals.length === 0) return { mode, lo: 0, hi: 1, count: 0 };
  const sorted = Float64Array.from(vals).sort();
  const q = f => sorted[Math.min(sorted.length - 1,
                                 Math.max(0, Math.round(f * (sorted.length - 1))))];
  let lo = mode.fullRange ? sorted[0] : q(0.02);
  let hi = mode.fullRange ? sorted[sorted.length - 1] : q(0.98);
  if (!(hi > lo)) hi = lo + 1;
  return { mode, lo, hi, count: sorted.length };
}

/** Colour for t in 0..1: blue (low) through cyan, green, yellow to red (high). */
export function rampColor(t) {
  const c = new THREE.Color();
  c.setHSL(0.66 * (1 - Math.max(0, Math.min(1, t))), 1, 0.5);
  return '#' + c.getHexString();
}

/**
 * Colour ('#rrggbb') spot i of dataset ds is drawn with in the current
 * "Colour by" mode. Code that restores spot colours (selection,
 * resolution sphere) must use this, not spotColor().
 */
export function displayColor(ds, i) {
  const { mode, lo, hi } = _scale;
  if (mode.id === 'experiment') return spotColor(ds, i);
  const v = _valueOf(mode, ds, i);
  return Number.isFinite(v) ? rampColor((v - lo) / (hi - lo)) : NO_VALUE_COLOR;
}

/** Current colour scale ({ mode, lo, hi, count }). */
export function getColorScale() { return _scale; }

/**
 * Recolour all spots by store.filters.colorMode. Also called after loading
 * or removing data, so the range always covers the datasets now loaded.
 */
export function recolour() {
  const mode = COLOR_MODES.find(m => m.id === store.filters.colorMode)
    ?? COLOR_MODES[0];
  _scale = mode.id === 'experiment'
    ? { mode, lo: 0, hi: 1, count: 0 }
    : _computeScale(mode);
  _recolour((ds, i) => new THREE.Color(displayColor(ds, i)));
  for (const cb of _scaleListeners) cb(_scale);
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
