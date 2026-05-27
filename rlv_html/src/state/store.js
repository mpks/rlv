/**
 * state/store.js
 *
 * Single source of truth for the
 * entire application.  All modules
 * import from here; nothing is passed
 * as deep prop chains.
 *
 * Mutation convention:
 *   - Import `store` and write directly:
 *       store.currentImage = 5;
 *   - For array/set mutations call the
 *     helper functions below so that
 *     listeners can react.
 */

export const store = {

  // ── Loaded datasets ─────────────────
  // Each entry:
  // {
  //   id:         number (auto-increment),
  //   label:      string (filename),
  //   exptParser: ExptParser,
  //   reflParser: ReflParser,
  //   rawData:    rlvToViewerFormat(),
  //   visible:    bool,
  // }
  datasets: [],
  _nextDatasetId: 0,
  _nextColorIndex: 0,

  // ── Per-experiment colour overrides ─
  // key: `${datasetId}:${expId}`
  // value: '#rrggbb'
  expColorOverrides: {},

  // ── Per-experiment inverted rot axis ─
  // key: `${datasetId}:${expId}`
  invertedExpts: new Set(),

  // ── Per-experiment user labels ───────
  // key: `${datasetId}:${expId}`
  // value: string
  expLabels: {},

  // ── Filter state ─────────────────────
  filters: {
    dMin:           0,
    dMax:           Infinity,
    zMin:           0,
    zMax:           Infinity,
    pxMin:          0,
    pxMax:          Infinity,
    partMin:        0,
    partMax:        1.0,
    // 'all' | 'indexed' | 'unindexed' | 'integrated'
    showMode:       'all',
    showInliers:    true,
    showOutliers:   true,
    // Set of 'datasetId:expId' strings
    // that are currently visible
    visibleExpts:   new Set(),
    colorMode:      'experiment',
  },

  // ── Derived (written by filters.js) ─
  // Uint8Array, length = total spots,
  // 1 = visible, 0 = hidden
  visibleSet: null,

  // ── Selection ────────────────────────
  // Set of global spot indices
  selectionSet: new Set(),

  // ── Active experiment (for overlays) ─
  // { datasetId, expId } or null
  activeExp: null,

  // ── Overlays visibility ───────────────
  overlays: {
    detector:  false,
    ewald:     false,
    unitcell:  true,
    beam:      true,
    rotAxis:   true,
    scanAnim:  false,
    expInfo:   true,
  },

  // ── Scan / Ewald animation ────────────
  currentImage: 0,

  // ── Listeners ────────────────────────
  // Internal — use onChange() to register
  _listeners: [],
};

// ── Dataset helpers ───────────────────────

/**
 * Add a new dataset to the store.
 * Returns the assigned id.
 */
export function addDataset(
  label, exptParser, reflParser, rawData
) {
  // Compute global experiment offset so
  // IDs are unique across all datasets.
  let expOffset = 0;
  for (const ds of store.datasets) {
    expOffset += ds.exptParser.numExperiments();
  }

  // Renumber this dataset's exp IDs in place.
  for (let i = 0; i < rawData.data.id.length; i++) {
    if (rawData.data.id[i] >= 0) {
      rawData.data.id[i] += expOffset;
    }
  }

  const id = store._nextDatasetId++;
  const colorOffset = store._nextColorIndex;
  const n = exptParser.numExperiments();
  store._nextColorIndex += n;

  store.datasets.push({
    id, label,
    exptParser, reflParser,
    rawData, visible: true,
    expOffset, colorOffset,
  });

  // Mark all experiments as visible,
  // using globally-offset IDs.
  for (let i = 0; i < n; i++) {
    store.filters.visibleExpts.add(
      `${id}:${expOffset + i}`);
  }

  emit('datasets-changed');
  return id;
}

/**
 * Remove a dataset by id.
 */
export function removeDataset(id) {
  store.datasets =
    store.datasets.filter(d => d.id !== id);

  // Clean up colour overrides and labels
  for (const obj of [
    store.expColorOverrides,
    store.expLabels,
  ]) {
    Object.keys(obj)
      .filter(k => k.startsWith(`${id}:`))
      .forEach(k => delete obj[k]);
  }

  // Clean up visible expts and inverted expts
  for (const set of [
    store.filters.visibleExpts,
    store.invertedExpts,
  ]) {
    for (const key of set) {
      if (key.startsWith(`${id}:`))
        set.delete(key);
    }
  }

  emit('datasets-changed');
}

/**
 * Clear all datasets.
 */
export function clearDatasets() {
  store.datasets = [];
  store._nextDatasetId = 0;
  store._nextColorIndex = 0;
  store.expColorOverrides = {};
  store.filters.visibleExpts.clear();
  store.invertedExpts.clear();
  store.visibleSet = null;
  store.selectionSet.clear();
  store.activeExp = null;
  emit('datasets-changed');
}

export function setActiveExp(datasetId, expId) {
  store.activeExp = { datasetId, expId };
  emit('active-exp-changed',
    { datasetId, expId });
}

export function setOverlay(key, value) {
  store.overlays[key] = value;
  emit('overlays-changed', { key, value });
}

/**
 * Get total spot count across all
 * datasets.
 */
export function totalSpots() {
  return store.datasets.reduce(
    (sum, d) =>
      sum + d.rawData.points.length,
    0);
}

// ── Selection helpers ─────────────────────

export function selectSpot(idx) {
  store.selectionSet.add(idx);
  emit('selection-changed');
}

export function deselectSpot(idx) {
  store.selectionSet.delete(idx);
  emit('selection-changed');
}

export function clearSelection() {
  store.selectionSet.clear();
  emit('selection-changed');
}

export function selectAll() {
  if (!store.visibleSet) return;
  for (let i = 0;
       i < store.visibleSet.length;
       i++) {
    if (store.visibleSet[i]) {
      store.selectionSet.add(i);
    }
  }
  emit('selection-changed');
}

// ── Colour override helpers ───────────────

export function setExpColor(
  datasetId, expId, hex
) {
  const key = `${datasetId}:${expId}`;
  store.expColorOverrides[key] = hex;
  emit('colors-changed', { datasetId, expId, hex });
}

export function getExpColor(
  datasetId, expId, fallback
) {
  const key = `${datasetId}:${expId}`;
  return store.expColorOverrides[key]
    ?? fallback;
}

// ── Event bus ─────────────────────────────

/**
 * Register a listener for store events.
 * event: string (or '*' for all)
 * cb: function(data)
 */
export function onChange(event, cb) {
  store._listeners.push({ event, cb });
}

function emit(event, data) {
  for (const l of store._listeners) {
    if (l.event === event
        || l.event === '*') {
      l.cb(data);
    }
  }
}
