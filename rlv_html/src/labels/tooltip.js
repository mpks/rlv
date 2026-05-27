/**
 * labels/tooltip.js
 *
 * Shows a floating tooltip for the nearest spot
 * within RADIUS_PX of the cursor.
 */

import * as THREE from 'three';
import { store } from '../state/store.js';
import {
  camera, renderer, getPointsObject,
} from '../scene/renderer.js';
import { checkOverlayHover }
  from '../scene/overlays.js';

const RADIUS_PX = 5;

const _ray   = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
const _tmp   = new THREE.Vector3();

let _el          = null;
let _ring        = null;
let _spotHovered = false;
let _enabled     = true;

export function setTooltipEnabled(on) {
  _enabled = on;
  if (!on) {
    if (_ring) _ring.style.display = 'none';
    _hide();
    _spotHovered = false;
  }
}

export function isSpotHovered() { return _spotHovered; }

// ── Init ──────────────────────────────────

export function initTooltip() {
  _el = document.getElementById('tooltip');
  if (!_el) return;

  const wrap =
    document.getElementById('canvas-wrap')
    ?? document.body;

  _ring = document.createElement('div');
  Object.assign(_ring.style, {
    position:      'absolute',
    borderRadius:  '50%',
    border:        '1px solid rgba(255,255,100,0.7)',
    pointerEvents: 'none',
    display:       'none',
    transform:     'translate(-50%,-50%)',
    boxSizing:     'border-box',
    width:  (RADIUS_PX * 2) + 'px',
    height: (RADIUS_PX * 2) + 'px',
  });
  wrap.appendChild(_ring);

  renderer.domElement.addEventListener(
    'mousemove', _onMove);
  renderer.domElement.addEventListener(
    'mouseleave', _onLeave);
}

export function showPickRadius(_on) {}

// ── Mouse handlers ────────────────────────

function _onLeave() {
  if (_ring) _ring.style.display = 'none';
  _spotHovered = false;
  _hide();
}

function _onMove(e) {
  if (!_enabled) return;

  const rect =
    renderer.domElement.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;

  // Move ring to cursor
  if (_ring) {
    _ring.style.left    = cx + 'px';
    _ring.style.top     = cy + 'px';
    _ring.style.display = 'block';
  }

  // ── Spot detection ──────────────────────
  let bestIdx = -1;
  const obj = getPointsObject();

  if (obj) {
    _mouse.x = (cx / rect.width)  *  2 - 1;
    _mouse.y = (cy / rect.height) * -2 + 1;

    if (camera) {
      const worldPerPx =
        (camera.right - camera.left) / rect.width;
      _ray.params.Points.threshold =
        RADIUS_PX * worldPerPx;
    }

    _ray.setFromCamera(_mouse, camera);
    const hits = _ray.intersectObject(obj);
    const pos  = obj.geometry.attributes.position;
    const dpr  = window.devicePixelRatio || 1;
    const spotR =
      ((obj.material?.uniforms?.pointSize?.value
        ?? 5) / 2) / dpr;
    let bestD = Infinity;

    for (const h of hits) {
      if (store.visibleSet
          && !store.visibleSet[h.index]) continue;
      _tmp.fromBufferAttribute(pos, h.index);
      _tmp.project(camera);
      const sx = (_tmp.x *  0.5 + 0.5) * rect.width;
      const sy = (_tmp.y * -0.5 + 0.5) * rect.height;
      const d  = Math.hypot(sx - cx, sy - cy);
      if (d > RADIUS_PX + spotR) continue;
      if (d < bestD) { bestD = d; bestIdx = h.index; }
    }
  }

  if (bestIdx !== -1) {
    const info = _spotInfo(bestIdx);
    if (info) {
      _spotHovered = true;
      _show(info, e.clientX, e.clientY);
      return;
    }
  }

  // ── Overlay detection (fallback) ─────────
  _spotHovered = false;
  const overlay = checkOverlayHover(cx, cy, rect);
  if (overlay) {
    _showOverlay(overlay, e.clientX, e.clientY);
    return;
  }

  _hide();
}

