/**
 * ui/sidebar.js
 *
 * Sidebar UI:
 *   - Collapsible sections
 *   - Toggle switches
 *   - Experiment list with colour swatches
 *   - Filter slider/number pairs
 */

import { store, setExpColor, setExpOpacity, setActiveExp, setOverlay, removeDataset, totalSpots, onChange }
  from '../state/store.js';
import { showColorPicker }
  from './colorPicker.js';
import { createRangeSlider }
  from './rangeSlider.js';
import { setTooltipEnabled }
  from '../labels/tooltip.js';
import {
  setHKLLabelsEnabled,
  setResLabelsEnabled,
  setIntLabelsEnabled,
  setHKLLabelSize,
  rebuildHKLLabels,
} from '../labels/hklLabels.js';
import { expColor }
  from '../filters/colors.js';
import {
  setDMin, setDMax,
  setZMin, setZMax,
  setPxMin, setPxMax,
  setHMin, setHMax,
  setKMin, setKMax,
  setLMin, setLMax,
  setShowMode,
  setExpVisible,
  applyFilters,
} from '../filters/filters.js';
import {
  recolour,
} from '../filters/colors.js';
import {
  applyExpColor,
  setPointSize,
  buildPointCloud,
} from '../scene/points.js';
import {
  getPointsObject,
  setPointsObject,
} from '../scene/renderer.js';
import {
  initInspectionSphere,
  setInspectionD,
  setInspectionSphereVisible,
} from '../scene/resolutionSpheres.js';
import {
  recomputeExpPoints,
  hasCrystal,
  transformExpOverlayVectors,
} from '../io/rlv_io.js';

// ── Module state ─────────────────────────
let _resSlider = null;
let _zSlider   = null;
let _pxSlider  = null;
let _hSlider   = null;
let _kSlider   = null;
let _lSlider   = null;

// ── Collapsible sections ──────────────────

export function initCollapsibleSections() {
  document
    .querySelectorAll('.section-label')
    .forEach(label => {
      label.addEventListener(
        'click', () => {
          const id =
            label.dataset.section;
          const content =
            document.getElementById(
              `section-${id}`);
          if (!content) return;
          label.classList
            .toggle('collapsed');
          content.classList
            .toggle('collapsed');
        });
    });
}

// ── Toggles ───────────────────────────────

export function initToggles() {
  document
    .querySelectorAll('#sidebar .toggle')
    .forEach(tog => {
      tog.addEventListener('click', () => {
        tog.classList.toggle('on');
      });
    });
}

export function isToggleOn(id) {
  const el =
    document.getElementById(id);
  return el?.classList.contains('on')
    ?? false;
}

// ── Filter panel wiring ───────────────────

/**
 * Wire all sidebar filter controls.
 * Call once after DOM is ready.
 */
