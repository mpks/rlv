/**
 * scene/overlays.js
 *
 * 3D overlays:
 *   - Rotation axis  (solid + dashed, "rot" label)
 *   - Reciprocal cell vectors a*, b*, c*
 *     (arrows from origin, matching sidebar colors)
 *
 * Hover over any overlay object to see a tooltip
 * with the vector values.
 */

import * as THREE from 'three';
import {
  scene, camera, renderer, addFrameCallback,
} from './renderer.js';
import { store, onChange }
  from '../state/store.js';
import { SCALE } from '../io/rlv_io.js';
import { expColor } from '../filters/colors.js';

// How much to scale recip-cell vector lengths
// beyond their natural reciprocal-space size.
const _CELL_SCALE  = 3;
const _AXIS_LENGTH = SCALE * 2.5;
const _LABEL_PX    = 19;

// ── Shared sprite helper ──────────────────

function _makeSprite(text, color = '#ffffff') {
  const fs = 28;
  const cv = document.createElement('canvas');
  cv.width = 96; cv.height = 48;
  const ctx = cv.getContext('2d');
  ctx.font      = `bold ${fs}px monospace`;
  ctx.fillStyle = color;
  ctx.fillText(text, 6, fs + 4);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv),
    transparent: true, depthTest: false,
    sizeAttenuation: true, opacity: 0.90,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(1, 0.5, 1);
  s.visible = false;
  scene.add(s);
  return s;
}

function _fixSpriteScales(sprites) {
  if (!camera || !renderer) return;
  const h = _LABEL_PX
    * (camera.right - camera.left)
    / renderer.domElement.clientWidth;
  for (const s of sprites)
    if (s?.visible) s.scale.set(h * 2, h, 1);
}

function _getActiveExpt() {
  if (!store.activeExp) return null;
  const { datasetId, expId } = store.activeExp;
  const ds = store.datasets
    .find(d => d.id === datasetId);
  if (!ds) return null;
  return ds.rawData
    .experiments?.[expId - (ds.expOffset ?? 0)]
    ?? null;
}

// ── Hot-spots (screen-space point detection) ─
// Each entry: { pos: Vector3, radiusPx: number, data }
// Rebuilt every time overlays refresh.
const _hotspots = [];

// ── Rotation axis ─────────────────────────

let _axisPos  = null;
let _axisNeg  = null;
let _rotLabel = null;

function _buildAxis() {
  function _line(mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',
      new THREE.BufferAttribute(
        new Float32Array(6), 3));
    const l = new THREE.Line(geo, mat);
    l.visible = false;
    scene.add(l);
    return l;
  }
  _axisPos  = _line(new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true,
    opacity: 0.90,
  }));
  _axisNeg  = _line(new THREE.LineDashedMaterial({
    color: 0xffffff, dashSize: 35, gapSize: 20,
    transparent: true, opacity: 0.45,
  }));
  _rotLabel = _makeSprite('rot');
}

function _hideAxis() {
  _axisPos.visible  = false;
  _axisNeg.visible  = false;
  _rotLabel.visible = false;
}

function _refreshAxis() {
  if (!_axisPos) return;
  if (!store.overlays.rotAxis) {
    _hideAxis(); return;
  }
  const ra = _getActiveExpt()?.rotation_axis;
  if (!ra) { _hideAxis(); return; }

  const [rx, ry, rz] = ra;
  const L = _AXIS_LENGTH;

  const posArr =
    new Float32Array([0,0,0, rx*L, ry*L, rz*L]);
  _axisPos.geometry
    .attributes.position.array.set(posArr);
  _axisPos.geometry
    .attributes.position.needsUpdate = true;
  _axisPos.visible = true;

  const negArr =
    new Float32Array([0,0,0,-rx*L,-ry*L,-rz*L]);
  _axisNeg.geometry
    .attributes.position.array.set(negArr);
  _axisNeg.geometry
    .attributes.position.needsUpdate = true;
  _axisNeg.computeLineDistances();
  _axisNeg.visible = true;

  _rotLabel.position.set(
    rx*L*1.08, ry*L*1.08, rz*L*1.08);
  _rotLabel.visible = true;

  const data = { type: 'axis', ra };
  // Hotspot on the "rot" label
  _hotspots.push({
    pos: _rotLabel.position.clone(),
    radiusPx: 24,
    data,
  });
}

