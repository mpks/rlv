/**
 * scene/navigation.js
 *
 * Extra ways to move around the 3D view, in the spirit of Blender:
 *
 *  - Axis gizmo (top-left of the view): lab x, y, z drawn as they point on
 *    screen. Drag it to rotate the view; click an axis ball to look along
 *    that axis.
 *  - Rotation centre (pivot, see renderer.js): a fixed point in the scene
 *    that rotation turns around; panning and zooming don't move it. A red
 *    cross marks it ("Rotation centre" toggle in Overlays only hides the
 *    cross). Double-click a spot to rotate around it: the view glides so
 *    the spot is in the middle. Click the green origin dot, or the
 *    "origin" button, to rotate around (0, 0, 0) again (the default).
 *  - Keys: arrows move left / right / up / down, Shift + up / down zoom
 *    in / out, at a constant speed (no acceleration).
 *
 * Scene coordinates are DIALS lab coordinates (times a fixed scale), so
 * the gizmo's x, y, z are the lab axes.
 */

import * as THREE from 'three';
import {
  camera, controls, renderer,
  getPointsObject, addFrameCallback, zoomBy, onFrameStart,
  pivot, setPivot, rotateAroundPivot,
} from './renderer.js';
import { store, onChange } from '../state/store.js';
import { expColorOf } from '../filters/colors.js';

// ── Settings ──────────────────────────────

const AXES = [
  { label: 'x', dir: new THREE.Vector3(1, 0, 0), color: '#e5534b' },
  { label: 'y', dir: new THREE.Vector3(0, 1, 0), color: '#57ab5a' },
  { label: 'z', dir: new THREE.Vector3(0, 0, 1), color: '#539bf5' },
];
const GIZMO_SIZE = 96;        // CSS pixels
const GIZMO_ARM = 34;         // length of an axis on screen
const BALL_R = 8;             // positive-axis ball radius
const BALL_R_NEG = 5;         // negative-axis ball radius

const GIZMO_DRAG_RADS_PER_PX = Math.PI / 180;  // 1° per pixel
const ORIGIN_CLICK_PX = 10;   // how close a click must be to the green dot

const CENTRE_ANIM_MS = 250;   // glide to a new rotation centre
const MOVE_VIEWS_PER_S = 0.5; // arrows: half a view width per second
const ZOOM_PER_S = 2.0;       // Shift + up / down: zoom x2 per second

// ── Init ──────────────────────────────────

export function initNavigation() {
  _initGizmo();
  _initFrameBadge();
  _initCentreMarker();
  _initDoubleClick();
  _initOriginClick();
  _initKeys();

  document.getElementById('btn-centre-origin')
    ?.addEventListener('click', () => centreOn(new THREE.Vector3()));
}

// ── Set the rotation centre and glide to it ─

let _anim = null;   // { from, to, start }

/**
 * Make `point` (scene coordinates) the rotation centre, and glide the view
 * sideways (no rotation, no zoom) until it is in the middle of the screen.
 */
export function centreOn(point) {
  setPivot(point);
  _anim = {
    from: controls.target.clone(),
    to: point.clone(),
    start: performance.now(),
  };
}

function _stepGlide() {
  if (!_anim) return;
  const t = Math.min(1, (performance.now() - _anim.start) / CENTRE_ANIM_MS);
  const ease = t * (2 - t);   // ease-out
  const shift = _anim.from.clone().lerp(_anim.to, ease).sub(controls.target);
  controls.target.add(shift);
  camera.position.add(shift);
  if (t >= 1) _anim = null;
}

// ── Rotation centre marker ────────────────

let _marker = null;

function _initCentreMarker() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;
  _marker = document.createElement('div');
  _marker.id = 'rotation-centre';
  wrap.appendChild(_marker);
  addFrameCallback(_placeMarker);
}