export function initFilterPanel() {
  _resSlider = createRangeSlider(
    document.getElementById('res-range'),
    {
      numLo: document.getElementById('res-num-lo'),
      numHi: document.getElementById('res-num-hi'),
      // Internal values are d* (1/d Å⁻¹); display is d (Å)
      toDisplay:   v => v > 0 ? (1 / v).toFixed(2) : '—',
      fromDisplay: s => {
        const d = parseFloat(s);
        return d > 0 ? 1 / d : 0;
      },
      // lo thumb = left = low d* = large d = dMax cutoff
      onLo: v => setDMax(v > 0 ? 1 / v : Infinity),
      // hi thumb = right = high d* = small d = dMin cutoff
      onHi: v => setDMin(v > 0 ? 1 / v : 0),
    });
  _zSlider = createRangeSlider(
    document.getElementById('z-range'),
    {
      numLo: document.getElementById('z-num-lo'),
      numHi: document.getElementById('z-num-hi'),
      toDisplay:   v => String(Math.round(v)),
      fromDisplay: s => parseFloat(s),
      onLo: v => setZMin(v),
      onHi: v => setZMax(v),
    });

  _pxSlider = createRangeSlider(
    document.getElementById('px-range'),
    {
      numLo: document.getElementById('px-num-lo'),
      numHi: document.getElementById('px-num-hi'),
      toDisplay: v => _pxPercentiles
        ? String(_pxPercentiles[Math.round(
            Math.max(0, Math.min(
              _pxPercentiles.length - 1, v)))])
        : '0',
      fromDisplay: s => {
        if (!_pxPercentiles) return 0;
        const val = parseFloat(s);
        let best = 0, bestDist = Infinity;
        for (let i = 0;
             i < _pxPercentiles.length; i++) {
          const dist =
            Math.abs(_pxPercentiles[i] - val);
          if (dist < bestDist) {
            bestDist = dist; best = i;
          }
        }
        return best;
      },
      onLo: v => {
        if (_pxPercentiles) {
          const idx = Math.round(Math.max(0,
            Math.min(
              _pxPercentiles.length - 1, v)));
          setPxMin(_pxPercentiles[idx]);
        }
      },
      onHi: v => {
        if (_pxPercentiles) {
          const idx = Math.round(Math.max(0,
            Math.min(
              _pxPercentiles.length - 1, v)));
          setPxMax(_pxPercentiles[idx]);
        }
      },
    });

  function _makeHKLSlider(rangeId, loId, hiId, onLo, onHi) {
    return createRangeSlider(
      document.getElementById(rangeId),
      {
        numLo: document.getElementById(loId),
        numHi: document.getElementById(hiId),
        toDisplay:   v => String(Math.round(v)),
        fromDisplay: s => {
          const n = parseInt(s);
          return isNaN(n) ? 0 : n;
        },
        onLo: v => onLo(Math.round(v)),
        onHi: v => onHi(Math.round(v)),
      });
  }

  _hSlider = _makeHKLSlider(
    'h-range', 'h-num-lo', 'h-num-hi',
    setHMin, setHMax);
  _kSlider = _makeHKLSlider(
    'k-range', 'k-num-lo', 'k-num-hi',
    setKMin, setKMax);
  _lSlider = _makeHKLSlider(
    'l-range', 'l-num-lo', 'l-num-hi',
    setLMin, setLMax);

  // Show group radio buttons
  _wireRadioGroup('show-group', setShowMode);


  // Overlay toggles
  _wireOverlayToggle(
    'tog-axis',   'rotAxis');
  _wireOverlayToggle(
    'tog-cell',   'unitcell');
  _wireOverlayToggle(
    'tog-beam',   'beam');
  _wireOverlayToggle(
    'tog-exp-info', 'expInfo');

  // Crystal frame toggle (global recompute)
  const togCF = document.getElementById(
    'tog-crystal-frame');
  if (togCF) {
    togCF.addEventListener('click', () => {
      const on =
        togCF.classList.contains('on');
      store.overlays.crystalFrame = on;
      _applyCrystalFrame(on);
    });
  }

  // Spot tooltips toggle
  const togTT =
    document.getElementById('tog-tooltips');
  if (togTT) {
    togTT.addEventListener('click', () => {
      setTooltipEnabled(
        togTT.classList.contains('on'));
    });
  }

  // Miller index label toggle
  const togHKL =
    document.getElementById('tog-ann-hkl');
  if (togHKL) {
    togHKL.addEventListener('click', () => {
      setHKLLabelsEnabled(
        togHKL.classList.contains('on'));
    });
  }

  // Resolution label toggle
  const togRes =
    document.getElementById('tog-ann-res');
  if (togRes) {
    togRes.addEventListener('click', () => {
      setResLabelsEnabled(
        togRes.classList.contains('on'));
    });
  }

  // Intensity label toggle
  const togInt =
    document.getElementById('tog-ann-int');
  if (togInt) {
    togInt.addEventListener('click', () => {
      setIntLabelsEnabled(
        togInt.classList.contains('on'));
    });
  }

  _syncSlider('ann-size', 'ann-size-num',
    setHKLLabelSize);

  // Invert rotation axis toggle
  const togInv = document.getElementById(
    'tog-inv-rot-axis');
  if (togInv) {
    togInv.addEventListener('click', () => {
      const inverted =
        togInv.classList.contains('on');
      const ae = store.activeExp;
      if (!ae) return;
      const key =
        `${ae.datasetId}:${ae.expId}`;
      if (inverted)
        store.invertedExpts.add(key);
      else
        store.invertedExpts.delete(key);
      const ds = store.datasets.find(
        d => d.id === ae.datasetId);
      if (!ds) return;
      const localExpId =
        ae.expId - ds.expOffset;
      recomputeExpPoints(
        ds, localExpId, inverted);
      const pts = buildPointCloud();
      setPointsObject(pts);
      recolour();
      applyFilters();
      updateResolutionRange();
    });

    // Sync toggle when active exp changes
    onChange('active-exp-changed',
      ({ datasetId, expId }) => {
        const key = `${datasetId}:${expId}`;
        const inv =
          store.invertedExpts.has(key);
        togInv.classList.toggle('on', inv);
      });
  }

  // Point size
  _syncSlider(
    'filt-point-size', 'point-size-num',
    v => setPointSize(getPointsObject(), v));

}

