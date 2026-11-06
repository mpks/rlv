/**
 * scene/renderer.js
 *
 * Three.js renderer, orthographic camera,
 * TrackballControls, resize handling,
 * and the main render loop.
 *
 * Exports a singleton `rlvScene` object
 * that the rest of the app uses to add/
 * remove objects from the scene.
 */

import * as THREE from 'three';
import { TrackballControls }
  from 'three/addons/controls/TrackballControls.js';

// ── Module-level Three.js objects ─────────

export let scene    = null;
export let camera   = null;
export let renderer = null;
export let controls = null;

/**
 * Rotation centre ("pivot"): a fixed point in the scene that all rotation
 * turns around (dragging, the gizmo, Spin, Shift+drag roll). Panning and
 * zooming move the view but not the pivot. controls.target is only the
 * middle of the screen. Default: the origin. Change it with setPivot().
 */
export const pivot = new THREE.Vector3();

/** Make `p` (scene coordinates) the rotation centre. The view doesn't move. */
export function setPivot(p) {
  pivot.copy(p);
}

/**
 * If true, the rotation centre is always the middle of the screen and
 * moves when the view is panned (TrackballControls' own behaviour).
 * If false (default), it stays fixed in the scene.
 */
let _pivotFollowsPan = false;

export function setPivotFollowsPan(on) {
  _pivotFollowsPan = on;
  if (on) pivot.copy(controls.target);
}

/**
 * Rotate the whole view by quaternion `q` (a world-space rotation) around
 * the pivot: camera position, view centre and "up" all turn together, so
 * the pivot stays where it is on screen.
 */
export function rotateAroundPivot(q) {
  camera.position.sub(pivot).applyQuaternion(q).add(pivot);
  controls.target.sub(pivot).applyQuaternion(q).add(pivot);
  camera.up.applyQuaternion(q).normalize();
  camera.lookAt(controls.target);
}

let _pointsObject   = null;
let _orthoZoom      = 1.0;
let _running        = false;
const _frameCallbacks = [];
const _frameStartCallbacks = [];

let _spinning       = false;
let _lastSpinTime   = null;
const _SPIN_RADS_PER_SEC = (1.75 / 60) * 2 * Math.PI; // 1.75 RPM

// ── Init ──────────────────────────────────

export function initRenderer() {
  const wrap = _wrap();

  scene = new THREE.Scene();
  scene.background =
    new THREE.Color(0x0d0d14);

  const w = wrap.clientWidth;
  const h = wrap.clientHeight;

  camera = new THREE.OrthographicCamera(
    -w/2, w/2, h/2, -h/2, 0.1, 1e8);
  camera.position.set(0, 0, 10000);

  renderer = new THREE.WebGLRenderer({
    antialias: true });
  renderer.setPixelRatio(
    window.devicePixelRatio);
  renderer.setSize(w, h);
  wrap.appendChild(renderer.domElement);

  controls = new TrackballControls(
    camera, renderer.domElement);
  controls.rotateSpeed  = 3.0;
  controls.panSpeed     = 0.8;   // replaced at each drag start, see below
  controls.staticMoving = true;
  controls.noZoom       = true;

  renderer.domElement.addEventListener(
    'wheel', _onWheel,
    { passive: false });

  // Shift + drag: roll the view (turn it around the screen axis).
  _initRoll();

  // Right-drag panning that "grabs" the view: the spot under the cursor
  // stays under the cursor at any zoom. TrackballControls scales panning
  // by the camera distance times panSpeed, so set panSpeed to cancel that
  // each time a drag starts (capture phase: before its own handler).
  renderer.domElement.addEventListener('pointerdown', () => {
    const dist = camera.position.distanceTo(controls.target);
    if (dist > 0) {
      controls.panSpeed = renderer.domElement.clientWidth / dist;
    }
  }, { capture: true });
  window.addEventListener(
    'resize', onResize);

  // Origin marker — circular dot matching
  // the appearance of data spots.
  const _originGeo =
    new THREE.BufferGeometry();
  _originGeo.setAttribute('position',
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 0]), 3));
  scene.add(new THREE.Points(
    _originGeo,
    new THREE.ShaderMaterial({
      uniforms: {
        pointSize: { value: 8 },
        color:     { value: new THREE.Color(0x50fa7b) },
      },
      vertexShader: `
        uniform float pointSize;
        void main() {
          gl_PointSize = pointSize;
          gl_Position  = projectionMatrix
            * modelViewMatrix
            * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 color;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          if (dot(uv, uv) > 0.25) discard;
          gl_FragColor = vec4(color, 1.0);
        }`,
      transparent: false,
      depthWrite:  true,
    })));
}

// ── Render loop ───────────────────────────

export function startRenderLoop() {
  if (_running) return;
  _running = true;
  _loop();
}

/** fn() runs at the start of every frame, before the controls update. */
export function onFrameStart(fn) {
  _frameStartCallbacks.push(fn);
}

/** Zoom by `factor` (> 1 zooms in), like the scroll wheel. */
export function zoomBy(factor) {
  _orthoZoom = Math.max(0.01,
    Math.min(200, _orthoZoom * factor));
  _syncOrtho();
}

export function addFrameCallback(fn) {
  _frameCallbacks.push(fn);
}

export function setSpin(on) {
  _spinning = on;
  _lastSpinTime = null;
}