/** Put the red cross on the pivot's position on screen (hidden if off). */
function _placeMarker() {
  if (!_marker) return;
  if (!store.overlays.rotCentre) { _marker.style.display = 'none'; return; }
  // The camera's matrices are only refreshed when the frame is drawn,
  // which is after this; refresh them now, or the cross lags a frame
  // behind while the view moves.
  camera.updateMatrixWorld();
  const v = pivot.clone().project(camera);
  const r = renderer.domElement;
  const x = (v.x + 1) / 2 * r.clientWidth;
  const y = (1 - v.y) / 2 * r.clientHeight;
  const inside = x >= 0 && x <= r.clientWidth && y >= 0 && y <= r.clientHeight;
  _marker.style.display = inside ? 'block' : 'none';
  _marker.style.left = `${x}px`;
  _marker.style.top = `${y}px`;
}

// ── Double-click: rotate around a spot ────

const _raycaster = new THREE.Raycaster();
_raycaster.params.Points.threshold = 15;   // same as click-to-select

function _initDoubleClick() {
  const el = renderer.domElement;
  el.addEventListener('dblclick', e => {
    const obj = getPointsObject();
    if (!obj) return;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1);
    _raycaster.setFromCamera(ndc, camera);
    // Only spots that are shown (hidden ones have alpha 0)
    const alpha = obj.geometry.attributes.alpha?.array;
    const hit = _raycaster.intersectObject(obj)
      .find(h => !alpha || alpha[h.index] > 0);
    if (!hit) return;
    const pos = obj.geometry.attributes.position;
    const p = new THREE.Vector3(
      pos.getX(hit.index), pos.getY(hit.index), pos.getZ(hit.index))
      .applyMatrix4(obj.matrixWorld);
    centreOn(p);
  });
}

// ── Click on the green origin dot ─────────

function _initOriginClick() {
  const el = renderer.domElement;
  let downX = 0, downY = 0;
  el.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; });
  el.addEventListener('click', e => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return; // a drag
    const r = el.getBoundingClientRect();
    const v = new THREE.Vector3(0, 0, 0).project(camera);
    const ox = r.left + (v.x + 1) / 2 * r.width;
    const oy = r.top + (1 - v.y) / 2 * r.height;
    if (Math.hypot(e.clientX - ox, e.clientY - oy) <= ORIGIN_CLICK_PX) {
      centreOn(new THREE.Vector3());
    }
  });
}

// ── Keys: arrows ──────────────────────────

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const _held = new Set();
let _shift = false;
let _lastFrame = null;

/**
 * True if a key press should be left alone by the view's shortcuts: the
 * user is typing in a text box, number box, list or slider (radio buttons,
 * checkboxes and buttons don't count), or a dialog / colour picker is open.
 */
export function keysBlocked(e) {
  const t = e.target;
  if (t?.isContentEditable) return true;
  if (t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT') return true;
  if (t?.tagName === 'INPUT'
      && !['radio', 'checkbox', 'button', 'submit', 'reset']
        .includes(t.type)) return true;
  const shown = id => {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el).display !== 'none';
  };
  return shown('dlg-open') || shown('dlg-remote')
    || !!document.querySelector('.cp-popup');
}

function _initKeys() {
  // TrackballControls has its own A/S/D modifier keys; switch them off so
  // they don't clash with the shortcuts.
  controls.keys = [];

  window.addEventListener('keydown', e => {
    _shift = e.shiftKey;
    if (e.ctrlKey || e.metaKey || e.altKey || keysBlocked(e)) return;
    if (ARROWS.includes(e.key)) {
      _held.add(e.key);
      e.preventDefault();   // don't scroll the page or change a radio button
    }
  });
  window.addEventListener('keyup', e => {
    _shift = e.shiftKey;
    _held.delete(e.key);
  });
  // Releasing a key while the window is in the background is never seen.
  window.addEventListener('blur', () => { _held.clear(); _shift = false; });

  onFrameStart(_stepKeys);
  onFrameStart(_stepGlide);
}