// ── Tools panel ───────────────────────────

export function initToolsPanel() {
  initInspectionSphere();

  const tog = document.getElementById(
    'tog-inspect-sphere');
  if (tog) {
    tog.addEventListener('click', () => {
      setInspectionSphereVisible(
        tog.classList.contains('on'));
    });
  }

  _syncDStarSlider(
    'inspect-d-slider',
    'inspect-d-num',
    setInspectionD);
}

/**
 * Update the inspection sphere slider range
 * to cover from very large d down to dLo
 * (highest resolution in the loaded data).
 * Called after every load.
 */
export function updateInspectionRange(dLo) {
  const D_MAX     = 999;   // Å — far beyond any data
  const D_DEFAULT = 5.0;   // Å — sensible starting radius
  const dStarLo = 1 / D_MAX;
  const dStarHi = 1 / dLo;
  const step    = parseFloat(
    ((dStarHi - dStarLo) / 50)
      .toPrecision(2));

  // Clamp 5 Å to the slider's valid range
  const dStarDefault = Math.max(dStarLo,
    Math.min(dStarHi, 1 / D_DEFAULT));

  _setDStarSliderRange(
    'inspect-d-slider', 'inspect-d-num',
    dStarLo, dStarHi, step, dStarDefault);

  // Pre-set the sphere radius so it's already
  // at 5 Å when the user toggles it on.
  setInspectionD(1 / dStarDefault);
}

// ── Experiment list ───────────────────────

// Returns the CSS `background` value for a
// color circle: solid when opacity=1, split
// left=solid / right=transparent otherwise.
function _circleStyle(hex, opacity) {
  if (opacity >= 1.0) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `linear-gradient(to right,`
    + `${hex} 50%,`
    + `rgba(${r},${g},${b},${opacity}) 50%)`;
}

// Build "directory/filename.expt" tooltip text
// from the imageset template embedded in the .expt
// JSON. Template e.g. /path/to/dataset/frames/img.cbf
// → strip image filename → /path/to/dataset/frames
// → that directory + expt filename.
function _datasetHint(ds) {
  try {
    const t = ds.exptParser.getImageFilenames(0);
    if (!t) return ds.label;
    const sep  = t.includes('/') ? '/' : '\\';
    const dir  = t.substring(0, t.lastIndexOf(sep));
    return dir ? `${dir}${sep}${ds.label}` : ds.label;
  } catch {}
  return ds.label;
}

/**
 * Build exp list from all loaded datasets.
 */
