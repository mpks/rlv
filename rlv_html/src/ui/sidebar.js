/**
 * ui/sidebar.js
 *
 * Sidebar UI:
 *   - Collapsible sections
 *   - Toggle switches
 *   - Experiment list with colour swatches
 *   - Filter slider/number pairs
 */

import { store, setExpColor, setActiveExp, setOverlay, removeDataset, totalSpots, onChange }
  from '../state/store.js';
import { showColorPicker }
  from './colorPicker.js';
import { setTooltipEnabled }
  from '../labels/tooltip.js';
import { expColor }
  from '../filters/colors.js';
import {
  setDMin, setDMax,
  setZMin, setZMax,
  setPxMin, setPxMax,
  setPartMin, setPartMax,
  setShowMode,
  setShowInliers, setShowOutliers,
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
import { recomputeExpPoints }
  from '../io/rlv_io.js';

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
  _syncDStarSlider(
    'filt-dmin', 'd-min-num', setDMin);
  _syncDStarSlider(
    'filt-dmax', 'd-max-num', setDMax);
  _syncSlider(
    'filt-zmin', 'z-min-num', setZMin);
  _syncSlider(
    'filt-zmax', 'z-max-num', setZMax);
  _syncPxSlider(
    'filt-px-min', 'px-min-num', setPxMin);
  _syncPxSlider(
    'filt-px-max', 'px-max-num', setPxMax);
  _syncSlider(
    'filt-part-min',
    'part-min-num', setPartMin);
  _syncSlider(
    'filt-part-max',
    'part-max-num', setPartMax);

  // Show group radio buttons
  _wireRadioGroup('show-group', setShowMode);

  // Outlier radio buttons
  _wireRadioGroup(
    'show-outliers', v => {
      setShowInliers(
        v === 'all' || v === 'inliers');
      setShowOutliers(
        v === 'all' || v === 'outliers');
    });

  // Overlay toggles
  _wireOverlayToggle(
    'tog-axis',   'rotAxis');
  _wireOverlayToggle(
    'tog-cell',   'unitcell');
  _wireOverlayToggle(
    'tog-beam',   'beam');
  _wireOverlayToggle(
    'tog-crystal-frame', 'crystalFrame');
  _wireOverlayToggle(
    'tog-exp-info', 'expInfo');

  // Spot tooltips toggle
  const togTT =
    document.getElementById('tog-tooltips');
  if (togTT) {
    togTT.addEventListener('click', () => {
      setTooltipEnabled(
        togTT.classList.contains('on'));
    });
  }

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

      row.innerHTML = `
        <button class="exp-remove"
          title="Remove dataset">×</button>
        <input type="radio"
          class="exp-radio"
          name="active-exp"
          ${checked ? 'checked' : ''}>
        <div class="exp-color-circle"
          style="background:${color}">
        </div>
        <span class="exp-label"
          title="${makeTooltip(savedLabel)
            .replace(/"/g, '&quot;')}">
          exp ${ds.id}:${expId - expOffset}
        </span>
        <input type="text"
          class="exp-user-label"
          placeholder="label…"
          value="${savedLabel
            .replace(/"/g, '&quot;')}">
        <span class="exp-count">
          ${count.toLocaleString()}
        </span>
        <div class="toggle on"
          data-dsid="${ds.id}"
          data-expid="${expId}">
        </div>`;
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
        showColorPicker(
          circleEl, currentHex,
          hex => {
            setExpColor(ds.id, expId, hex);
            circleEl.style.background = hex;
            recolour();
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

  _setSliderRange(
    'filt-zmin', 'z-min-num',
    zLo, zHi, 1, zLo);
  _setSliderRange(
    'filt-zmax', 'z-max-num',
    zLo, zHi, 1, zHi);

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
  _setPxSliderRange(
    'filt-px-min', 'px-min-num', 0);
  _setPxSliderRange(
    'filt-px-max', 'px-max-num', last);

  store.filters.pxMin = _pxPercentiles[0];
  store.filters.pxMax = _pxPercentiles[last];
}

// Set slider to index, number to actual value.
function _setPxSliderRange(
  sliderId, numId, defaultIdx
) {
  const slider =
    document.getElementById(sliderId);
  const num =
    document.getElementById(numId);
  if (!slider || !num) return;
  const last = _pxPercentiles.length - 1;
  slider.min   = 0;
  slider.max   = last;
  slider.step  = 1;
  slider.value = defaultIdx;
  num.min      = _pxPercentiles[0];
  num.max      = _pxPercentiles[last];
  num.value    = _pxPercentiles[defaultIdx];
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
  const dStarLo = 1.0 / dHi; // low-res end
  const dStarHi = 1.0 / dLo; // high-res end
  const step = parseFloat(
    ((dStarHi - dStarLo) / 50)
      .toPrecision(2));

  // dMin slider defaults to dStarHi
  // (rightmost = dLo Å = all high-res shown).
  // dMax slider defaults to dStarLo
  // (leftmost  = dHi Å = all low-res shown).
  _setDStarSliderRange(
    'filt-dmin', 'd-min-num',
    dStarLo, dStarHi, step, dStarHi);
  _setDStarSliderRange(
    'filt-dmax', 'd-max-num',
    dStarLo, dStarHi, step, dStarLo);

  store.filters.dMin = dLo;
  store.filters.dMax = dHi;
}

// ── Helpers ───────────────────────────────

// Set slider + number input range and value.
function _setSliderRange(
  sliderId, numId,
  min, max, step, defaultVal
) {
  const slider =
    document.getElementById(sliderId);
  const num =
    document.getElementById(numId);
  if (!slider || !num) return;
  slider.min   = min;
  slider.max   = max;
  slider.step  = step;
  slider.value = defaultVal;
  num.min      = min;
  num.max      = max;
  num.value    = defaultVal;
}

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

// Slider index (0–_PX_STEPS) → percentile
// lookup.  Number input shows / accepts the
// actual pixel count; slider snaps to the
// nearest percentile index.
function _syncPxSlider(
  sliderId, numId, onChangePx
) {
  const slider =
    document.getElementById(sliderId);
  const num =
    document.getElementById(numId);
  if (!slider || !num) return;

  slider.addEventListener('input', () => {
    if (!_pxPercentiles) return;
    const idx = parseInt(slider.value);
    const val = _pxPercentiles[idx];
    num.value = val;
    onChangePx(val);
  });

  num.addEventListener('input', () => {
    const raw = parseFloat(num.value);
    if (isNaN(raw)) return;
    if (_pxPercentiles) {
      // Snap slider to nearest percentile index
      let best = 0;
      let bestDist =
        Math.abs(_pxPercentiles[0] - raw);
      for (let i = 1;
           i < _pxPercentiles.length; i++) {
        const dist =
          Math.abs(_pxPercentiles[i] - raw);
        if (dist < bestDist) {
          bestDist = dist; best = i;
        }
      }
      slider.value = best;
    }
    // Pass the typed value directly — not the
    // snapped one — for precise manual entry.
    onChangePx(raw);
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