function _stepKeys() {
  const now = performance.now();
  const dt = _lastFrame === null ? 0 : Math.min((now - _lastFrame) / 1000, 0.1);
  _lastFrame = now;
  if (_held.size === 0 || dt === 0) return;

  const upKey = (_held.has('ArrowUp') ? 1 : 0) - (_held.has('ArrowDown') ? 1 : 0);

  // Shift + up / down: zoom
  if (_shift && upKey) zoomBy(Math.pow(ZOOM_PER_S, upKey * dt));

  // Move sideways / up-down, a fixed fraction of the view per second
  const right = (_held.has('ArrowRight') ? 1 : 0) - (_held.has('ArrowLeft') ? 1 : 0);
  const up = _shift ? 0 : upKey;
  if (right || up) {
    const viewWidth = (camera.right - camera.left) / camera.zoom;
    const step = viewWidth * MOVE_VIEWS_PER_S * dt;
    const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const upDir = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const delta = rightDir.multiplyScalar(right * step)
      .add(upDir.multiplyScalar(up * step));
    controls.target.add(delta);
    camera.position.add(delta);
  }
}

// ── "Crystal frame" badge ─────────────────

/**
 * Badge under the gizmo while "Show in crystal frame" is on, in the colour
 * of the active experiment (whose lattice stays still on screen), so it is
 * clear which frame is shown. The gizmo keeps showing the lab axes.
 * Clicking it switches back to the lab frame.
 */
function _initFrameBadge() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.id = 'frame-badge';
  el.innerHTML = '<span class="fb-dot"></span><span>Crystal frame</span>';
  el.addEventListener('click', () =>
    document.getElementById('tog-crystal-frame')?.click());
  wrap.appendChild(el);
  const update = () => {
    el.style.display = store.overlays.crystalFrame ? 'flex' : 'none';
    const a = store.activeExp;
    const ds = a && store.datasets.find(d => d.id === a.datasetId);
    const color = ds ? expColorOf(ds, a.expId) : '#f5a623';
    el.style.setProperty('--fb-color', color);
    const label = ds ? `exp ${ds.id}:${a.expId - (ds.expOffset ?? 0)}` : 'the active experiment';
    el.title = `Crystal frame of ${label}, which stays still on screen. `
      + 'The gizmo still shows the lab x, y, z. Click to go back to the lab frame.';
  };
  update();
  onChange('overlays-changed', update);
  onChange('active-exp-changed', update);
  onChange('colors-changed', update);
}

// ── Axis gizmo ────────────────────────────

let _gizmo = null;     // canvas
// Where the lab axes point in the scene: null in the lab frame; in the
// crystal frame, the active crystal's U (the matrix its spots were turned
// by), so the gizmo agrees with the beam / rotation-axis arrows.
let _labToScene = null;

/** Lab-to-scene rotation (null = lab frame). */
export function getGizmoFrame() {
  return _labToScene;
}

/** Set the lab-to-scene rotation for the gizmo (null = lab frame). */
export function setGizmoFrame(m) {
  _labToScene = m ? m.clone() : null;
  if (_gizmo) {
    _gizmo.title = _labToScene
      ? 'Lab axes, as they lie in the active crystal\'s frame. Drag to rotate the view; click an axis to look along it.'
      : 'Lab axes. Drag to rotate the view; click an axis to look along it.';
  }
}
let _balls = [];       // [{ x, y, r, dir }] in CSS pixels, for clicks
let _hover = null;

