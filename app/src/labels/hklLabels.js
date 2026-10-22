/**
 * labels/hklLabels.js
 *
 * Per-spot text annotations:
 *   Miller index  — above spot   (white)
 *   Resolution    — below spot   (blue)
 *   Intensity     — right of spot (red)
 *
 * Each sprite stores gapX / gapY ratios
 * (multiples of lineH) applied along the
 * camera's screen-right / screen-up axes
 * each frame, so the layout is always in
 * the plane of the screen regardless of
 * camera orientation.
 */

import * as THREE from 'three';
import {
  scene, camera, renderer,
  addFrameCallback, getPointsObject,
} from '../scene/renderer.js';
import { store } from '../state/store.js';

let _showHKL  = false;
let _showRes  = false;
let _showInt  = false;
let _fontSize = 13;

// { sprite, globalIdx, baseX, baseY, baseZ,
//   gapX, gapY, canW }
// gapX/gapY: offset in screen-right/up,
//            expressed as multiples of lineH
let _sprites = [];

const MAX_LABELS = 2000;
const _LINE = 28;   // canvas line height px
const _CANw = 192;  // canvas width

// Vertical gap: sprite centre offset (× lineH)
const _VGAP = 0.6;

const _screenUp    = new THREE.Vector3();
const _screenRight = new THREE.Vector3();

// ── Public API ────────────────────────────

export function initHKLLabels() {
  addFrameCallback(_frameUpdate);
}

export function rebuildHKLLabels() {
  _clear();
  if (_anyOn()) _build();
}

export function setHKLLabelsEnabled(on) {
  _showHKL = on; _clear(); if (_anyOn()) _build();
}
export function setResLabelsEnabled(on) {
  _showRes = on; _clear(); if (_anyOn()) _build();
}
export function setIntLabelsEnabled(on) {
  _showInt = on; _clear(); if (_anyOn()) _build();
}

export function setHKLLabelSize(px) {
  _fontSize = Math.round(px);
}

// ── Internal ──────────────────────────────

function _anyOn() {
  return _showHKL || _showRes || _showInt;
}

function _clear() {
  for (const { sprite } of _sprites) {
    scene.remove(sprite);
    sprite.material.map?.dispose();
    sprite.material.dispose();
  }
  _sprites = [];
}

function _push(sprite, globalIdx, bx, by, bz,
               gapX, gapY, canW) {
  scene.add(sprite);
  _sprites.push({
    sprite, globalIdx,
    baseX: bx, baseY: by, baseZ: bz,
    gapX, gapY, canW,
  });
}

function _build() {
  const pts = getPointsObject();
  if (!pts) return;
  const pos = pts.geometry.attributes.position;

  // When both sub-spot annotations are on, use
  // two distinct slots; when only one is on,
  // it collapses to the middle slot.
  const _resGapY = -_VGAP / 2;
  const _intGapY = (_showRes && _showInt)
    ? -_VGAP * 2 : -_VGAP / 2;

  let globalIdx = 0;
  let hklN = 0, resN = 0, intN = 0;

  for (const ds of store.datasets) {
    const d  = ds.rawData.data;
    const np = ds.rawData.points.length;
    for (let i = 0; i < np; i++, globalIdx++) {
      const indexed = !!d.indexed_status[i];
      const bx = pos.getX(globalIdx);
      const by = pos.getY(globalIdx);
      const bz = pos.getZ(globalIdx);

      if (_showHKL && indexed
          && hklN < MAX_LABELS) {
        _push(_makeSprite(
            `${d.h[i]} ${d.k[i]} ${d.l[i]}`,
            '#ffffff', _CANw),
          globalIdx, bx, by, bz,
          0, +_VGAP, _CANw);
        hklN++;
      }

      if (_showRes && resN < MAX_LABELS) {
        const dsp = d.d_spacing?.[i] ?? 0;
        _push(_makeSprite(
            `${dsp > 0 ? dsp.toFixed(2) : '—'} Å`,
            '#4da6ff', _CANw),
          globalIdx, bx, by, bz,
          0, _resGapY, _CANw);
        resN++;
      }

      if (_showInt && intN < MAX_LABELS) {
        const v = d.intensity?.[i];
        if (v != null) {
          _push(_makeSprite(
              _fmtI(v), '#ff4444', _CANw),
            globalIdx, bx, by, bz,
            0, _intGapY, _CANw);
          intN++;
        }
      }
    }
  }
}

function _frameUpdate() {
  if (!_anyOn() || !camera || !renderer
      || _sprites.length === 0) return;

  const lineH = _fontSize
    * (camera.right - camera.left)
    / renderer.domElement.clientWidth;

  _screenUp.setFromMatrixColumn(
    camera.matrixWorld, 1);
  _screenRight.setFromMatrixColumn(
    camera.matrixWorld, 0);

  const vis = store.visibleSet;
  for (const { sprite, globalIdx,
               baseX, baseY, baseZ,
               gapX, gapY, canW }
       of _sprites) {
    const show = vis ? !!vis[globalIdx] : false;
    sprite.visible = show;
    if (show) {
      const ox = (_screenRight.x * gapX
                + _screenUp.x    * gapY) * lineH;
      const oy = (_screenRight.y * gapX
                + _screenUp.y    * gapY) * lineH;
      const oz = (_screenRight.z * gapX
                + _screenUp.z    * gapY) * lineH;
      sprite.scale.set(
        lineH * canW / _LINE, lineH, 1);
      sprite.position.set(
        baseX + ox, baseY + oy, baseZ + oz);
    }
  }
}

function _makeSprite(text, color, canW) {
  const cv  = document.createElement('canvas');
  cv.width  = canW;
  cv.height = _LINE;
  const ctx = cv.getContext('2d');
  ctx.font         = 'bold 20px monospace';
  ctx.textBaseline = 'middle';
  ctx.shadowColor  = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur   = 3;
  ctx.fillStyle    = color;
  ctx.fillText(text, 4, _LINE / 2);

  const mat = new THREE.SpriteMaterial({
    map:             new THREE.CanvasTexture(cv),
    transparent:     true,
    depthTest:       false,
    sizeAttenuation: true,
    opacity:         0.95,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.visible = false;
  return sprite;
}

function _fmtI(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return v.toExponential(1);
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return Math.round(v).toString();
}
