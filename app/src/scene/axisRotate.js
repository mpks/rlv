/**
 * scene/axisRotate.js
 *
 * Fixed-axis rotation mode. R switches it on and off (Esc also switches it
 * off). While it is on, a yellow line through the rotation centre shows the
 * axis, and:
 *   - Ctrl + drag (Cmd + drag on a Mac) turns the view around that axis
 *     only. A plain drag still rotates freely, as always.
 *   - Holding W or E turns around the axis at a steady speed, one way or
 *     the other. This works during a normal drag too, so the two motions
 *     add up.
 * Keys 1 / 2 / 3 (or the toolbar buttons) pick the axis; they also switch
 * the mode on. Clicking the picked axis's button switches the mode off.
 *
 * The three axes come from one of four sets ("frames"), switched with the
 * frame button or V:
 *   View        x, y, z of the screen (right, up, towards you)
 *   Lab         the lab x, y, z (the gizmo's axes)
 *   Experiment  the active experiment's beam, rotation axis, and the
 *               direction perpendicular to both (rot × beam)
 *   a*b*c*      the active crystal's reciprocal axes a*, b*, c*
 * A set the active experiment can't provide (no crystal, no goniometer)
 * is skipped.
 *
 * While the mode is on, Spin also turns around the yellow axis.
 *
 * Ctrl + drag: if the axis lies mostly across the screen, move the mouse
 * across the yellow line (like rolling a pencil); if it points mostly
 * towards or away from you, move the mouse around the rotation centre
 * (like turning a dial).
 */

import * as THREE from 'three';
import {
  scene, camera, controls, renderer, addFrameCallback,
  pivot, rotateAroundPivot, setSpinAxisProvider,
} from './renderer.js';
import { store, onChange } from '../state/store.js';
import { getGizmoFrame, keysBlocked } from './navigation.js';

const FRAMES = [
  { id: 'view',  button: 'View',       labels: ['x', 'y', 'z'],
    names: ['screen x', 'screen y', 'screen z'] },
  { id: 'lab',   button: 'Lab',        labels: ['x', 'y', 'z'],
    names: ['lab x', 'lab y', 'lab z'] },
  { id: 'exp',   button: 'Experiment', labels: ['beam', 'rot', '⊥'],
    names: ['beam', 'rotation axis',
      'direction perpendicular to the beam and the rotation axis'] },
  { id: 'recip', button: 'a*b*c*',     labels: ['a*', 'b*', 'c*'],
    names: ['crystal a*', 'crystal b*', 'crystal c*'] },
];

const RADS_PER_PX = Math.PI / 360;   // 0.5° per pixel, as Shift+drag roll
const KEY_RADS_PER_S = Math.PI / 4;  // W / E held: 45° per second
const LINE_COLOR = 0xffd33d;

let _frame = 0;       // index into FRAMES
let _on = false;      // fixed-axis mode on?
let _axis = 0;        // 0, 1, 2: the axis used while the mode is on
let _line = null;     // THREE.Line through the pivot
let _ring = null;     // small yellow ring on the pivot (screen overlay)

// ── Public ────────────────────────────────

export function initAxisRotate() {
  _initLine();
  _initDrag();
  _initButtons();
  onChange('active-exp-changed', _syncButtons);
  onChange('overlays-changed', _syncButtons);   // crystal frame on/off
  _initKeys();
  addFrameCallback(_turnByKeys);
  addFrameCallback(_updateLine);
  // Spin turns around the yellow axis while the mode is on
  setSpinAxisProvider(() => (_on ? _axisDir(_axis) : null));
}

/** R: switch fixed-axis mode on or off. */
export function toggleAxisMode() {
  _on = !_on && !!_axisDir(_axis);
  _syncButtons();
}

/** 1 / 2 / 3: rotate around axis i (0, 1, 2) of the current set; switches
 *  the mode on if it is off. */
export function selectAxis(i) {
  if (!_axisDir(i)) return;
  _axis = i;
  _on = true;
  _syncButtons();
}

/** Switch fixed-axis mode off. Returns true if it was on. */
export function clearAxis() {
  if (!_on) return false;
  _on = false;
  _syncButtons();
  return true;
}

/** Next set of axes (View → Lab → Experiment → a*b*c*), skipping sets the
 *  active experiment can't provide. The axis number (1, 2, 3) stays. */
export function cycleFrame() {
  for (let k = 1; k <= FRAMES.length; k++) {
    const f = (_frame + k) % FRAMES.length;
    if (_frameAvailable(f)) { _frame = f; break; }
  }
  _syncButtons();
}