// ── Spot info lookup ──────────────────────

function _spotInfo(globalIdx) {
  let offset = 0;
  for (const ds of store.datasets) {
    const n = ds.rawData.points.length;
    if (globalIdx < offset + n) {
      return _buildInfo(
        ds, globalIdx - offset, globalIdx);
    }
    offset += n;
  }
  return null;
}

function _buildInfo(ds, i, gIdx) {
  const d    = ds.rawData.data;
  const rows = [];

  if (d.indexed_status?.[i] && d.h) {
    rows.push(['hkl',
      `(${d.h[i]} ${d.k[i]} ${d.l[i]})`]);
  }
  if (d.d_spacing?.[i]) {
    rows.push(['d',
      d.d_spacing[i].toFixed(3) + ' Å']);
  }
  if (d.intensity?.[i] != null
      && d.sigma?.[i] > 0) {
    rows.push(['I/σ',
      (d.intensity[i] / d.sigma[i]).toFixed(1)]);
  }
  rows.push(['x y z',
    `${d.x?.[i]?.toFixed(1)}`
    + ` ${d.y?.[i]?.toFixed(1)}`
    + ` ${d.z?.[i]?.toFixed(1)}`]);
  rows.push(['exp', `${ds.id}:${d.id?.[i]}`]);
  rows.push(['idx', gIdx]);

  if (d.panel?.[i] != null)
    rows.push(['panel', d.panel[i]]);
  if (d.intensity?.[i] != null)
    rows.push(['I', d.intensity[i].toFixed(0)]);
  if (d.px_count?.[i] != null)
    rows.push(['px', d.px_count[i]]);

  const hkl =
    d.indexed_status?.[i] && d.h
      ? `(${d.h[i]} ${d.k[i]} ${d.l[i]})`
      : `spot ${gIdx}`;

  return { hkl, rows };
}

// ── Render tooltip ────────────────────────

function _showOverlay(overlay, cx, cy) {
  if (!_el) return;
  document.getElementById('tt-hkl')
    .textContent = overlay.title;
  document.getElementById('tt-table')
    .innerHTML = overlay.rows.map(
      ([k, v]) =>
        `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join('');
  _positionEl(cx, cy);
}

function _positionEl(clientX, clientY) {
  const wrap =
    document.getElementById('canvas-wrap');
  const rect = wrap.getBoundingClientRect();

  // Canvas-relative cursor position
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const W  = rect.width;
  const H  = rect.height;

  // Make visible so we can measure real size
  _el.style.display = 'block';
  const tw = _el.offsetWidth;
  const th = _el.offsetHeight;

  // Minimum clearance from cursor centre:
  // ring radius + small gap so ring stays visible
  const GAP = RADIUS_PX + 10;
  const PAD = 6;

  // 4 candidate positions in canvas coords:
  // right, left, below, above
  const candidates = [
    [mx + GAP,       my - th / 2    ],
    [mx - GAP - tw,  my - th / 2    ],
    [mx - tw / 2,    my + GAP       ],
    [mx - tw / 2,    my - GAP - th  ],
  ];

  function inBounds(x, y) {
    return x >= PAD
        && x + tw <= W - PAD
        && y >= PAD
        && y + th <= H - PAD;
  }

  let [x, y] = candidates[0];
  for (const c of candidates) {
    if (inBounds(c[0], c[1])) {
      [x, y] = c; break;
    }
  }

  // Always clamp so tooltip stays on canvas
  x = Math.max(PAD, Math.min(W - tw - PAD, x));
  y = Math.max(PAD, Math.min(H - th - PAD, y));

  _el.style.left = x + 'px';
  _el.style.top  = y + 'px';
}

function _show(info, cx, cy) {
  if (!_el) return;
  document.getElementById('tt-hkl')
    .textContent = info.hkl;
  document.getElementById('tt-table')
    .innerHTML = info.rows.map(
      ([k, v]) =>
        `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join('');
  _positionEl(cx, cy);
}

function _hide() {
  if (_el) _el.style.display = 'none';
}