export function buildExpList() {

  const list = document.getElementById('exp-list');

  if (!list) return;
  list.innerHTML = '';

  const datasets = store.datasets;

  if (!datasets?.length) return;

  let firstDs = null, firstExpId = null;

  for (const ds of datasets) {
    const data      = ds.rawData.data;
    const nExpts    =
      ds.exptParser.numExperiments();
    const expOffset = ds.expOffset ?? 0;
    const fullPath  = _datasetHint(ds);

    for (let expId = expOffset;
         expId < expOffset + nExpts;
         expId++) {
      if (firstDs === null) {
        firstDs = ds;
        firstExpId = expId;
      }

      const count = data.id
        .filter(x => x === expId).length;
      const labelKey =
        `${ds.id}:${expId}`;
      const colorId =
        (ds.colorOffset ?? 0)
        + (expId - expOffset);
      const color =
        store.expColorOverrides[labelKey]
        ?? expColor(colorId);
      const expOpacity =
        store.expOpacityOverrides[labelKey] ?? 1.0;
      const active = store.activeExp;
      const checked =
        active &&
        active.datasetId === ds.id &&
        active.expId     === expId;

      const row =
        document.createElement('div');
      row.className = 'exp-row';
      const savedLabel =
        store.expLabels[labelKey] ?? '';

      const makeTooltip = lbl =>
        `Path: ${fullPath}`
        + (lbl ? `\nLabel: ${lbl}` : '');

      const frozen =
        store.frozenExpts.has(labelKey);
      const togOn =
        store.filters.visibleExpts
          .has(labelKey);

      // Fixed structure only. Values that can come from files or
      // from the user (path, label, colour) are set below through DOM
      // properties / textContent, never interpolated into HTML.
      row.innerHTML = `
        <button class="exp-remove"
          title="Remove dataset">×</button>
        <input type="radio"
          class="exp-radio"
          name="active-exp">
        <div class="exp-color-circle"></div>
        <span class="exp-label"></span>
        <input type="text"
          class="exp-user-label"
          placeholder="label…">
        <span class="exp-count"></span>
        <div class="toggle ${togOn ? 'on' : ''}
          ${frozen ? 'frozen' : ''}"
          data-dsid="${ds.id}"
          data-expid="${expId}">
        </div>`;
      row.querySelector('.exp-radio').checked = !!checked;
      row.querySelector('.exp-color-circle').style.background =
        _circleStyle(color, expOpacity);
      const labelSpan = row.querySelector('.exp-label');
      labelSpan.textContent = `exp ${ds.id}:${expId - expOffset}`;
      labelSpan.title = makeTooltip(savedLabel);
      row.querySelector('.exp-user-label').value = savedLabel;
      row.querySelector('.exp-count').textContent =
        count.toLocaleString();
      list.appendChild(row);

      row.querySelector('.exp-remove')
        .addEventListener('click', e => {
          e.stopPropagation();
          if (store.activeExp?.datasetId
              === ds.id) {
            store.activeExp = null;
          }
          removeDataset(ds.id);
          const pts = buildPointCloud();
          setPointsObject(pts);
          recolour();
          applyFilters();
          updateResolutionRange();
          updateZRange();
          updatePxRange();
          updateHKLRange();
          rebuildHKLLabels();
          buildExpList();
          setInfoLine(
            `${store.datasets.length} dataset(s)`
            + ` · ${totalSpots().toLocaleString()} spots`);
        });

      const labelInput =
        row.querySelector('.exp-user-label');
      const expLabelEl =
        row.querySelector('.exp-label');
      labelInput.addEventListener(
        'blur', () => {
          store.expLabels[labelKey] =
            labelInput.value;
          expLabelEl.title =
            makeTooltip(labelInput.value);
        });
      labelInput.addEventListener(
        'keydown', e => {
          if (e.key === 'Enter') {
            labelInput.blur();
          }
        });

      row.querySelector('.exp-radio')
        .addEventListener('change', () => {
          setActiveExp(ds.id, expId);
        });

      row.querySelector('.toggle')
        .addEventListener('click', tog => {
          if (tog.currentTarget
              .classList.contains('frozen'))
            return;
          tog.currentTarget
            .classList.toggle('on');
          const on = tog.currentTarget
            .classList.contains('on');
          setExpVisible(ds.id, expId, on);
        });

      const circleEl =
        row.querySelector('.exp-color-circle');
      circleEl.addEventListener('click', e => {
        e.stopPropagation();
        const currentHex =
          store.expColorOverrides[labelKey]
          ?? color;
        const currentOpacity =
          store.expOpacityOverrides[labelKey]
          ?? 1.0;
        showColorPicker(
          circleEl, currentHex, currentOpacity,
          (hex, opacity) => {
            setExpColor(ds.id, expId, hex);
            setExpOpacity(ds.id, expId, opacity);
            circleEl.style.background =
              _circleStyle(hex, opacity);
            recolour();
            applyFilters();
          });
      });
    }
  }

  // Auto-select first experiment if none
  // is active yet (e.g. after replace load).
  if (store.activeExp === null
      && firstDs !== null) {
    setActiveExp(firstDs.id, firstExpId);
    const firstRadio =
      list.querySelector('.exp-radio');
    if (firstRadio) firstRadio.checked = true;
  }
}/**
 * Update the experiment list after
 * new data is loaded.
 */
export function refreshExpList() {
  buildExpList();
}

// ── Info line ─────────────────────────────

export function setInfoLine(text) {
  const el =
    document.getElementById('info-line');
  if (el) el.textContent = text;
}


// ── Image index range ─────────────────────

/**
 * Recompute image-index extent across all
 * loaded datasets, rescale the z sliders to
 * cover that range, and reset filter values
 * to show all frames.  Call after every load.
 */
