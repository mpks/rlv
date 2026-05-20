/**
 * rlv_io.js
 *
 * Converts parsed DIALS expt + refl data
 * into reciprocal lattice points and
 * colours, ready for the Three.js scene.
 *
 * Usage:
 *   import { buildRLV } from './rlv_io.js';
 *   const rlvData = buildRLV(
 *     exptParser, reflParser);
 */

import * as THREE from 'three';

// ── Experiment colours ────────────────────

const EXP_COLORS = [
  new THREE.Color('#e6194b'),
  new THREE.Color('#3cb44b'),
  new THREE.Color('#4363d8'),
  new THREE.Color('#f58231'),
  new THREE.Color('#911eb4'),
  new THREE.Color('#42d4f4'),
  new THREE.Color('#f032e6'),
  new THREE.Color('#bfef45'),
];

const COLOR_UNINDEXED =
  new THREE.Color('#888888');

export const SCALE = 1000.0;

// ── Main entry point ──────────────────────

/**
 * Build RLV data from parsed expt + refl.
 */
export function buildRLV(
  exptParser, reflParser
) {
  const panels =
    reflParser.getPanelNumbers();
  const n = panels ? panels.length : 0;
  if (n === 0) {
    throw new Error(
      'No reflections found');
  }

  const points = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const groups = new Array(n);

  const exptIDs =
    reflParser.containsExperimentIDs()
      ? reflParser.getExperimentIDs()
      : null;

  let imagesetIDs =
    reflParser.getImagesetIDs();
  if (!imagesetIDs) imagesetIDs = exptIDs;

  const xyzObs =
    reflParser.containsXYZObs()
      ? reflParser.getXYZObs() : null;
  const xyzObsMm =
    reflParser.containsXYZObsMm()
      ? reflParser.getXYZObsMm() : null;
  const xyzCal =
    reflParser.containsXYZCal()
      ? reflParser.getXYZCal() : null;
  const millers =
    reflParser.containsMillerIndices()
      ? reflParser.getMillerIndices()
      : null;
  const flags = reflParser.getFlags();
  const wavelengths =
    reflParser.containsWavelengths()
      ? reflParser.getWavelengths() : null;

  // Precompute panel data per unique panel
  const uniquePanels = new Set(panels);
  const panelDataCache = {};
  for (const pid of uniquePanels) {
    panelDataCache[pid] =
      exptParser.getDetectorPanelDataByIdx(
        0, pid);
  }

  const meta = {
    id:    new Int32Array(n),
    panel: new Uint32Array(n),
    x:     new Float32Array(n),
    y:     new Float32Array(n),
    z:     new Float32Array(n),
    h:     new Int32Array(n),
    k:     new Int32Array(n),
    l:     new Int32Array(n),
    indexed_status:    new Uint8Array(n),
    integrated_status: new Uint8Array(n),
    d_spacing: new Float32Array(n),
    intensity: new Float32Array(n),
    sigma:     new Float32Array(n),
  };

  // Intensities
  const sumI =
    reflParser.containsSummationIntensities()
      ? reflParser.getDoubleArray(
          'intensity.sum.value') : null;
  const sumVar =
    reflParser.containsColumn(
      'intensity.sum.variance')
      ? reflParser.getDoubleArray(
          'intensity.sum.variance') : null;
  const prfI =
    reflParser.containsProfileIntensities()
      ? reflParser.getDoubleArray(
          'intensity.prf.value') : null;
  const prfVar =
    reflParser.containsColumn(
      'intensity.prf.variance')
      ? reflParser.getDoubleArray(
          'intensity.prf.variance') : null;

  for (let i = 0; i < n; i++) {
    const exptID =
      exptIDs ? exptIDs[i] : 0;
    const imagesetID =
      imagesetIDs ? imagesetIDs[i] : 0;
    const panelIdx = parseInt(panels[i]);

    const flag = flags ? flags[i] : 0;
    const indexed =
      reflParser.isIndexed(flag);
    const integrated =
      reflParser.isSummationIntegrated(flag)
      || reflParser.isPrfIntegrated(flag);

    groups[i] = integrated
      ? 'integrated'
      : indexed ? 'indexed' : 'unindexed';

    // Color by experiment
    const col = exptID >= 0
      ? EXP_COLORS[
          exptID % EXP_COLORS.length]
      : COLOR_UNINDEXED;
    colors[i*3]   = col.r;
    colors[i*3+1] = col.g;
    colors[i*3+2] = col.b;

    meta.id[i]    = exptID;
    meta.panel[i] = panelIdx;
    meta.indexed_status[i] =
      indexed ? 1 : 0;
    meta.integrated_status[i] =
      integrated ? 1 : 0;

    // Miller indices
    if (millers && indexed
        && reflParser.isValidMillerIndex(
             millers[i])) {
      meta.h[i] = millers[i][0];
      meta.k[i] = millers[i][1];
      meta.l[i] = millers[i][2];
    }

    // Intensity
    if (sumI) {
      meta.intensity[i] = sumI[i];
      meta.sigma[i] = sumVar
        ? Math.sqrt(Math.max(sumVar[i], 0))
        : 0;
    } else if (prfI) {
      meta.intensity[i] = prfI[i];
      meta.sigma[i] = prfVar
        ? Math.sqrt(Math.max(prfVar[i], 0))
        : 0;
    }

    // Use observed position, fall back
    // to calculated
    const xyz = xyzObs
      ? xyzObs[i]
      : (xyzCal ? xyzCal[i] : null);
    if (!xyz) continue;

    meta.x[i] = xyz[0];
    meta.y[i] = xyz[1];
    meta.z[i] = xyz[2];

    const panelData =
      panelDataCache[panelIdx];
    if (!panelData) continue;

    // Wavelength: per-reflection
    // or from beam
    let wavelength =
      exptParser.getBeamData(
        imagesetID)['wavelength'];
    if (wavelengths && wavelengths[i]) {
      wavelength = wavelengths[i];
    }
    if (!wavelength) continue;

    // s0 unit vector pointing
    // from source to sample (negated
    // beam direction)
    const unitS0 =
      exptParser.getBeamDirection(
        imagesetID)
      .clone()
      .multiplyScalar(-1)
      .normalize();

    // s1: compute from pixel coords
    const pxSize = panelData.pxSize;
    const dMatrix = panelData.dMatrix;

    const s1 = getS1(
      xyz, dMatrix, wavelength,
      [pxSize.x, pxSize.y]);

    // rlp = (s1.normalize - s0) / lambda
    const rlp = s1.clone()
      .normalize()
      .sub(unitS0.clone().normalize())
      .multiplyScalar(1.0 / wavelength);

    // Apply goniometer rotation to get
    // into reciprocal space frame
    // (same as DIALS viewer)
    const scan =
      exptParser.getScan(imagesetID);
    const gonio =
      exptParser.getGoniometer(imagesetID);

    if (gonio && scan && xyzObsMm) {
      // angle is the mm z-coordinate
      const angle = xyzObsMm[i][2];
      const sr = gonio.settingRotation;
      const fr = gonio.fixedRotation;
      const ra = gonio.rotationAxis;
      rlp.applyMatrix3(
        sr.clone().invert());
      rlp.applyAxisAngle(ra, -angle);
      rlp.applyMatrix3(
        fr.clone().invert().transpose());
    }

    rlp.multiplyScalar(SCALE);

    points[i*3]   = rlp.x;
    points[i*3+1] = rlp.y;
    points[i*3+2] = rlp.z;

    // d-spacing
    const dstar =
      rlp.length() / SCALE;
    meta.d_spacing[i] =
      dstar > 1e-6 ? 1.0 / dstar : 0;
  }

  const expts =
    buildExptInfo(exptParser);

  return { points, colors, groups,
           meta, expts };
}

