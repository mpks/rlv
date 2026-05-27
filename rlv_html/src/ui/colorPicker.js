/**
 * ui/colorPicker.js
 *
 * Floating HSV colour-picker popup.
 *
 * Usage:
 *   showColorPicker(anchorEl, '#rrggbb',
 *     hex => { /* called on every change *‌/ });
 *
 * Closes on outside click or Escape.
 * Clicking the same anchor again toggles it.
 */

const W     = 200;  // shared width
const SV_H  = 150;  // saturation-value square height
const HUE_H = 14;   // hue rail height

let _popup   = null;
let _anchor  = null;
let _cleanup = null;

export function showColorPicker(
  anchorEl, initialHex, onChange
) {
  // Toggle off if same circle clicked again
  if (_popup && _anchor === anchorEl) {
    _destroy(); return;
  }
  _destroy();
  _anchor = anchorEl;

  let [h, s, v] = _hexToHsv(initialHex);

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
    <div class="cp-bottom">
      <div class="cp-swatch"></div>
      <input class="cp-hex" type="text"
        maxlength="7" spellcheck="false">
    </div>`;

  document.body.appendChild(_popup);

  // Position near the anchor, clamped to viewport
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

  const svEl     = _popup.querySelector('.cp-sv');
  const cursor   = _popup.querySelector('.cp-cursor');
  const hueEl    = _popup.querySelector('.cp-hue');
  const hueThumb = _popup.querySelector('.cp-hue-thumb');
  const swatch   = _popup.querySelector('.cp-swatch');
  const hexIn    = _popup.querySelector('.cp-hex');

  let drag = null; // 'sv' | 'hue'

  // ── Draw ──────────────────────────────

  function render() {
    // Saturation-value square
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

    // Hue rail
    const hc = hueEl.getContext('2d');
    const rg = hc.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++)
      rg.addColorStop(i / 6,
        `hsl(${i * 60},100%,50%)`);
    hc.fillStyle = rg;
    hc.fillRect(0, 0, W, HUE_H);

    // Cursor & thumb
    cursor.style.left   = `${s * W}px`;
    cursor.style.top    = `${(1 - v) * SV_H}px`;
    hueThumb.style.left = `${(h / 360) * W}px`;

    const hex = _hsvToHex(h, s, v);
    swatch.style.background = hex;
    if (document.activeElement !== hexIn)
      hexIn.value = hex;
  }

  function emit() {
    onChange(_hsvToHex(h, s, v));
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

  svEl.addEventListener('mousedown', e => {
    drag = 'sv'; pickSV(e); e.preventDefault();
  });
  hueEl.addEventListener('mousedown', e => {
    drag = 'hue'; pickHue(e); e.preventDefault();
  });

  function onMove(e) {
    if (drag === 'sv')  pickSV(e);
    if (drag === 'hue') pickHue(e);
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
  // Defer so the current click doesn't immediately close
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