export function updateZRange() {
  let zLo = Infinity, zHi = -Infinity;
  for (const ds of store.datasets) {
    for (const z of ds.rawData.data.z) {
      if (z < zLo) zLo = z;
      if (z > zHi) zHi = z;
    }
  }
  if (!isFinite(zLo)) return;

  // Round outward to integer boundaries
  zLo = Math.floor(zLo);
  zHi = Math.ceil(zHi);

  _zSlider?.setRange(zLo, zHi, zLo, zHi);

  store.filters.zMin = zLo;
  store.filters.zMax = zHi;
}

// ── Pixel count range ─────────────────────

// Percentile grid: 5% steps 0–80%,
// 2% steps 80–94%, 1% steps 94–100%.
// 30 breakpoints → 29 slider steps.
const _PX_PCT_POINTS = [
   0,  5, 10, 15, 20, 25, 30, 35, 40, 45,
  50, 55, 60, 65, 70, 75, 80,
  82, 84, 86, 88, 90, 92, 94,
  95, 96, 97, 98, 99, 100,
];
let _pxPercentiles = null;

function _computePercentiles(values, pcts) {
  const sorted =
    [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return pcts.map(p => {
    const pos  = (p / 100) * (n - 1);
    const lo   = Math.floor(pos);
    const hi   = Math.ceil(pos);
    const frac = pos - lo;
    return Math.round(
      sorted[lo] * (1 - frac)
      + sorted[hi] * frac);
  });
}

/**
 * Recompute n_signal extent across all
 * loaded datasets that carry px_count data.
 * Datasets without it are unaffected.
 * Call after every load.
 */
export function updatePxRange() {
  const all = [];
  for (const ds of store.datasets) {
    const px = ds.rawData.data.px_count;
    if (!px) continue;
    for (const v of px) all.push(v);
  }
  if (all.length === 0) return;

  _pxPercentiles =
    _computePercentiles(all, _PX_PCT_POINTS);

  const last = _pxPercentiles.length - 1;
  _pxSlider?.setRange(0, last, 0, last);

  store.filters.pxMin = _pxPercentiles[0];
  store.filters.pxMax = _pxPercentiles[last];
}

// ── Miller index range ────────────────────

/**
 * Recompute H/K/L extent across all indexed
 * spots and reset sliders to full range.
 * Call after every load.
 */
export function updateHKLRange() {
  let hLo =  Infinity, hHi = -Infinity;
  let kLo =  Infinity, kHi = -Infinity;
  let lLo =  Infinity, lHi = -Infinity;

  for (const ds of store.datasets) {
    const d  = ds.rawData.data;
    const np = d.h.length;
    for (let i = 0; i < np; i++) {
      if (!d.indexed_status[i]) continue;
      if (d.h[i] < hLo) hLo = d.h[i];
      if (d.h[i] > hHi) hHi = d.h[i];
      if (d.k[i] < kLo) kLo = d.k[i];
      if (d.k[i] > kHi) kHi = d.k[i];
      if (d.l[i] < lLo) lLo = d.l[i];
      if (d.l[i] > lHi) lHi = d.l[i];
    }
  }
  if (!isFinite(hLo)) return; // no indexed spots

  _hSlider?.setRange(hLo, hHi, hLo, hHi);
  _kSlider?.setRange(kLo, kHi, kLo, kHi);
  _lSlider?.setRange(lLo, lHi, lLo, lHi);

  store.filters.hMin = hLo;
  store.filters.hMax = hHi;
  store.filters.kMin = kLo;
  store.filters.kMax = kHi;
  store.filters.lMin = lLo;
  store.filters.lMax = lHi;
}

// ── Resolution range ──────────────────────

/**
 * Recompute d-spacing extent across all
 * loaded datasets, rescale the resolution
 * sliders to 50 steps over that range,
 * and reset both filter values to show
 * all spots.  Call after every load.
 */
export function updateResolutionRange() {
  let dLo = Infinity, dHi = 0;
  for (const ds of store.datasets) {
    for (const d of
        ds.rawData.data.d_spacing) {
      if (d > 0 && d < dLo) dLo = d;
      if (d > dHi) dHi = d;
    }
  }
  if (!isFinite(dLo) || dHi === 0) return;

  // Slider positions are in d* = 1/d (Å⁻¹)
  // so each step covers equal reciprocal-
  // space distance.  Displayed values are
  // converted back to d (Å) for the user.
  const dStarLo = 1.0 / dHi; // low-res end (left thumb)
  const dStarHi = 1.0 / dLo; // high-res end (right thumb)

  _resSlider?.setRange(dStarLo, dStarHi, dStarLo, dStarHi);

  store.filters.dMin = dLo;
  store.filters.dMax = dHi;
}

// ── Helpers ───────────────────────────────

// Set slider range in d* space; number
// input shows the corresponding d value (Å).
function _setDStarSliderRange(
  sliderId, numId,
  dStarMin, dStarMax, step, dStarDefault
) {
  const slider =
    document.getElementById(sliderId);
  const num =
    document.getElementById(numId);
  if (!slider || !num) return;
  slider.min   = dStarMin;
  slider.max   = dStarMax;
  slider.step  = step;
  slider.value = dStarDefault;
  num.value    =
    (1.0 / dStarDefault).toFixed(2);
}

// Slider position is linear in d* (Å⁻¹);
// number input shows and accepts d (Å).
function _syncDStarSlider(
  sliderId, numId, onChangeD
) {
  const slider =
    document.getElementById(sliderId);
  const num =
    document.getElementById(numId);
  if (!slider || !num) return;

  slider.addEventListener('input', () => {
    const dStar = parseFloat(slider.value);
    const d = 1.0 / dStar;
    num.value = d.toFixed(2);
    onChangeD(d);
  });

  // 'change' fires on Enter or blur — lets the
  // user type freely without the field being
  // overwritten on every keystroke.
  num.addEventListener('change', () => {
    const d = parseFloat(num.value);
    if (isNaN(d) || d <= 0) return;
    const dStar = 1.0 / d;
    const lo = parseFloat(slider.min);
    const hi = parseFloat(slider.max);
    const clamped =
      Math.max(lo, Math.min(hi, dStar));
    slider.value = clamped;
    num.value    = (1.0 / clamped).toFixed(2);
    onChangeD(1.0 / clamped);
  });
}

/**
 * Wire a range slider and number input
 * so they stay in sync and call onChange.
 */
function _syncSlider(sliderId, numId, onChange) {
  const slider =
    document.getElementById(sliderId);
  const num =
    document.getElementById(numId);
  if (!slider || !num) return;

  slider.addEventListener('input', () => {
    num.value = slider.value;
    onChange(parseFloat(slider.value));
  });

  num.addEventListener('input', () => {
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max)
      || Infinity;
    const raw = parseFloat(num.value);
    if (isNaN(raw)) return;
    const val = Math.max(min,
      Math.min(max, raw));
    slider.value = val;
    num.value    = val;
    onChange(val);
  });
}