// ── s1 from pixel coords ──────────────────

/**
 * Compute s1 vector from pixel position.
 * Mirrors getS1() in ReciprocalLatticeViewer.
 *
 * point:      [x, y, z] pixel coords
 * dMatrix:    THREE.Matrix3 panel D-matrix
 * wavelength: float
 * scaleFactor:[px_x, px_y]
 */
function getS1(
  point, dMatrix, wavelength, scaleFactor
) {
  const p = new THREE.Vector3(
    point[0] * scaleFactor[0],
    point[1] * scaleFactor[1],
    1.0);
  p.applyMatrix3(dMatrix);
  p.normalize()
   .multiplyScalar(1.0 / wavelength);
  return p;
}

// ── Experiment metadata ───────────────────

function buildExptInfo(exptParser) {
  const expts = [];
  const n = exptParser.numExperiments();

  for (let i = 0; i < n; i++) {
    const beamData =
      exptParser.getBeamData(i);
    const wavelength =
      beamData ? beamData['wavelength']
               : null;

    // s0 scaled to scene units
    const bd =
      exptParser.getBeamDirection(i);
    const s0_scaled = wavelength
      ? [bd.x / wavelength * SCALE,
         bd.y / wavelength * SCALE,
         bd.z / wavelength * SCALE]
      : null;
    const ewald_radius = s0_scaled
      ? Math.sqrt(
          s0_scaled[0]**2
          + s0_scaled[1]**2
          + s0_scaled[2]**2)
      : null;

    const gonio =
      exptParser.getGoniometer(i);
    const rot_axis = gonio
      ? [gonio.rotationAxis.x,
         gonio.rotationAxis.y,
         gonio.rotationAxis.z]
      : null;

    const scan = exptParser.getScan(i);
    let scan_info = null;
    if (scan) {
      const oscDeg = [
        scan.oscillation.x * 180/Math.PI,
        scan.oscillation.y * 180/Math.PI,
      ];
      scan_info = {
        image_range: [
          scan.imageRange.x + 1,
          scan.imageRange.y + 1],
        oscillation_start: oscDeg[0],
        oscillation_delta: oscDeg[1],
        num_images:
          scan.imageRange.y
          - scan.imageRange.x + 1,
      };
    }

    const crystal =
      exptParser.getCrystal(i);
    let recip_latt_vectors = null;
    if (crystal) {
      recip_latt_vectors =
        crystal.reciprocalCell.map(
          v => [v.x * SCALE,
                v.y * SCALE,
                v.z * SCALE]);
    }

    expts.push({
      id: i,
      wavelength,
      s0_scaled,
      beam_vector: rot_axis,
      rotation_axis: rot_axis,
      ewald_radius,
      scan: scan_info,
      recip_latt_vectors,
      detector_corners: null,
    });
  }
  return expts;
}

