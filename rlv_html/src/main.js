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
} from './state/store.js';

import {
  initRenderer,
  startRenderLoop,
  setPointsObject,
  fitCamera,
} from './scene/renderer.js';
import { buildPointCloud }
  from './scene/points.js';

import { applyFilters }
  from './filters/filters.js';
import { recolour }
  from './filters/colors.js';

import { initSelection }
  from './selection/selection.js';

import { initTooltip }
  from './labels/tooltip.js';

import { initToolbar }
  from './ui/toolbar.js';
import {
  initCollapsibleSections,
  initToggles,
  initFilterPanel,
  buildExpList,
  updateResolutionRange,
  setInfoLine,
} from './ui/sidebar.js';
import { initDialog }
  from './ui/dialog.js';
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
    applyFilters();
    buildExpList();
    setInfoLine(
      `${store.datasets.length} dataset(s)`
      + ` · ${rawData.points.length
               .toLocaleString()} spots`);

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
initToolbar();
initCollapsibleSections();
initToggles();
initFilterPanel();
initDialog(loadFiles);
initSelection();
initTooltip();