// ── Beam vector ───────────────────────────

const _BEAM_COLOR = 0x7fffd4; // aquamarine / neon turquoise

let _beamPos  = null;
let _beamNeg  = null;
let _beamLabel = null;

function _buildBeam() {
  function _line(mat) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',
      new THREE.BufferAttribute(
        new Float32Array(6), 3));
    const l = new THREE.Line(geo, mat);
    l.visible = false;
    scene.add(l);
    return l;
  }
  _beamPos   = _line(new THREE.LineBasicMaterial({
    color: _BEAM_COLOR, transparent: true,
    opacity: 0.90,
  }));
  _beamNeg   = _line(new THREE.LineDashedMaterial({
    color: _BEAM_COLOR, dashSize: 35, gapSize: 20,
    transparent: true, opacity: 0.45,
  }));
  _beamLabel = _makeSprite('beam', '#7fffd4');
}

function _hideBeam() {
  _beamPos.visible   = false;
  _beamNeg.visible   = false;
  _beamLabel.visible = false;
}

function _refreshBeam() {
  if (!_beamPos) return;
  if (!store.overlays.beam) { _hideBeam(); return; }
  const bv = _getActiveExpt()?.beam_vector;
  if (!bv) { _hideBeam(); return; }

  const [bx, by, bz] = bv;
  const L = _AXIS_LENGTH;

  const posArr =
    new Float32Array([0,0,0, bx*L, by*L, bz*L]);
  _beamPos.geometry
    .attributes.position.array.set(posArr);
  _beamPos.geometry
    .attributes.position.needsUpdate = true;
  _beamPos.visible = true;

  const negArr =
    new Float32Array([0,0,0,-bx*L,-by*L,-bz*L]);
  _beamNeg.geometry
    .attributes.position.array.set(negArr);
  _beamNeg.geometry
    .attributes.position.needsUpdate = true;
  _beamNeg.computeLineDistances();
  _beamNeg.visible = true;

  _beamLabel.position.set(
    bx*L*1.08, by*L*1.08, bz*L*1.08);
  _beamLabel.visible = true;

  _hotspots.push({
    pos: _beamLabel.position.clone(),
    radiusPx: 24,
    data: { type: 'beam', bv },
  });
}

// ── Reciprocal cell ───────────────────────

const _CELL_COLORS =
  [0xe74c3c, 0x2ecc71, 0x3498db];
const _CELL_CSS =
  ['#e74c3c', '#2ecc71', '#3498db'];
const _CELL_NAMES = ['a*', 'b*', 'c*'];

let _cellArrows = [];
let _cellLabels = [];

function _buildCell() {
  for (let i = 0; i < 3; i++) {
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      SCALE, _CELL_COLORS[i],
      SCALE * 0.12, SCALE * 0.06);
    arrow.visible = false;
    scene.add(arrow);
    _cellArrows.push(arrow);

    _cellLabels.push(
      _makeSprite(_CELL_NAMES[i], _CELL_CSS[i]));
  }
}

function _hideCell() {
  for (const a of _cellArrows) a.visible = false;
  for (const l of _cellLabels) l.visible = false;
}

function _refreshCell() {
  if (!_cellArrows.length) return;
  if (!store.overlays.unitcell) {
    _hideCell(); return;
  }
  const rvs = _getActiveExpt()?.recip_latt_vectors;
  if (!rvs) { _hideCell(); return; }

  for (let i = 0; i < 3; i++) {
    const [x, y, z] = rvs[i];
    const sx = x * _CELL_SCALE;
    const sy = y * _CELL_SCALE;
    const sz = z * _CELL_SCALE;
    const vec = new THREE.Vector3(sx, sy, sz);
    const len = vec.length();
    const dir = vec.clone().normalize();

    _cellArrows[i].setDirection(dir);
    _cellArrows[i].setLength(
      len, len * 0.15, len * 0.08);
    _cellArrows[i].visible = true;

    _cellLabels[i].position.set(
      sx * 1.15, sy * 1.15, sz * 1.15);
    _cellLabels[i].visible = true;

    const data = { type: 'cell', idx: i, vec: rvs[i] };
    _hotspots.push({ pos: vec.clone(), radiusPx: 20, data });
    _hotspots.push({
      pos: _cellLabels[i].position.clone(),
      radiusPx: 24,
      data,
    });
  }
}