function _initGizmo() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;
  _gizmo = document.createElement('canvas');
  _gizmo.id = 'axis-gizmo';
  _gizmo.title = 'Lab axes. Click an axis to look along it.';
  wrap.appendChild(_gizmo);

  // Drag the gizmo to rotate the view; a click (no drag) on a ball looks
  // along that axis.
  let drag = null;   // { x, y, moved }
  _gizmo.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    _gizmo.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  _gizmo.addEventListener('pointermove', e => {
    if (!drag) {
      const b = _ballAt(e);
      _hover = b;
      _gizmo.style.cursor = b ? 'pointer' : 'grab';
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    _hover = null;
    _gizmo.style.cursor = 'grabbing';
    orbit(dx * GIZMO_DRAG_RADS_PER_PX, dy * GIZMO_DRAG_RADS_PER_PX);
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  _gizmo.addEventListener('pointerup', e => {
    if (drag && !drag.moved) {
      const b = _ballAt(e);
      if (b) lookAlong(b.dir);
    }
    drag = null;
    _gizmo.releasePointerCapture?.(e.pointerId);
    _gizmo.style.cursor = _ballAt(e) ? 'pointer' : 'grab';
  });
  _gizmo.addEventListener('pointercancel', () => { drag = null; });
  _gizmo.addEventListener('mouseleave', () => { if (!drag) _hover = null; });

  addFrameCallback(_drawGizmo);

  // "Axis gizmo" toggle in Overlays
  const show = () => {
    _gizmo.style.display = store.overlays.axisGizmo === false ? 'none' : 'block';
  };
  show();
  onChange('overlays-changed', show);
}

function _ballAt(e) {
  const r = _gizmo.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  // Front-most first (last drawn)
  for (let i = _balls.length - 1; i >= 0; i--) {
    const b = _balls[i];
    if (Math.hypot(x - b.x, y - b.y) <= b.r + 2) return b;
  }
  return null;
}

/**
 * Rotate the view around the rotation centre (pivot), as if grabbing the scene:
 * `right` radians around the screen's vertical axis (drag right turns the
 * scene to the right), `down` radians around the screen's horizontal axis.
 */
export function orbit(right, down) {
  const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  // The camera turns the opposite way to the scene
  rotateAroundPivot(new THREE.Quaternion()
    .setFromAxisAngle(screenUp, -right)
    .multiply(new THREE.Quaternion().setFromAxisAngle(screenRight, -down)));
}

/**
 * Look along `dir` (scene coordinates) from the positive side, at the
 * rotation centre (which ends up in the middle of the screen), like
 * clicking an axis in Blender's gizmo. Zoom stays the same.
 */
export function lookAlong(dir) {
  const d = dir.clone().normalize();
  const dist = camera.position.distanceTo(controls.target);
  // Look at the rotation centre, centred on screen
  controls.target.copy(pivot);
  camera.position.copy(pivot).addScaledVector(d, dist);
  // Keep lab y up where possible; looking along y, use -z as up.
  const up = Math.abs(d.y) > 0.99
    ? new THREE.Vector3(0, 0, -Math.sign(d.y))
    : new THREE.Vector3(0, 1, 0);
  camera.up.copy(up);
  camera.lookAt(controls.target);
  controls.update();
}

function _drawGizmo() {
  if (!_gizmo || _gizmo.style.display === 'none') return;
  const dpr = window.devicePixelRatio || 1;
  const size = GIZMO_SIZE;
  if (_gizmo.width !== size * dpr) {
    _gizmo.width = _gizmo.height = size * dpr;
    _gizmo.style.width = _gizmo.style.height = `${size}px`;
  }
  const ctx = _gizmo.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;

  // Each axis in camera space: x right, y up, z towards the viewer
  const inv = camera.quaternion.clone().invert();
  const ends = [];
  for (const a of AXES) {
    // The lab axis as it lies in the scene
    const sceneDir = _labToScene
      ? a.dir.clone().applyMatrix3(_labToScene).normalize()
      : a.dir.clone();
    for (const sign of [1, -1]) {
      const dir = sceneDir.clone().multiplyScalar(sign);
      const v = dir.clone().applyQuaternion(inv);
      ends.push({
        a, sign, depth: v.z,
        x: c + v.x * GIZMO_ARM,
        y: c - v.y * GIZMO_ARM,
        r: sign > 0 ? BALL_R : BALL_R_NEG,
        dir,
      });
    }
  }
  ends.sort((p, q) => p.depth - q.depth);   // back to front

  _balls = [];
  for (const e of ends) {
    const hot = _hover && _hover.dir.equals(e.dir);
    if (e.sign > 0) {
      ctx.strokeStyle = e.a.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r + (hot ? 1.5 : 0), 0, Math.PI * 2);
    if (e.sign > 0) {
      ctx.fillStyle = e.a.color;
      ctx.fill();
      ctx.fillStyle = '#0d0d14';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.a.label, e.x, e.y + 0.5);
    } else {
      ctx.fillStyle = 'rgba(13,13,20,0.8)';
      ctx.fill();
      ctx.strokeStyle = e.a.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (hot) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    _balls.push(e);
  }
}
