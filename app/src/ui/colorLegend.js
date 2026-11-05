/**
 * ui/colorLegend.js
 *
 * Small legend in the top-right corner of the 3D view, shown when spots
 * are coloured by a quantity ("Colour by" menu): the quantity, the colour
 * bar and the value range. Hidden in "Experiment" mode.
 */

import { onColorScaleChange, rampColor, NO_VALUE_COLOR }
  from '../filters/colors.js';

export function initColorLegend() {
  const wrap = document.getElementById('canvas-wrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.id = 'color-legend';
  el.innerHTML = `
    <div class="cl-title"></div>
    <div class="cl-bar"></div>
    <div class="cl-ticks"><span class="cl-lo"></span><span class="cl-hi"></span></div>
    <div class="cl-note"></div>`;
  wrap.appendChild(el);

  const stops = Array.from({ length: 11 }, (_, k) =>
    `${rampColor(k / 10)} ${k * 10}%`).join(', ');
  el.querySelector('.cl-bar').style.background =
    `linear-gradient(to right, ${stops})`;

  onColorScaleChange(({ mode, lo, hi, count }) => {
    if (mode.id === 'experiment') { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.querySelector('.cl-title').textContent = mode.label;
    el.querySelector('.cl-lo').textContent = count ? _fmt(lo) : '–';
    el.querySelector('.cl-hi').textContent = count ? _fmt(hi) : '–';
    el.querySelector('.cl-note').textContent = count
      ? (mode.fullRange ? '' : '2–98% of values; beyond: end colours')
      : 'not in the loaded file(s)';
    el.querySelector('.cl-note').style.color =
      count ? '' : NO_VALUE_COLOR;
  });
}

function _fmt(v) {
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  return String(Number(v.toPrecision(3)));
}
