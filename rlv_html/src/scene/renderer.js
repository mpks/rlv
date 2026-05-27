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

let _pointsObject   = null;
let _orthoZoom      = 1.0;
let _running        = false;
const _frameCallbacks = [];

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
  controls.panSpeed     = 0.8;
  controls.staticMoving = true;
  controls.noZoom       = true;

  renderer.domElement.addEventListener(
    'wheel', _onWheel,
    { passive: false });
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

export function addFrameCallback(fn) {
  _frameCallbacks.push(fn);
}

function _loop() {
  requestAnimationFrame(_loop);
  controls.update();
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
  controls.target.copy(center);
  camera.position.copy(center)
    .add(new THREE.Vector3(
      0, 0, size * 2));
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

  controls.target.set(0, 0, 0);
  camera.position.copy(v).multiplyScalar(dist);

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
  _orthoZoom = Math.max(0.01,
    Math.min(200,
      _orthoZoom / factor));
  _syncOrtho();
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
