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
import { expColor }
  from '../filters/colors.js';

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

  meta.px_count =
    reflParser.containsColumn('n_signal')
      ? reflParser.getInt32Array('n_signal')
      : null;

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
      ? new THREE.Color(expColor(exptID))
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

// ── Per-experiment recompute ──────────────

/**
 * Linearly interpolate a scan-varying U matrix
 * at scan angle phi (radians).
 *
 * atsps: array of N 9-element row-major arrays
 *        (DIALS JSON: A_at_scan_points format)
 * Uses the same U_js = B⁻¹ · A(φ)ᵀ formula
 * as getCrystal() for consistency.
 */
function _interpolateU(atsps, N, Binv, phi, scan) {
  const phiStart   = scan.oscillation.x;
  const dphi       = scan.oscillation.y;
  const nImages    =
    scan.imageRange.y - scan.imageRange.x + 1;
  const totalRange = dphi * nImages;

  const t = totalRange > 0
    ? (phi - phiStart) / totalRange * (N - 1)
    : 0;
  const i0   = Math.max(0,
    Math.min(N - 2, Math.floor(t)));
  const frac = Math.max(0,
    Math.min(1, t - i0));

  // atsps is a list of N 9-element arrays
  const a0 = atsps[i0];
  const a1 = atsps[i0 + 1];
  const A  = new Array(9);
  for (let j = 0; j < 9; j++)
    A[j] = a0[j] * (1 - frac)
         + a1[j] * frac;

  // A stored row-major (Python) → U_js = Binv · Aᵀ
  const Amat = new THREE.Matrix3(
    A[0], A[1], A[2],
    A[3], A[4], A[5],
    A[6], A[7], A[8]
  ).transpose();

  const U = new THREE.Matrix3();
  U.multiplyMatrices(Binv, Amat);
  return U;
}

/**
 * Recompute RLP positions for all spots
 * belonging to localExpId (0-based within
 * this dataset) and update rawData in place.
 * Pass invertAxis=true to negate the
 * goniometer rotation axis.
 *
 * When crystalFrame=true and the crystal has
 * A_at_scan_points, a per-spot U(φ) is
 * interpolated; otherwise the static crystal.U
 * is used for all spots.
 */