// ── Overlay tooltip (called from tooltip.js) ─

/**
 * Check whether cx,cy (canvas-relative pixels)
 * is over an overlay hotspot.
 * Returns { title, rows } or null.
 */
export function checkOverlayHover(cx, cy, rect) {
  let best = null;
  let bestD = Infinity;

  for (const hs of _hotspots) {
    const c = hs.pos.clone().project(camera);
    const sx = ( c.x * 0.5 + 0.5) * rect.width;
    const sy = (-c.y * 0.5 + 0.5) * rect.height;
    const d  = Math.hypot(sx - cx, sy - cy);
    if (d < hs.radiusPx && d < bestD) {
      bestD = d; best = hs.data;
    }
  }

  if (!best) return null;

  if (best.type === 'axis') {
    const [rx, ry, rz] = best.ra;
    return {
      title: 'Rotation axis',
      rows: [
        ['x', rx.toFixed(4)],
        ['y', ry.toFixed(4)],
        ['z', rz.toFixed(4)],
      ],
    };
  } else if (best.type === 'beam') {
    const [bx, by, bz] = best.bv;
    return {
      title: 'Beam',
      rows: [
        ['x', bx.toFixed(4)],
        ['y', by.toFixed(4)],
        ['z', bz.toFixed(4)],
      ],
    };
  } else {
    const [x, y, z] = best.vec;
    return {
      title: _CELL_NAMES[best.idx],
      rows: [
        ['x', (x / SCALE).toFixed(4) + ' Å⁻¹'],
        ['y', (y / SCALE).toFixed(4) + ' Å⁻¹'],
        ['z', (z / SCALE).toFixed(4) + ' Å⁻¹'],
      ],
    };
  }
}

// ── Experiment info panel ─────────────────

function _datasetPath(ds) {
  try {
    const t = ds.exptParser.getImageFilenames(0);
    if (!t) return ds.label;
    const sep = t.includes('/') ? '/' : '\\';
    const dir = t.substring(0, t.lastIndexOf(sep));
    return dir ? `${dir}${sep}${ds.label}` : ds.label;
  } catch {}
  return ds.label;
}

let _normEl = null;

function _initNormPanel() {
  const wrap =
    document.getElementById('canvas-wrap');
  if (!wrap) return;
  _normEl = document.createElement('div');
  Object.assign(_normEl.style, {
    position:      'absolute',
    bottom:        '4px',
    left:          '10px',
    pointerEvents: 'none',
    lineHeight:    '1.6',
    display:       'none',
  });
  wrap.appendChild(_normEl);
}