// ── Convert to viewer JSON format ─────────

/**
 * Convert buildRLV output to the same
 * JSON format used by export_rlv.py.
 */
export function rlvToViewerFormat(rlvData) {
  const { points, colors, groups,
          meta, expts } = rlvData;
  const n = groups.length;

  const pts = [], cols = [];
  for (let i = 0; i < n; i++) {
    pts.push([
      points[i*3],
      points[i*3+1],
      points[i*3+2],
    ]);
    cols.push([
      colors[i*3],
      colors[i*3+1],
      colors[i*3+2],
    ]);
  }

  const data = {
    id:    Array.from(meta.id),
    panel: Array.from(meta.panel),
    x:     Array.from(meta.x),
    y:     Array.from(meta.y),
    z:     Array.from(meta.z),
    h:     Array.from(meta.h),
    k:     Array.from(meta.k),
    l:     Array.from(meta.l),
    d_spacing:  Array.from(meta.d_spacing),
    intensity:  Array.from(meta.intensity),
    sigma:      Array.from(meta.sigma),
    indexed_status:
      Array.from(meta.indexed_status)
        .map(v => v === 1),
    integrated_status:
      Array.from(meta.integrated_status)
        .map(v => v === 1),
    outlier_status:
      new Array(n).fill(false),
    unindexed_status:
      Array.from(meta.indexed_status)
        .map(v => v === 0),
  };

  return {
    title:        '',
    scale_factor: SCALE,
    points:       pts,
    colors:       cols,
    groups,
    data,
    experiments:  expts,
  };
}