function _loop() {
  requestAnimationFrame(_loop);
  // Camera moves (keys, glides) first, so the controls see them.
  for (const fn of _frameStartCallbacks) fn();

  // TrackballControls rotates around the middle of the screen
  // (controls.target). Measure the rotation it applied this frame and
  // move the view so the same rotation happens around the pivot instead.
  if (_pivotFollowsPan) pivot.copy(controls.target);
  const qBefore = camera.quaternion.clone();
  controls.update();
  const dq = camera.quaternion.clone().multiply(qBefore.invert());
  if (1 - Math.abs(dq.w) > 1e-12) {
    const t = controls.target;
    const tWanted = t.clone().sub(pivot).applyQuaternion(dq).add(pivot);
    const shift = tWanted.sub(t);
    t.add(shift);
    camera.position.add(shift);
  }
  if (_spinning) {
    const now = performance.now();
    if (_lastSpinTime !== null) {
      const dt = Math.min(
        (now - _lastSpinTime) / 1000, 0.1);
      const angle = _SPIN_RADS_PER_SEC * dt;
      // Turn around the screen's current vertical, through the pivot.
      // Taken fresh every frame, so rotating the view while spinning
      // changes the spin axis with it.
      const screenUp = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(camera.quaternion);
      rotateAroundPivot(new THREE.Quaternion()
        .setFromAxisAngle(screenUp, angle));
    }
    _lastSpinTime = now;
  }
  _syncOrtho();
  for (const fn of _frameCallbacks) fn();
  renderer.render(scene, camera);
}

// ── Points object ─────────────────────────

/**
 * Replace the current points object.
 * Disposes the old one automatically.
 */
export function setPointsObject(obj) {
  if (_pointsObject) {
    scene.remove(_pointsObject);
    _pointsObject.geometry.dispose();
    _pointsObject.material.dispose();
  }
  _pointsObject = obj;
  if (obj) scene.add(obj);
}

export function getPointsObject() {
  return _pointsObject;
}

// ── Camera fit ────────────────────────────

export function fitCamera() {
  if (!_pointsObject) return;
  const bbox = new THREE.Box3()
    .setFromObject(_pointsObject);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const size = bbox.getSize(
    new THREE.Vector3()).length();
  // Rotate around the origin (the green dot) by default, with the view
  // centred on it.
  pivot.set(0, 0, 0);
  controls.target.set(0, 0, 0);
  camera.position.set(0, 0, size * 2);
  _orthoZoom = 1.0;
  _syncOrtho();
  controls.update();
}

// ── Align camera to vector ────────────────

export function alignToVector(vArray) {
  if (!camera || !controls) return;
  const v = new THREE.Vector3(...vArray)
    .normalize();

  // Keep the same camera-to-target distance
  const dist = camera.position
    .distanceTo(controls.target);

  // Look at the rotation centre (pivot), centred on screen.
  controls.target.copy(pivot);
  camera.position.copy(v).multiplyScalar(dist).add(pivot);

  // Pick an "up" perpendicular to v
  let up = new THREE.Vector3(0, 1, 0);
  if (Math.abs(v.dot(up)) > 0.99)
    up = new THREE.Vector3(0, 0, 1);
  up.sub(
    v.clone().multiplyScalar(v.dot(up))
  ).normalize();
  camera.up.copy(up);

  controls.update();
  _syncOrtho();
}

// ── Resize + zoom ─────────────────────────

// ── Roll: Shift + drag ────────────────────

// Dragging 1 pixel sideways turns the view by 0.5°.
const _ROLL_RADS_PER_PX = Math.PI / 360;
let _rollLastX = null;

function _initRoll() {
  const el = renderer.domElement;
  // Capture phase: runs before TrackballControls' own pointerdown
  // handler, which then ignores this drag (controls.enabled = false).
  el.addEventListener('pointerdown', e => {
    if (!e.shiftKey || e.button !== 0) return;
    _rollLastX = e.clientX;
    controls.enabled = false;
    el.setPointerCapture?.(e.pointerId);
  }, { capture: true });
  el.addEventListener('pointermove', e => {
    if (_rollLastX === null) return;
    rollView((e.clientX - _rollLastX) * _ROLL_RADS_PER_PX);
    _rollLastX = e.clientX;
  });
  const end = e => {
    if (_rollLastX === null) return;
    _rollLastX = null;
    controls.enabled = true;
    el.releasePointerCapture?.(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/**
 * Turn the view by `angle` radians around the viewing direction, like
 * turning a photo on a table. Positive = the picture turns clockwise.
 */
export function rollView(angle) {
  const toViewer = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();
  // Turn around the line of sight through the pivot.
  rotateAroundPivot(new THREE.Quaternion()
    .setFromAxisAngle(toViewer, angle));
}

export function onResize() {
  if (!renderer) return;
  const wrap = _wrap();
  renderer.setSize(
    wrap.clientWidth, wrap.clientHeight);
  _syncOrtho();
  controls?.handleResize();
}

function _onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY > 0
    ? 1.1 : 0.9;
  zoomBy(1 / factor);
}

function _syncOrtho() {
  if (!_pointsObject || !camera) return;
  const wrap = _wrap();
  const aspect =
    wrap.clientWidth / wrap.clientHeight;
  const bbox = new THREE.Box3()
    .setFromObject(_pointsObject);
  const size = bbox.getSize(
    new THREE.Vector3()).length();
  const half = (size * 0.6) / _orthoZoom;
  camera.left   = -half * aspect;
  camera.right  =  half * aspect;
  camera.top    =  half;
  camera.bottom = -half;
  camera.near   =  size * 0.001;
  camera.far    =  size * 10;
  camera.updateProjectionMatrix();
}

// ── Helper ────────────────────────────────

function _wrap() {
  return document.getElementById(
    'canvas-wrap');
}
