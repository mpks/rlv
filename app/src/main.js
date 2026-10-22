/**
 * main.js
 */

import './style.css';

import { ExptParser }
  from './io/ExptParser.js';
import { ReflParser }
  from './io/ReflParser.js';
import { buildRLV, rlvToViewerFormat }
  from './io/rlv_io.js';

import {
  store,
  addDataset,
  clearDatasets,
  onChange,
  totalSpots,
} from './state/store.js';

import {
  initRenderer,
  startRenderLoop,
  setPointsObject,
  fitCamera,
} from './scene/renderer.js';
import { buildPointCloud }
  from './scene/points.js';
import { initOverlays }
  from './scene/overlays.js';

import { applyFilters }
  from './filters/filters.js';
import { recolour }
  from './filters/colors.js';

import { initSelection }
  from './selection/selection.js';

import { initTooltip, showPickRadius }
  from './labels/tooltip.js';
import { initHKLLabels, rebuildHKLLabels }
  from './labels/hklLabels.js';

import { initToolbar }
  from './ui/toolbar.js';
import {
  initCollapsibleSections,
  initToggles,
  initFilterPanel,
  initToolsPanel,
  buildExpList,
  updateResolutionRange,
  updateZRange,
  updatePxRange,
  updateHKLRange,
  updateInspectionRange,
  setInfoLine,
} from './ui/sidebar.js';
import { initDialog }
  from './ui/dialog.js';
import { initDropZone }
  from './ui/dropzone.js';
import { loadFromQuery }
  from './io/urlLoad.js';
import { initDesktop }
  from './platform/desktop.js';
import {
  showLoading,
  hideLoading,
  showError,
} from './ui/statusbar.js';

// ── Load files ────────────────────────────

async function loadFiles(
  exptFile, reflFile, mode
) {
  showLoading('Parsing files…');
  try {
    if (mode === 'replace') {
      clearDatasets();
    }

    const exptParser = new ExptParser();
    const reflParser = new ReflParser();

    await exptParser
      .parseExperiment(exptFile);
    await reflParser
      .parseReflectionTableFromMsgpackFile(
        reflFile);

    showLoading('Computing RLPs…');
    const rlvData =
      buildRLV(exptParser, reflParser);
    const rawData =
      rlvToViewerFormat(rlvData);

    addDataset(
      exptFile.name,
      exptParser,
      reflParser,
      rawData);

    const pts = buildPointCloud();
    setPointsObject(pts);
    recolour();
    if (mode === 'replace') fitCamera();

    updateResolutionRange();
    updateZRange();
    updatePxRange();
    updateHKLRange();
    rebuildHKLLabels();
    updateInspectionRange(
      store.datasets.reduce((lo, ds) => {
        for (const d of ds.rawData.data.d_spacing)
          if (d > 0 && d < lo) lo = d;
        return lo;
      }, Infinity));
    applyFilters();
    buildExpList();
    setInfoLine(
      `${store.datasets.length} dataset(s)`
      + ` · ${totalSpots().toLocaleString()} spots`);

    hideLoading();
  } catch(e) {
    showError(e.message || String(e));
    console.error(e);
  }
}

// ── React to store events ─────────────────

onChange('colors-changed', () => {
  recolour();
});

// ── Boot ──────────────────────────────────

initRenderer();
startRenderLoop();
initOverlays();
initToolbar();
initCollapsibleSections();
initToggles();
initFilterPanel();
initToolsPanel();
initDialog(loadFiles);
initDropZone(loadFiles);
initDesktop();          // desktop app only; no-op in a browser
initSelection();
initTooltip();
initHKLLabels();

// Load files named in the address (?expt=…&refl=…), if any.
loadFromQuery(loadFiles);