// ── Axis directions (scene coordinates) ───

function _activeExpt() {
  const a = store.activeExp;
  if (!a) return null;
  const ds = store.datasets.find(d => d.id === a.datasetId);
  return ds?.rawData.experiments?.[a.expId - (ds.expOffset ?? 0)] ?? null;
}

/** Reciprocal axes a*, b*, c* of the active crystal, as they lie in the
 *  scene (already turned when the crystal frame is on), or null. */
function _recipAxes() {
  const rv = _activeExpt()?.recip_latt_vectors;
  if (!rv || rv.length < 3) return null;
  return rv.map(v => new THREE.Vector3(...v));
}

/** Beam (along the beam), rotation axis and rot × beam of the active
 *  experiment, as they lie in the scene, or null. */
function _expAxes() {
  const e = _activeExpt();
  if (!e?.beam_vector || !e?.rotation_axis) return null;
  const beam = new THREE.Vector3(...e.beam_vector);
  const rot = new THREE.Vector3(...e.rotation_axis);
  const perp = new THREE.Vector3().crossVectors(rot, beam);
  if (perp.lengthSq() === 0) return null;
  return [beam, rot, perp];
}

function _frameAvailable(f) {
  const id = FRAMES[f].id;
  if (id === 'exp') return !!_expAxes();
  if (id === 'recip') return !!_recipAxes();
  return true;
}

/** Unit direction of axis i in the current frame, or null. */
function _axisDir(i, frame = _frame) {
  if (i === null || i === undefined) return null;
  const id = FRAMES[frame].id;
  let d = null;
  if (id === 'view') {
    d = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1)][i].applyQuaternion(camera.quaternion);
  } else if (id === 'lab') {
    d = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1)][i];
    const m = getGizmoFrame();   // lab → scene (crystal frame), or null
    if (m) d.applyMatrix3(m);
  } else if (id === 'exp') {
    const e = _expAxes();
    if (!e) return null;
    d = e[i].clone();
  } else {
    const r = _recipAxes();
    if (!r) return null;
    d = r[i].clone();
  }
  return d.lengthSq() > 0 ? d.normalize() : null;
}

// ── Yellow line ───────────────────────────

function _initLine() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',
    new THREE.BufferAttribute(new Float32Array(6), 3));
  _line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: LINE_COLOR, depthTest: false, transparent: true, opacity: 0.9,
  }));
  _line.frustumCulled = false;
  _line.renderOrder = 999;
  _line.visible = false;
  scene.add(_line);

  const wrap = document.getElementById('canvas-wrap');
  if (wrap) {
    _ring = document.createElement('div');
    _ring.id = 'axis-rot-centre';
    wrap.appendChild(_ring);
  }
}

function _updateLine() {
  const d = _on ? _axisDir(_axis) : null;
  if (!d) {
    _line.visible = false;
    if (_ring) _ring.style.display = 'none';
    return;
  }
  // Long enough to cross the whole view
  const L = 2 * Math.hypot(camera.right - camera.left, camera.top - camera.bottom)
    / (camera.zoom || 1);
  const p = _line.geometry.attributes.position;
  p.setXYZ(0, pivot.x - d.x * L, pivot.y - d.y * L, pivot.z - d.z * L);
  p.setXYZ(1, pivot.x + d.x * L, pivot.y + d.y * L, pivot.z + d.z * L);
  p.needsUpdate = true;
  _line.visible = true;

  if (_ring) {
    camera.updateMatrixWorld();
    const v = pivot.clone().project(camera);
    const r = renderer.domElement;
    _ring.style.left = `${(v.x + 1) / 2 * r.clientWidth}px`;
    _ring.style.top = `${(1 - v.y) / 2 * r.clientHeight}px`;
    _ring.style.display = 'block';
  }
}

// ── Dragging ──────────────────────────────

