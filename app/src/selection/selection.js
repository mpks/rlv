/**
 * selection/selection.js
 *
 * Manages spot selection.
 * Provides click-to-select, box select,
 * select-by-range, and select-by-exp.
 *
 * Selection state lives in store.selectionSet
 * (Set of global spot indices).
 */

import * as THREE from 'three';
import { store, onChange }
  from '../state/store.js';
import {
  scene, camera, renderer,
  getPointsObject,
} from '../scene/renderer.js';
import {
  applySelection,
} from '../scene/points.js';
import {
  reapplyHighlight,
} from '../scene/resolutionSpheres.js';
import { setStatus }
  from '../ui/statusbar.js';

const _raycaster =
  new THREE.Raycaster();
_raycaster.params.Points.threshold = 15;

const _mouse = new THREE.Vector2();
let   _enabled = true;

// ── Init ──────────────────────────────────

export function initSelection() {
  renderer.domElement.addEventListener(
    'click', _onClick);
  renderer.domElement.addEventListener(
    'mousemove', _onMouseMove);

  // React to selection changes
  onChange('selection-changed', () => {
    _updateHighlight();
    _updateStatus();
  });
}

export function enableSelection() {
  _enabled = true;
}
export function disableSelection() {
  _enabled = false;
}

// ── Click to select ───────────────────────

function _onMouseMove(e) {
  const rect =
    renderer.domElement.getBoundingClientRect();
  _mouse.x =
    ((e.clientX - rect.left)
     / rect.width) * 2 - 1;
  _mouse.y =
    -((e.clientY - rect.top)
     / rect.height) * 2 + 1;
}

function _onClick(e) {
  if (!_enabled) return;
  const obj = getPointsObject();
  if (!obj) return;

  _raycaster.setFromCamera(
    _mouse, camera);
  const hits =
    _raycaster.intersectObject(obj);

  if (hits.length === 0) {
    // Click on empty space → clear
    if (!e.shiftKey
        && !e.ctrlKey
        && !e.metaKey) {
      clearSelection();
    }
    return;
  }

  const idx = hits[0].index;

  if (e.shiftKey
      || e.ctrlKey
      || e.metaKey) {
    // Add / remove from selection
    if (store.selectionSet.has(idx)) {
      store.selectionSet.delete(idx);
    } else {
      store.selectionSet.add(idx);
    }
  } else {
    // Replace selection
    store.selectionSet.clear();
    store.selectionSet.add(idx);
  }

  // Emit manually (store helpers emit,
  // but we mutated directly here)
  _updateHighlight();
  _updateStatus();
}

// ── Programmatic selection ────────────────

export function clearSelection() {
  store.selectionSet.clear();
  _updateHighlight();
  _updateStatus();
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
  _updateHighlight();
  _updateStatus();
}

/**
 * Select all spots in a given image
 * frame range [zMin, zMax].
 */
export function selectByImageRange(
  zMin, zMax
) {
  store.selectionSet.clear();
  let g = 0;
  for (const ds of store.datasets) {
    const z = ds.rawData.data.z;
    for (let i = 0;
         i < ds.rawData.points.length;
         i++) {
      if (z[i] >= zMin
          && z[i] <= zMax
          && store.visibleSet?.[g]) {
        store.selectionSet.add(g);
      }
      g++;
    }
  }
  _updateHighlight();
  _updateStatus();
}

/**
 * Select all spots belonging to one
 * experiment in one dataset.
 */
export function selectByExperiment(
  datasetId, expId
) {
  let g = 0;
  for (const ds of store.datasets) {
    const ids = ds.rawData.data.id;
    for (let i = 0;
         i < ds.rawData.points.length;
         i++) {
      if (ds.id === datasetId
          && ids[i] === expId
          && store.visibleSet?.[g]) {
        store.selectionSet.add(g);
      }
      g++;
    }
  }
  _updateHighlight();
  _updateStatus();
}

/**
 * Invert selection within visible spots.
 */
export function invertSelection() {
  if (!store.visibleSet) return;
  for (let i = 0;
       i < store.visibleSet.length;
       i++) {
    if (!store.visibleSet[i]) continue;
    if (store.selectionSet.has(i)) {
      store.selectionSet.delete(i);
    } else {
      store.selectionSet.add(i);
    }
  }
  _updateHighlight();
  _updateStatus();
}

// ── Highlight update ──────────────────────

function _updateHighlight() {
  applySelection(
    getPointsObject(),
    store.selectionSet);
  reapplyHighlight();
}

function _updateStatus() {
  const n = store.selectionSet.size;
  setStatus(
    n > 0
      ? `${n.toLocaleString()} selected`
      : 'Ready');
}
