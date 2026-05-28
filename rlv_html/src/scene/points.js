/**
 * scene/points.js
 *
 * Builds and updates the Three.js Points
 * object from merged multi-dataset data.
 *
 * The geometry has three buffer attributes:
 *   position  — xyz in scene units
 *   color     — rgb (0..1)
 *   alpha     — per-spot opacity (0=hidden, >0=opacity)
 *
 * Only alpha and color are updated at
 * runtime; position never changes after
 * the initial build.
 */

import * as THREE from 'three';
import { store } from '../state/store.js';
import { expColor }
  from '../filters/colors.js';

const VERT = `
  attribute float alpha;
  varying   vec3  vColor;
  varying   float vAlpha;
  uniform   float pointSize;
  void main() {
    vColor    = color;
    vAlpha    = alpha;
    gl_PointSize = pointSize;
    gl_Position  = projectionMatrix
      * modelViewMatrix
      * vec4(position, 1.0);
  }
`;

const FRAG = `
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    if (dot(uv, uv) > 0.25) discard;
    if (vAlpha < 0.001) discard;
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

/**
 * Build a new Points object from all
 * visible datasets in the store.
 * Returns THREE.Points (caller adds to
 * scene via renderer.setPointsObject).
 */
export function buildPointCloud(
  pointSize = 5.0
) {
  // Merge all datasets
  const allPts  = [];
  const allCols = [];

  for (const ds of store.datasets) {
    const pts  = ds.rawData.points;
    const cols = ds.rawData.colors;
    for (let i = 0; i < pts.length; i++) {
      allPts.push(pts[i]);
      allCols.push(cols[i]);
    }
  }

  const n = allPts.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const alp = new Float32Array(n)
    .fill(1.0);

  for (let i = 0; i < n; i++) {
    pos[i*3]   = allPts[i][0];
    pos[i*3+1] = allPts[i][1];
    pos[i*3+2] = allPts[i][2];
    col[i*3]   = allCols[i][0];
    col[i*3+1] = allCols[i][1];
    col[i*3+2] = allCols[i][2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',
    new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color',
    new THREE.BufferAttribute(col, 3));
  geo.setAttribute('alpha',
    new THREE.BufferAttribute(alp, 1));

  const mat = new THREE.ShaderMaterial({
    vertexColors: true,
    transparent:  true,
    depthWrite:   false,
    uniforms: {
      pointSize: { value: pointSize },
    },
    vertexShader:   VERT,
    fragmentShader: FRAG,
  });

  return new THREE.Points(geo, mat);
}

// ── Buffer attribute updates ──────────────

/**
 * Apply visibleSet to the alpha buffer.
 * visibleSet is a Uint8Array where
 * 1 = visible, 0 = hidden.
 */
export function applyVisibility(
  pointsObj, visibleSet
) {
  if (!pointsObj || !visibleSet) return;
  const attr = pointsObj.geometry
    .attributes.alpha;
  let g = 0;
  for (const ds of store.datasets) {
    const ids = ds.rawData.data.id;
    for (let i = 0; i < ids.length; i++) {
      if (visibleSet[g]) {
        const key = `${ds.id}:${ids[i]}`;
        attr.array[g] =
          store.expOpacityOverrides[key] ?? 1.0;
      } else {
        attr.array[g] = 0.0;
      }
      g++;
    }
  }
  attr.needsUpdate = true;
}

/**
 * Update colours for all spots belonging
 * to one experiment in one dataset.
 * hex: '#rrggbb'
 */
export function applyExpColor(
  pointsObj, datasetId, expId, hex
) {
  if (!pointsObj) return;
  const color = new THREE.Color(hex);
  const attr  = pointsObj.geometry
    .attributes.color;

  // Build offset map once, lazily
  let globalIdx = 0;
  for (const ds of store.datasets) {
    const ids = ds.rawData.data.id;
    for (let i = 0; i < ids.length; i++) {
      if (ds.id === datasetId
          && ids[i] === expId) {
        attr.setXYZ(
          globalIdx,
          color.r, color.g, color.b);
      }
      globalIdx++;
    }
  }
  attr.needsUpdate = true;
}

/**
 * Highlight selected spots in white;
 * restore non-selected to their original
 * dataset colour.
 */
export function applySelection(
  pointsObj, selectionSet
) {
  if (!pointsObj) return;
  const attr = pointsObj.geometry
    .attributes.color;
  const white = new THREE.Color(1, 1, 1);

  let globalIdx = 0;
  for (const ds of store.datasets) {
    const pts       = ds.rawData.points;
    const ids       = ds.rawData.data.id;
    const expOffset = ds.expOffset  ?? 0;
    const colorOff  = ds.colorOffset ?? 0;
    for (let i = 0; i < pts.length; i++) {
      if (selectionSet.has(globalIdx)) {
        attr.setXYZ(
          globalIdx,
          white.r, white.g, white.b);
      } else {
        const expId  = ids[i];
        const key    = `${ds.id}:${expId}`;
        const colorId =
          colorOff + (expId - expOffset);
        const hex =
          store.expColorOverrides[key]
          ?? expColor(colorId);
        const c = new THREE.Color(hex);
        attr.setXYZ(
          globalIdx, c.r, c.g, c.b);
      }
      globalIdx++;
    }
  }
  attr.needsUpdate = true;
}

// ── Uniform updates ───────────────────────

export function setPointSize(obj, size) {
  if (!obj) return;
  obj.material.uniforms.pointSize
    .value = size;
}