function _wireRadioGroup(name, onChange) {
  document
    .querySelectorAll(
      `input[name="${name}"]`)
    .forEach(r => {
      r.addEventListener('change', e => {
        if (e.target.checked) {
          onChange(e.target.value);
        }
      });
    });
}

function _wireOverlayToggle(
  toggleId, overlayKey
) {
  const el =
    document.getElementById(toggleId);
  if (!el) return;
  el.addEventListener('click', () => {
    setOverlay(overlayKey,
      el.classList.contains('on'));
  });
}

function _getPoints() {
  return getPointsObject();
}

// ── Crystal frame ─────────────────────────

function _applyCrystalFrame(on) {
  store.frozenExpts.clear();

  for (const ds of store.datasets) {
    const nExp =
      ds.exptParser.numExperiments();
    for (let li = 0; li < nExp; li++) {
      const globalExpId = ds.expOffset + li;
      const key = `${ds.id}:${globalExpId}`;
      const inv =
        store.invertedExpts.has(key);

      if (on && !hasCrystal(ds, li)) {
        // Freeze no-crystal experiments
        store.frozenExpts.add(key);
      } else {
        recomputeExpPoints(
          ds, li, inv, on);
        // Apply same crystal.U to all overlay
        // vectors (beam, rot axis, cell arrows)
        // so they land in the same frame as spots.
        transformExpOverlayVectors(
          ds, li, on);
      }
    }
  }

  const pts = buildPointCloud();
  setPointsObject(pts);
  recolour();
  applyFilters();
  buildExpList();
  // Emit overlays-changed so _refreshAll()
  // in overlays.js redraws arrows from the
  // now-transformed expData vectors.
  setOverlay('crystalFrame', on);
}
