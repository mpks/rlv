/**
 * scene/resolutionSpheres.js
 *
 * Single wireframe inspection sphere — a
 * resolution "ruler" the user can drag to
 * any d-spacing to see which spots fall on
 * the same resolution shell.
 *
 * Radius = SCALE / d (Å), matching the
 * reciprocal-lattice coordinate system.
 *
 * The current d-value is projected onto the
 * canvas each frame so the label stays at
 * the sphere's top edge as the view rotates.
 */

import * as THREE from 'three';
import {
  scene, camera, renderer, controls,
  addFrameCallback, getPointsObject,
} from './renderer.js';
import { SCALE } from '../io/rlv_io.js';
import { store } from '../state/store.js';
import { expColor, recolour }
  from '../filters/colors.js';

let _sphere   = null;
let _label    = null;
let _visible  = false;
let _d        = Infinity;
let _rotating = false;

// ── Build globe (lat + lon circles) ──────

function _makeGlobe(color) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.50,
  });

  const nLat = 12, nLon = 18, seg = 96;

  for (let i = 1; i < nLat; i++) {
    const phi = (i / nLat) * Math.PI;
    const y   = Math.cos(phi);
    const r   = Math.sin(phi);
    const pts = [];
    for (let j = 0; j <= seg; j++) {
      const t = (j / seg) * Math.PI * 2;
      pts.push(new THREE.Vector3(
        r * Math.cos(t), y,
        r * Math.sin(t)));
    }
    group.add(new THREE.Line(
      new THREE.BufferGeometry()
        .setFromPoints(pts), mat));
  }

  for (let i = 0; i < nLon; i++) {
    const t = (i / nLon) * Math.PI * 2;
    const pts = [];
    for (let j = 0; j <= seg; j++) {
      const phi = (j / seg) * Math.PI;
      pts.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(t),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(t)));
    }
    group.add(new THREE.Line(
      new THREE.BufferGeometry()
        .setFromPoints(pts), mat));
  }

  group.visible = false;
  return group;
}

// ── Public API ────────────────────────────

export function initInspectionSphere() {
  _sphere = _makeGlobe(0xffffff);
  scene.add(_sphere);
  _label = document.getElementById(
    'inspection-label');
  addFrameCallback(_updateLabelPosition);

  if (controls) {
    controls.addEventListener('start',
      () => { _rotating = true; });
    controls.addEventListener('end', () => {
      _rotating = false;
      _updateLabelPosition();
    });
  }
}

export function setInspectionD(d) {
  _d = d;
  _refresh();
}

export function setInspectionSphereVisible(v) {
  _visible = v;
  _refresh();
}

/**
 * Re-apply the green highlight after any
 * external code rewrites the color buffer
 * (selection, recolour, etc.).
 * No-op when the sphere is hidden.
 */
export function reapplyHighlight() {
  if (_visible && _d > 0 && isFinite(_d)) {
    _applyHighlight();
  }
}

// ── Internal ──────────────────────────────

// Saturated green for spots inside the sphere
const _INSIDE = new THREE.Color()
  .setHSL(0.40, 0.90, 0.52);

function _applyHighlight() {
  const obj = getPointsObject();
  if (!obj) return;
  const attr = obj.geometry.attributes.color;

  let g = 0;
  for (const ds of store.datasets) {
    const ids  = ds.rawData.data.id;
    const dArr = ds.rawData.data.d_spacing;
    const n    = ds.rawData.points.length;
    const expOffset = ds.expOffset  ?? 0;
    const colorOff  = ds.colorOffset ?? 0;
    for (let i = 0; i < n; i++) {
      // inside sphere = d_spacing > _d (lower res)
      if (dArr[i] > _d) {
        attr.setXYZ(g,
          _INSIDE.r, _INSIDE.g, _INSIDE.b);
      } else {
        const expId  = ids[i];
        const key    = `${ds.id}:${expId}`;
        const colorId =
          colorOff + (expId - expOffset);
        const hex =
          store.expColorOverrides[key]
          ?? expColor(colorId);
        const base = new THREE.Color(hex);
        attr.setXYZ(g, base.r, base.g, base.b);
      }
      g++;
    }
  }
  attr.needsUpdate = true;
}

function _refresh() {
  if (!_sphere) return;
  const show =
    _visible && _d > 0 && isFinite(_d);
  _sphere.visible = show;
  if (show) {
    _sphere.scale.setScalar(SCALE / _d);
    _applyHighlight();
  } else {
    recolour();
  }
  if (_label) {
    _label.style.display =
      show ? 'block' : 'none';
    if (show) {
      _label.textContent =
        `${_d.toFixed(2)} Å`;
    }
  }
}

// The sphere always projects to a perfect
// circle in orthographic view.  We find its
// 2D screen centre by projecting the origin,
// compute the screen radius analytically, then
// place the label at 45° (1:30 clock position)
// just outside the circle edge.  This position
// is stable during rotation — orbiting doesn't
// change the projected circle at all.
function _updateLabelPosition() {
  if (!_label || !_visible
      || !_sphere?.visible
      || !camera || !renderer
      || _rotating) return;

  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;

  // Screen position of sphere centre (origin)
  const ndc = new THREE.Vector3(0, 0, 0)
    .project(camera);
  const cx = (ndc.x *  0.5 + 0.5) * w;
  const cy = (ndc.y * -0.5 + 0.5) * h;

  // Screen-space radius of the projected circle
  const r  = SCALE / _d;
  const sr = r * w
    / (camera.right - camera.left);

  // 45° clockwise from top (≈ 1:30 position),
  // 12px outside the circle edge
  const angle = Math.PI / 4;
  const lx = cx + (sr + 22) * Math.sin(angle);
  const ly = cy - (sr + 22) * Math.cos(angle);

  _label.style.transform =
    `translate(${lx}px,${ly}px)`;
}

