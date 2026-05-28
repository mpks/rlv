/**
 * ui/colorPicker.js
 *
 * Floating HSV colour-picker popup with
 * per-experiment opacity control.
 *
 * Usage:
 *   showColorPicker(anchorEl, '#rrggbb', opacity,
 *     (hex, opacity) => { /* called on every change *‌/ });
 *
 * opacity: 0.0–1.0
 * Closes on outside click or Escape.
 * Clicking the same anchor again toggles it.
 */

const W        = 200;
const SV_H     = 150;
const HUE_H    = 14;
const OPACITY_H = 14;

let _popup   = null;
let _anchor  = null;
let _cleanup = null;

export function showColorPicker(
  anchorEl, initialHex, initialOpacity, onChange
) {
  if (_popup && _anchor === anchorEl) {
    _destroy(); return;
  }
  _destroy();
  _anchor = anchorEl;

  let [h, s, v] = _hexToHsv(initialHex);
  let alpha = typeof initialOpacity === 'number'
    ? Math.max(0, Math.min(1, initialOpacity))
    : 1.0;

  _popup = document.createElement('div');
  _popup.className = 'cp-popup';
  _popup.innerHTML = `
    <div class="cp-sv-wrap">
      <canvas class="cp-sv"
        width="${W}" height="${SV_H}"></canvas>
      <div class="cp-cursor"></div>
    </div>
    <div class="cp-hue-wrap">
      <canvas class="cp-hue"
        width="${W}" height="${HUE_H}"></canvas>
      <div class="cp-hue-thumb"></div>
    </div>
    <div class="cp-opacity-wrap">
      <canvas class="cp-opacity"
        width="${W}" height="${OPACITY_H}"></canvas>
      <div class="cp-opacity-thumb"></div>
    </div>
    <div class="cp-bottom">
      <div class="cp-swatch"></div>
      <input class="cp-hex" type="text"
        maxlength="7" spellcheck="false">
      <input class="cp-opacity-num" type="number"
        min="0" max="100" step="1" title="Opacity %">
    </div>`;

  document.body.appendChild(_popup);

  const ar = anchorEl.getBoundingClientRect();
  const pr = _popup.getBoundingClientRect();
  let left = ar.right + 10;
  let top  = ar.top   - 8;
  if (left + pr.width  > window.innerWidth  - 8)
    left = ar.left - pr.width - 10;
  if (top  + pr.height > window.innerHeight - 8)
    top  = window.innerHeight - pr.height - 8;
  if (top < 8) top = 8;
  _popup.style.left = `${left}px`;
  _popup.style.top  = `${top}px`;

  const svEl        = _popup.querySelector('.cp-sv');
  const cursor      = _popup.querySelector('.cp-cursor');
  const hueEl       = _popup.querySelector('.cp-hue');
  const hueThumb    = _popup.querySelector('.cp-hue-thumb');
  const opacityEl   = _popup.querySelector('.cp-opacity');
  const opacThumb   = _popup.querySelector('.cp-opacity-thumb');
  const swatch      = _popup.querySelector('.cp-swatch');
  const hexIn       = _popup.querySelector('.cp-hex');
  const opacNumIn   = _popup.querySelector('.cp-opacity-num');

  let drag = null; // 'sv' | 'hue' | 'opacity'

  // ── Draw ──────────────────────────────

  function renderOpacity() {
    const oc = opacityEl.getContext('2d');
    // Checkerboard background
    const tile = 4;
    for (let x = 0; x < W; x += tile) {
      for (let y = 0; y < OPACITY_H; y += tile) {
        oc.fillStyle =
          Math.floor(x / tile + y / tile) % 2 === 0
            ? '#888' : '#bbb';
        oc.fillRect(x, y, tile, tile);
      }
    }
    // Gradient from transparent to full color
    const hex = _hsvToHex(h, s, v);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const og = oc.createLinearGradient(0, 0, W, 0);
    og.addColorStop(0, `rgba(${r},${g},${b},0)`);
    og.addColorStop(1, `rgba(${r},${g},${b},1)`);
    oc.fillStyle = og;
    oc.fillRect(0, 0, W, OPACITY_H);

    opacThumb.style.left = `${alpha * W}px`;
    if (document.activeElement !== opacNumIn)
      opacNumIn.value = Math.round(alpha * 100);
  }

  function render() {
    const sc = svEl.getContext('2d');
    const hg = sc.createLinearGradient(0, 0, W, 0);
    hg.addColorStop(0, '#fff');
    hg.addColorStop(1, `hsl(${h},100%,50%)`);
    sc.fillStyle = hg;
    sc.fillRect(0, 0, W, SV_H);
    const vg = sc.createLinearGradient(0, 0, 0, SV_H);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, '#000');
    sc.fillStyle = vg;
    sc.fillRect(0, 0, W, SV_H);

    const hc = hueEl.getContext('2d');
    const rg = hc.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++)
      rg.addColorStop(i / 6,
        `hsl(${i * 60},100%,50%)`);
    hc.fillStyle = rg;
    hc.fillRect(0, 0, W, HUE_H);

    cursor.style.left   = `${s * W}px`;
    cursor.style.top    = `${(1 - v) * SV_H}px`;
    hueThumb.style.left = `${(h / 360) * W}px`;

    const hex = _hsvToHex(h, s, v);
    swatch.style.background = hex;
    if (document.activeElement !== hexIn)
      hexIn.value = hex;

    renderOpacity();
  }

  function emit() {
    onChange(_hsvToHex(h, s, v), alpha);
  }

  // ── Interactions ──────────────────────

  function pickSV(e) {
    const r = svEl.getBoundingClientRect();
    s = Math.max(0, Math.min(1,
      (e.clientX - r.left) / W));
    v = Math.max(0, Math.min(1,
      1 - (e.clientY - r.top) / SV_H));
    render(); emit();
  }

  function pickHue(e) {
    const r = hueEl.getBoundingClientRect();
    h = Math.max(0, Math.min(359.99,
      (e.clientX - r.left) / W * 360));
    render(); emit();
  }

  function pickOpacity(e) {
    const r = opacityEl.getBoundingClientRect();
    alpha = Math.max(0, Math.min(1,
      (e.clientX - r.left) / W));
    renderOpacity(); emit();
  }

  svEl.addEventListener('mousedown', e => {
    drag = 'sv'; pickSV(e); e.preventDefault();
  });
  hueEl.addEventListener('mousedown', e => {
    drag = 'hue'; pickHue(e); e.preventDefault();
  });
  opacityEl.addEventListener('mousedown', e => {
    drag = 'opacity'; pickOpacity(e); e.preventDefault();
  });

  function onMove(e) {
    if (drag === 'sv')      pickSV(e);
    if (drag === 'hue')     pickHue(e);
    if (drag === 'opacity') pickOpacity(e);
  }
  function onUp() { drag = null; }

  hexIn.addEventListener('change', () => {
    const val = hexIn.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      [h, s, v] = _hexToHsv(val);
      render(); emit();
    }
  });
  hexIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') hexIn.blur();
    e.stopPropagation();
  });

  opacNumIn.addEventListener('change', () => {
    const pct = parseFloat(opacNumIn.value);
    if (isNaN(pct)) return;
    alpha = Math.max(0, Math.min(1, pct / 100));
    renderOpacity(); emit();
  });
  opacNumIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') opacNumIn.blur();
    e.stopPropagation();
  });

  function onOutside(e) {
    if (!_popup.contains(e.target)
        && e.target !== anchorEl)
      _destroy();
  }
  function onKey(e) {
    if (e.key === 'Escape') _destroy();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);
  setTimeout(() => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown',   onKey);
  }, 0);

  _cleanup = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup',   onUp);
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown',   onKey);
  };

  render();
}

function _destroy() {
  if (_popup)   { _popup.remove();  _popup   = null; }
  if (_cleanup) { _cleanup();       _cleanup = null; }
  _anchor = null;
}

// ── Colour conversions ────────────────────

function _hexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d   = max - min;
  let hue = 0;
  if (d > 0) {
    if      (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / d + 2;
    else                hue = (r - g) / d + 4;
    hue /= 6;
  }
  return [hue * 360, max ? d / max : 0, max];
}

function _hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  let r, g, b;
  if      (h < 60)  [r,g,b] = [c,x,0];
  else if (h < 120) [r,g,b] = [x,c,0];
  else if (h < 180) [r,g,b] = [0,c,x];
  else if (h < 240) [r,g,b] = [0,x,c];
  else if (h < 300) [r,g,b] = [x,0,c];
  else              [r,g,b] = [c,0,x];
  const f = n => Math.round((n + m) * 255)
    .toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