function _refreshNormPanel() {
  if (!_normEl) return;
  if (!store.overlays.expInfo) {
    _normEl.style.display = 'none';
    return;
  }

  const expt = _getActiveExpt();
  if (!expt) {
    _normEl.style.display = 'none';
    return;
  }

  const { datasetId, expId } =
    store.activeExp ?? {};
  const ds = store.datasets
    .find(d => d.id === datasetId);

  const m   = 'font-size:11px;font-family:monospace';
  const dim = `${m};color:#888`;
  const val = `${m};color:#ccc`;
  // Each row is a list of <span> elements. Text is set with
  // textContent (never innerHTML): some of it (e.g. the file path)
  // comes from user-supplied files and must not be parsed as HTML.
  const rows = [];

  // Experiment ID (first line, colored by spot color)
  if (ds) {
    const localExpId = expId - (ds.expOffset ?? 0);
    rows.push([
      _span('font-size:13px;font-family:monospace;font-weight:bold',
            `Exp ${ds.id}:${localExpId}`, _expColor(ds, expId)),
    ]);
  }

  // Cell axes + angles
  const cn = expt.cell_norms;
  const ca = expt.cell_angles;
  const axLabels = ['a', 'b', 'c'];
  if (cn && ca) {
    const aNames = ['α', 'β', 'γ'];
    for (let i = 0; i < 3; i++) {
      rows.push([
        _span(val, `${axLabels[i]} = ${cn[i].toFixed(2)} Å`),
        _span(dim, `  ${aNames[i]} = ${ca[i].toFixed(1)}°`),
      ]);
    }
  } else if (cn) {
    for (let i = 0; i < 3; i++) {
      rows.push([
        _span(val, `${axLabels[i]} = ${cn[i].toFixed(2)} Å`),
      ]);
    }
  }

  // Wavelength
  if (expt.wavelength != null) {
    rows.push([
      _span(dim, 'λ = '),
      _span(val, `${expt.wavelength.toFixed(4)} Å`),
    ]);
  }

  // Scan range
  if (expt.scan) {
    const s   = expt.scan;
    const end = (
      s.oscillation_start
      + s.oscillation_delta * s.num_images
    ).toFixed(2);
    rows.push([
      _span(dim, 'Scan: '),
      _span(val, `${s.oscillation_start.toFixed(2)}° → ${end}°`),
      _span(dim, ` (Δ = ${s.oscillation_delta.toFixed(3)}°, `
                 + `${s.num_images} imgs)`),
    ]);
  }

  // Spot counts for this experiment
  if (ds) {
    const ids  = ds.rawData.data.id;
    const idxS = ds.rawData.data.indexed_status;
    const intS =
      ds.rawData.data.integrated_status;
    let total = 0, indexed = 0, integrated = 0;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === expId) {
        total++;
        if (idxS[i])  indexed++;
        if (intS[i])  integrated++;
      }
    }
    const count = (label, n) => {
      if (n > 0) rows.push([
        _span(dim, `${label}: `),
        _span(val, n.toLocaleString()),
      ]);
    };
    count('Spots', total);
    count('Indexed', indexed);
    count('Integrated', integrated);
  }

  // File path (last line, absolute, same color as exp ID)
  if (ds) {
    rows.push([
      _span(m, String(_datasetPath(ds)), _expColor(ds, expId)),
    ]);
  }

  if (!rows.length) {
    _normEl.style.display = 'none';
    return;
  }

  _normEl.replaceChildren();
  rows.forEach((spans, i) => {
    if (i > 0) _normEl.appendChild(document.createElement('br'));
    _normEl.append(...spans);
  });
  _normEl.style.display = 'block';
}

/** A <span> with fixed styling and plain-text content. */
function _span(css, text, color) {
  const el = document.createElement('span');
  el.style.cssText = css;
  if (color) el.style.color = color;
  el.textContent = text;
  return el;
}

/** Colour used for an experiment (user override or default). */
function _expColor(ds, expId) {
  const localExpId = expId - (ds.expOffset ?? 0);
  const key = `${ds.id}:${expId}`;
  const colorId = (ds.colorOffset ?? 0) + localExpId;
  return store.expColorOverrides[key] ?? expColor(colorId);
}

// ── Per-frame sprite scaling ──────────────

function _updateSpriteScales() {
  _fixSpriteScales([
    _rotLabel, _beamLabel, ..._cellLabels,
  ]);
}

// ── Refresh all ───────────────────────────

function _refreshAll() {
  _hotspots.length = 0;
  _refreshAxis();
  _refreshBeam();
  _refreshCell();
  _refreshNormPanel();
}

// ── Public API ────────────────────────────

export function initOverlays() {
  _buildAxis();
  _buildBeam();
  _buildCell();
  _initNormPanel();
  addFrameCallback(_updateSpriteScales);

  onChange('overlays-changed',   _refreshAll);
  onChange('active-exp-changed', _refreshAll);
  onChange('datasets-changed',   _refreshAll);
  onChange('colors-changed',     _refreshNormPanel);
}