export function recomputeExpPoints(
  ds, localExpId, invertAxis,
  crystalFrame = false
) {
  const { exptParser, reflParser,
          rawData } = ds;

  const panels =
    reflParser.getPanelNumbers();
  const n = panels ? panels.length : 0;
  if (n === 0) return;

  const exptIDs =
    reflParser.containsExperimentIDs()
      ? reflParser.getExperimentIDs()
      : null;
  const imagesetIDs =
    reflParser.getImagesetIDs() ?? exptIDs;
  const xyzObs =
    reflParser.containsXYZObs()
      ? reflParser.getXYZObs() : null;
  const xyzObsMm =
    reflParser.containsXYZObsMm()
      ? reflParser.getXYZObsMm() : null;
  const xyzCal =
    reflParser.containsXYZCal()
      ? reflParser.getXYZCal() : null;
  const wavelengths =
    reflParser.containsWavelengths()
      ? reflParser.getWavelengths() : null;

  const uniquePanels = new Set(panels);
  const panelDataCache = {};
  for (const pid of uniquePanels) {
    panelDataCache[pid] =
      exptParser.getDetectorPanelDataByIdx(
        0, pid);
  }

  const gonio =
    exptParser.getGoniometer(localExpId);
  const scan =
    exptParser.getScan(localExpId);

  // ── Crystal frame: precompute once ───────
  // For scan-varying models (A_at_scan_points
  // present), store B⁻¹ and the point array so
  // each spot can get its own U(φ).
  // For static models, _staticU is used for all.
  let _staticU = null;
  let _Binv    = null;
  let _atsps   = null;
  let _Nsp     = 0;

  if (crystalFrame) {
    const crystal =
      exptParser.getCrystal(localExpId);
    if (crystal) {
      _staticU = crystal.U;
      // A_at_scan_points: array of N 9-element
      // row-major arrays (one per scan point)
      const ats =
        exptParser.getCrystalData(localExpId)
          ?.A_at_scan_points;
      if (Array.isArray(ats)
          && ats.length >= 2
          && Array.isArray(ats[0])) {
        _Nsp   = ats.length;
        _atsps = ats;
        _Binv  = crystal.B.clone().invert();
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const exptID = exptIDs ? exptIDs[i] : 0;
    if (exptID !== localExpId) continue;

    const imagesetID =
      imagesetIDs ? imagesetIDs[i] : 0;
    const panelIdx = parseInt(panels[i]);
    const panelData = panelDataCache[panelIdx];
    if (!panelData) continue;

    const xyz = xyzObs
      ? xyzObs[i]
      : (xyzCal ? xyzCal[i] : null);
    if (!xyz) continue;

    let wavelength =
      exptParser.getBeamData(
        imagesetID)['wavelength'];
    if (wavelengths && wavelengths[i]) {
      wavelength = wavelengths[i];
    }
    if (!wavelength) continue;

    const unitS0 =
      exptParser.getBeamDirection(imagesetID)
        .clone().multiplyScalar(-1).normalize();

    const s1 = getS1(
      xyz, panelData.dMatrix, wavelength,
      [panelData.pxSize.x, panelData.pxSize.y]);

    const rlp = s1.clone()
      .normalize()
      .sub(unitS0.clone().normalize())
      .multiplyScalar(1.0 / wavelength);

    let spotAngle = 0;
    if (gonio && scan && xyzObsMm) {
      const angle  = xyzObsMm[i][2];
      spotAngle = angle;
      const sr = gonio.settingRotation;
      const fr = gonio.fixedRotation;
      const ra = gonio.rotationAxis.clone();
      if (invertAxis) ra.multiplyScalar(-1);
      rlp.applyMatrix3(sr.clone().invert());
      rlp.applyAxisAngle(ra, -angle);
      rlp.applyMatrix3(
        fr.clone().invert().transpose());
    }

    // Crystal frame: use scan-varying U(φ)
    // when A_at_scan_points is available,
    // otherwise fall back to static U.
    if (_staticU) {
      const U = (_Binv && _Nsp >= 2 && scan)
        ? _interpolateU(
            _atsps, _Nsp, _Binv,
            spotAngle, scan)
        : _staticU;
      rlp.applyMatrix3(U);
    }

    rlp.multiplyScalar(SCALE);

    rawData.points[i] = [rlp.x, rlp.y, rlp.z];

    const dstar = rlp.length() / SCALE;
    rawData.data.d_spacing[i] =
      dstar > 1e-6 ? 1.0 / dstar : 0;
  }
}

/**
 * True if experiment localExpId (0-based
 * within dataset) has a crystal model.
 */
export function hasCrystal(ds, localExpId) {
  return !!ds.exptParser.getCrystal(localExpId);
}

/**
 * Return the B-matrix reciprocal-cell vectors
 * (a*, b*, c* in crystal reference frame)
 * scaled to scene units, or null if no crystal.
 */
export function crystalFrameVectors(
  ds, localExpId
) {
  const crystal =
    ds.exptParser.getCrystal(localExpId);
  if (!crystal) return null;
  const e = crystal.B.elements;
  return [
    [e[0]*SCALE, e[1]*SCALE, e[2]*SCALE],
    [e[3]*SCALE, e[4]*SCALE, e[5]*SCALE],
    [e[6]*SCALE, e[7]*SCALE, e[8]*SCALE],
  ];
}

/**
 * Transform (or restore) all overlay vectors
 * stored in rawData.experiments[localExpId]:
 *   beam_vector, rotation_axis, recip_latt_vectors.
 *
 * on=true  → apply the same crystal.U that is
 *            applied to spots, so all vectors
 *            end up in the same crystal frame.
 * on=false → restore lab-frame values from
 *            the parsers.
 */
export function transformExpOverlayVectors(
  ds, localExpId, on
) {
  const expData =
    ds.rawData.experiments?.[localExpId];
  if (!expData) return;

  if (on) {
    const crystal =
      ds.exptParser.getCrystal(localExpId);
    if (!crystal) return;

    if (expData.beam_vector) {
      const v = new THREE.Vector3(
        ...expData.beam_vector)
        .applyMatrix3(crystal.U);
      expData.beam_vector = [v.x, v.y, v.z];
    }
    if (expData.rotation_axis) {
      const v = new THREE.Vector3(
        ...expData.rotation_axis)
        .applyMatrix3(crystal.U);
      expData.rotation_axis = [v.x, v.y, v.z];
    }
    if (expData.recip_latt_vectors) {
      expData.recip_latt_vectors =
        expData.recip_latt_vectors.map(rv => {
          const v = new THREE.Vector3(...rv)
            .applyMatrix3(crystal.U);
          return [v.x, v.y, v.z];
        });
    }
  } else {
    // Restore from parsers
    const bd =
      ds.exptParser.getBeamDirection(localExpId);
    if (bd)
      expData.beam_vector = [bd.x, bd.y, bd.z];

    const gonio =
      ds.exptParser.getGoniometer(localExpId);
    if (gonio?.rotationAxis) {
      const ra = gonio.rotationAxis;
      expData.rotation_axis = [ra.x, ra.y, ra.z];
    }

    const crystal =
      ds.exptParser.getCrystal(localExpId);
    if (crystal) {
      expData.recip_latt_vectors =
        crystal.reciprocalCell.map(
          v => [v.x * SCALE,
                v.y * SCALE,
                v.z * SCALE]);
    }
  }
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
        oscillation_delta: oscDeg[1] - oscDeg[0],
        num_images:
          scan.imageRange.y
          - scan.imageRange.x + 1,
      };
    }

    const crystal =
      exptParser.getCrystal(i);
    let recip_latt_vectors = null;
    let cell_norms   = null;
    let cell_angles  = null;
    if (crystal) {
      recip_latt_vectors =
        crystal.reciprocalCell.map(
          v => [v.x * SCALE,
                v.y * SCALE,
                v.z * SCALE]);
      const cd = exptParser.getCrystalData(i);
      if (cd) {
        const ra = cd['real_space_a'];
        const rb = cd['real_space_b'];
        const rc = cd['real_space_c'];
        const norm = v =>
          Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2);
        cell_norms = [norm(ra), norm(rb), norm(rc)];

        const va = new THREE.Vector3(...ra);
        const vb = new THREE.Vector3(...rb);
        const vc = new THREE.Vector3(...rc);
        const toDeg = r => r * 180 / Math.PI;
        cell_angles = [
          toDeg(vb.angleTo(vc)),
          toDeg(va.angleTo(vc)),
          toDeg(va.angleTo(vb)),
        ];
      }
    }

    expts.push({
      id: i,
      wavelength,
      s0_scaled,
      beam_vector: bd
        ? [bd.x, bd.y, bd.z] : null,
      rotation_axis: rot_axis,
      ewald_radius,
      scan: scan_info,
      recip_latt_vectors,
      cell_norms,
      cell_angles,
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
    px_count: meta.px_count
      ? Array.from(meta.px_count)
      : null,
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