function _initDrag() {
  const el = renderer.domElement;
  let drag = null;

  // Capture phase: runs before TrackballControls' own pointerdown handler,
  // which then ignores this drag (controls.enabled = false), as for roll.
  el.addEventListener('pointerdown', e => {
    // Only Ctrl / Cmd + drag; a plain drag is left to TrackballControls.
    if (!_on || e.button !== 0 || e.shiftKey) return;
    if (!e.ctrlKey && !e.metaKey) return;
    const dir = _axisDir(_axis);
    if (!dir) return;
    // The axis in camera space: x right, y up, z towards the viewer
    const a = dir.clone().applyQuaternion(camera.quaternion.clone().invert());
    const across = Math.hypot(a.x, a.y);
    drag = { dir, x: e.clientX, y: e.clientY };
    if (across > 0.5) {
      // Mostly across the screen: moving the mouse across the line turns.
      drag.mode = 'across';
      drag.ux = a.x / across;
      drag.uy = a.y / across;
    } else {
      // Mostly towards / away from the viewer: turn like a dial.
      const r = el.getBoundingClientRect();
      camera.updateMatrixWorld();
      const v = pivot.clone().project(camera);
      drag.mode = 'dial';
      drag.sign = a.z >= 0 ? 1 : -1;
      drag.cx = r.left + (v.x + 1) / 2 * r.width;
      drag.cy = r.top + (1 - v.y) / 2 * r.height;
      drag.ang = Math.atan2(-(e.clientY - drag.cy), e.clientX - drag.cx);
    }
    controls.enabled = false;
    el.setPointerCapture?.(e.pointerId);
  }, { capture: true });

  el.addEventListener('pointermove', e => {
    if (!drag) return;
    let angle = 0;
    if (drag.mode === 'across') {
      // A point in front of the centre moves along (uy, -ux) when the
      // scene turns positively around the axis; follow the mouse.
      const dx = e.clientX - drag.x;
      const dyUp = -(e.clientY - drag.y);
      angle = (dx * drag.uy - dyUp * drag.ux) * RADS_PER_PX;
    } else {
      const dx = e.clientX - drag.cx, dy = e.clientY - drag.cy;
      if (Math.hypot(dx, dy) < 6) return;   // too close to the centre
      const ang = Math.atan2(-dy, dx);
      let d = ang - drag.ang;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      drag.ang = ang;
      angle = d * drag.sign;
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
    // The camera turns the opposite way to the scene
    if (angle) {
      rotateAroundPivot(new THREE.Quaternion()
        .setFromAxisAngle(drag.dir, -angle));
    }
  });

  const end = e => {
    if (!drag) return;
    drag = null;
    controls.enabled = true;
    el.releasePointerCapture?.(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// ── W / E: turn around the axis while held ─

const _held = new Set();
let _lastTurn = null;

function _initKeys() {
  window.addEventListener('keydown', e => {
    if (!_on || e.ctrlKey || e.metaKey || e.altKey || keysBlocked(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'e') {
      _held.add(k);
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => _held.delete(e.key.toLowerCase()));
  // Releasing a key while the window is in the background is never seen.
  window.addEventListener('blur', () => _held.clear());
}

function _turnByKeys() {
  const now = performance.now();
  const dt = _lastTurn === null ? 0 : Math.min((now - _lastTurn) / 1000, 0.1);
  _lastTurn = now;
  if (!_on || !_held.size || !dt) return;
  const dir = _axisDir(_axis);
  if (!dir) return;
  // E turns the data anticlockwise seen from the tip of the axis, W the
  // other way. The camera turns the opposite way to the data.
  const sign = (_held.has('e') ? 1 : 0) - (_held.has('w') ? 1 : 0);
  if (!sign) return;
  rotateAroundPivot(new THREE.Quaternion()
    .setFromAxisAngle(dir, -sign * KEY_RADS_PER_S * dt));
}

// ── Toolbar buttons ───────────────────────

function _initButtons() {
  document.getElementById('btn-axis-frame')
    ?.addEventListener('click', cycleFrame);
  // Clicking the axis in use switches the mode off; another axis picks it.
  for (let i = 0; i < 3; i++) {
    document.getElementById(`btn-axis-${i}`)
      ?.addEventListener('click', () => {
        if (_on && _axis === i) clearAxis();
        else selectAxis(i);
      });
  }
  _syncButtons();
}

function _syncButtons() {
  // The active experiment may have changed to one without this set
  if (!_frameAvailable(_frame)) _frame = 0;

  const f = FRAMES[_frame];
  const fb = document.getElementById('btn-axis-frame');
  if (fb) fb.textContent = f.button;
  for (let i = 0; i < 3; i++) {
    const b = document.getElementById(`btn-axis-${i}`);
    if (!b) continue;
    b.textContent = f.labels[i];
    const inUse = _on && _axis === i;
    b.classList.toggle('active', inUse);
    b.title = inUse
      ? `Fixed axis: ${f.names[i]}. Ctrl+drag or hold W / E to turn `
        + 'around it. Click, or press R or Esc, to switch off.'
      : `Fixed axis: ${f.names[i]} (${i + 1})`;
  }
}
