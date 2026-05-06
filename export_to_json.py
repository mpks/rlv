# LIBTBX_PRE_DISPATCHER_INCLUDE_SH export PHENIX_GUI_ENVIRONMENT=1
# DIALS_ENABLE_COMMAND_LINE_COMPLETION
# LIBTBX_SET_DISPATCHER_NAME dials.export_rlv
"""
Export DIALS experiment + reflection data to
.rlv.json (or .rlv.json.gz) for the RLV viewer.

Usage::

    dials.export_rlv indexed.expt indexed.refl
    dials.export_rlv indexed.expt indexed.refl \\
        output=mydata.rlv.json
    dials.export_rlv integrated.expt integrated.refl \\
        output=mydata.rlv.json.gz
"""
from __future__ import annotations

import gzip
import json
import math
import sys
from itertools import tee
from pathlib import Path

import libtbx.phil
from scitbx.array_family import flex

import dials.util.log
from dials.util.napari_rlv import Render3d
from dials.util.options import (
    ArgumentParser,
    reflections_and_experiments_from_files,
)
from dials.util.reciprocal_lattice import (
    phil_scope as rlv_phil_scope,
)

# ── Phil scope ────────────────────────────────────────

phil_scope = libtbx.phil.parse(
    """
include scope dials.util.reciprocal_lattice.phil_scope

show_rotation_axis   = False
  .type = bool
show_beam_vector     = False
  .type = bool
show_reciprocal_cell = True
  .type = bool
marker_size = 6
  .type = int(value_min=1)

output = reciprocal_lattice.rlv.json
  .type = str
  .help = "Output file (.rlv.json or .rlv.json.gz)"
""",
    process_includes=True,
)

help_message = """
Export DIALS data to .rlv.json for the RLV viewer.

Examples::

  dials.export_rlv imported.expt strong.refl
  dials.export_rlv indexed.expt indexed.refl
  dials.export_rlv integrated.expt integrated.refl
  dials.export_rlv indexed.expt indexed.refl \\
      output=mydata.rlv.json.gz
"""


# ── Minimal napari-free Render3d window ───────────────

class _Window:
    """Stores data instead of creating napari layers."""

    def __init__(self, settings):
        self.settings = settings
        self.points = flex.vec3_double()
        self.colors = None
        self.rotation_axis = None
        self.beam_vector = None
        self.recip_latt_vectors = None
        self.recip_crystal_vectors = None
        self.minimum_covering_sphere = None
        self.points_data = {}

    def set_points(self, points):
        self.points = points

    def set_points_data(self, reflections):
        from dxtbx import flumpy
        import numpy as np

        dstar = reflections["rlp"].norms()
        dstar.set_selected(dstar == 0, 1e-8)
        d_spacing = (
            1.0 / np.asarray(
                flumpy.to_numpy(dstar))
        ).tolist()

        flags = reflections.flags
        self.points_data = {
            "panel": flumpy.to_numpy(
                reflections["panel"]).tolist(),
            "id": flumpy.to_numpy(
                reflections["id"]).tolist(),
            "d_spacing": d_spacing,
            "outlier_status": flumpy.to_numpy(
                reflections.get_flags(
                    flags.centroid_outlier)
            ).tolist(),
            "unindexed_status": flumpy.to_numpy(
                reflections.get_flags(flags.strong)
                & ~reflections.get_flags(
                    flags.indexed)
            ).tolist(),
            "indexed_status": flumpy.to_numpy(
                reflections.get_flags(
                    flags.indexed)
            ).tolist(),
            "integrated_status": flumpy.to_numpy(
                reflections.get_flags(
                    flags.integrated)
            ).tolist(),
        }

        if "xyzobs.px.value" in reflections:
            x, y, z = (
                reflections["xyzobs.px.value"]
                .parts())
        else:
            x, y, z = (
                reflections["xyzcal.px"].parts())
        self.points_data["x"] = np.round(
            flumpy.to_numpy(x), 1).tolist()
        self.points_data["y"] = np.round(
            flumpy.to_numpy(y), 1).tolist()
        self.points_data["z"] = np.round(
            flumpy.to_numpy(z), 1).tolist()

        intensities = sigma = None
        if "intensity.sum.value" in reflections:
            intensities = flumpy.to_numpy(
                reflections[
                    "intensity.sum.value"]
            ).tolist()
            if "intensity.sum.variance" \
                    in reflections:
                var = flumpy.to_numpy(
                    reflections[
                        "intensity.sum.variance"])
                sigma = np.sqrt(
                    np.maximum(var, 0)).tolist()
        elif "intensity.prf.value" in reflections:
            intensities = flumpy.to_numpy(
                reflections[
                    "intensity.prf.value"]
            ).tolist()
            if "intensity.prf.variance" \
                    in reflections:
                var = flumpy.to_numpy(
                    reflections[
                        "intensity.prf.variance"])
                sigma = np.sqrt(
                    np.maximum(var, 0)).tolist()
        self.points_data["intensity"] = intensities
        self.points_data["sigma"] = sigma

        if "miller_index" in reflections:
            h, k, l = (
                reflections["miller_index"]
                .as_vec3_double().parts())
            self.points_data["h"] = (
                flumpy.to_numpy(h.iround())
                .tolist())
            self.points_data["k"] = (
                flumpy.to_numpy(k.iround())
                .tolist())
            self.points_data["l"] = (
                flumpy.to_numpy(l.iround())
                .tolist())

    def set_colors(self, colors):
        from dxtbx import flumpy
        self.colors = flumpy.to_numpy(
            colors).tolist()

    def set_palette(self, palette):
        pass

    def set_rotation_axis(self, axis):
        self.rotation_axis = list(axis)

    def set_beam_vector(self, beam):
        self.beam_vector = list(beam)

    def set_reciprocal_lattice_vectors(self, v):
        self.recip_latt_vectors = [
            [[float(x) for x in row]
             for row in crystal_vecs]
            for crystal_vecs in v
        ]

    def set_reciprocal_crystal_vectors(self, v):
        self.recip_crystal_vectors = [
            [[float(x) for x in row]
             for row in crystal_vecs]
            for crystal_vecs in v
        ]

    def update_minimum_covering_sphere(self):
        from scitbx.math import (
            minimum_covering_sphere)
        n = min(1000, self.points.size())
        isel = flex.random_permutation(
            self.points.size())[:n]
        self.minimum_covering_sphere = (
            minimum_covering_sphere(
                self.points.select(isel)))

    def draw_cells(self):
        return {}


# ── Main viewer class ─────────────────────────────────

class _Viewer(Render3d):
    def __init__(self, settings):
        Render3d.__init__(
            self, settings=settings)
        self.rlv_window = _Window(settings)

    def set_points(self):
        Render3d.set_points(self)

    def update_settings(self):
        self.set_beam_centre(
            self.settings.beam_centre_panel,
            self.settings.beam_centre)
        self.map_points_to_reciprocal_space()
        self.set_points()

    def to_json(self, title=""):
        from dxtbx import flumpy

        win = self.rlv_window
        pts = flumpy.to_numpy(
            win.points).tolist()
        pd  = win.points_data
        n   = len(pd["id"])

        groups = []
        for i in range(n):
            if pd["integrated_status"][i]:
                groups.append("integrated")
            elif pd["indexed_status"][i]:
                groups.append("indexed")
            else:
                groups.append("unindexed")

        exp_meta = []
        for i, expt in enumerate(
                self.experiments):
            cell_vecs = None
            if (win.recip_latt_vectors
                    and i < len(
                        win.recip_latt_vectors)):
                cell_vecs = (
                    win.recip_latt_vectors[i])

            scan_info = None
            if (expt.scan is not None
                    and expt.goniometer
                    is not None):
                osc = expt.scan.get_oscillation()
                scan_info = {
                    "image_range": list(
                        expt.scan
                        .get_image_range()),
                    "oscillation_start":
                        float(osc[0]),
                    "oscillation_delta":
                        float(osc[1]),
                    "num_images":
                        expt.scan
                        .get_num_images(),
                }

            s0_scaled = ewald_radius = None
            wavelength = None
            if expt.beam is not None:
                wavelength = float(
                    expt.beam.get_wavelength())
                s0_raw = expt.beam.get_s0()
                s0_scaled = [
                    float(v) * self._scale_factor
                    for v in s0_raw]
                ewald_radius = math.sqrt(
                    sum(v*v for v in s0_scaled))

            direct_cell_frames = (
                _compute_direct_cell_frames(
                    expt, self._scale_factor))

            detector_corners = (
                _compute_detector_corners(
                    expt, ewald_radius,
                    self._scale_factor))

            exp_meta.append({
                "id":               i,
                "beam_vector":
                    win.beam_vector,
                "s0_scaled":        s0_scaled,
                "rotation_axis":
                    win.rotation_axis,
                "recip_latt_vectors": cell_vecs,
                "direct_cell_frames":
                    direct_cell_frames,
                "detector_corners":
                    detector_corners,
                "scan":             scan_info,
                "wavelength":       wavelength,
                "ewald_radius":     ewald_radius,
            })

        return json.dumps({
            "title":        title,
            "scale_factor": self._scale_factor,
            "points":       pts,
            "colors":       win.colors,
            "groups":       groups,
            "data":         pd,
            "experiments":  exp_meta,
            "settings": {
                "show_reciprocal_cell":
                    self.settings
                    .show_reciprocal_cell,
                "show_rotation_axis":
                    self.settings
                    .show_rotation_axis,
                "show_beam_vector":
                    self.settings
                    .show_beam_vector,
                "marker_size":
                    self.settings.marker_size,
                "d_min": self.settings.d_min,
                "z_min": float(
                    self.settings.z_min)
                    if self.settings.z_min
                    is not None else None,
                "z_max": float(
                    self.settings.z_max)
                    if self.settings.z_max
                    is not None else None,
            },
        })


# ── Geometry helpers ──────────────────────────────────

def _pairwise(it):
    a, b = tee(it)
    next(b, None)
    return zip(a, b)


def _compute_direct_cell_frames(
        expt, scale_factor):
    if (expt.crystal is None
            or expt.scan is None
            or expt.goniometer is None):
        return None
    try:
        from scitbx import matrix as m

        crystal = expt.crystal
        scan    = expt.scan
        gonio   = expt.goniometer
        num_pts = scan.get_num_images() + 1
        start, stop = scan.get_array_range()

        if gonio.num_scan_points > 0:
            S_mats = [
                m.sqr(
                    gonio
                    .get_setting_rotation_at_scan_point(i))
                for i in range(
                    gonio.num_scan_points)]
        else:
            S_mats = [
                m.sqr(
                    gonio.get_setting_rotation())
            ] * num_pts

        F_mats = [
            m.sqr(gonio.get_fixed_rotation())
        ] * num_pts

        axis = m.col(
            gonio.get_rotation_axis_datum())
        R_mats = [
            m.sqr(
                axis
                .axis_and_angle_as_r3_rotation_matrix(
                    scan.get_angle_from_array_index(
                        i, deg=False),
                    deg=False))
            for i in range(start, stop + 1)
        ]

        if crystal.num_scan_points > 0:
            U_mats = [
                m.sqr(
                    crystal
                    .get_U_at_scan_point(i))
                for i in range(
                    crystal.num_scan_points)]
            B_mats = [
                m.sqr(
                    crystal
                    .get_B_at_scan_point(i))
                for i in range(
                    crystal.num_scan_points)]
        else:
            U_mats = [
                m.sqr(crystal.get_U())
            ] * num_pts
            B_mats = [
                m.sqr(crystal.get_B())
            ] * num_pts

        SRFU = [
            S * R * F * U
            for S, R, F, U in zip(
                S_mats, R_mats,
                F_mats, U_mats)
        ]

        U_frames = []
        for U1, U2 in _pairwise(iter(SRFU)):
            M = U2 * U1.transpose()
            angle, ax = (
                M.r3_rotation_matrix_as_unit_quaternion()
                .unit_quaternion_as_axis_and_angle(
                    deg=False))
            U_frames.append(
                ax.axis_and_angle_as_r3_rotation_matrix(
                    angle / 2, deg=False)
                * U1)

        B_frames = [
            (B1 + B2) / 2
            for B1, B2 in _pairwise(
                iter(B_mats))
        ]
        UB_frames = [
            U * B
            for U, B in zip(
                U_frames, B_frames)
        ]

        h = m.col((1, 0, 0))
        k = m.col((0, 1, 0))
        l = m.col((0, 0, 1))
        disp = 0.15 * scale_factor
        frames = []
        for UB in UB_frames:
            orthog = UB.transpose().inverse()
            fv = []
            for hkl in (h, k, l):
                v    = orthog * hkl
                vlen = math.sqrt(
                    sum(x*x for x in v))
                if vlen > 0:
                    fv.append(
                        [float(x) / vlen * disp
                         for x in v]
                        + [float(vlen)])
                else:
                    fv.append(
                        [0.0, 0.0, 0.0, 0.0])
            frames.append(fv)
        return frames
    except Exception:
        return None


def _compute_detector_corners(
        expt, ewald_radius, scale_factor):
    if (expt.detector is None
            or ewald_radius is None):
        return None
    try:
        panel     = expt.detector[0]
        origin_mm = panel.get_origin()
        fast_mm   = panel.get_fast_axis()
        slow_mm   = panel.get_slow_axis()
        px_mm     = panel.get_pixel_size()
        nx, ny    = panel.get_image_size()
        w_mm = nx * px_mm[0]
        h_mm = ny * px_mm[1]

        def _project(fs, ss):
            lab = [
                origin_mm[j]
                + fast_mm[j] * fs
                + slow_mm[j] * ss
                for j in range(3)
            ]
            dist = math.sqrt(
                sum(v*v for v in lab))
            if dist < 1e-10:
                return [0.0, 0.0, 0.0]
            return [
                v / dist
                * ewald_radius * scale_factor
                for v in lab
            ]

        return [
            _project(0,     0),
            _project(w_mm,  0),
            _project(w_mm,  h_mm),
            _project(0,     h_mm),
        ]
    except Exception:
        return None


# ── Entry point ───────────────────────────────────────

@dials.util.show_mail_handle_errors()
def run(args=None):
    import dials.util

    dials.util.log.print_banner()
    usage = (
        "dials.export_rlv [options] "
        "models.expt observations.refl"
    )
    parser = ArgumentParser(
        usage=usage,
        phil=phil_scope,
        read_experiments=True,
        read_reflections=True,
        check_format=False,
        epilog=help_message,
    )
    params, _ = parser.parse_args(
        args, show_diff_phil=True)

    reflections, experiments = (
        reflections_and_experiments_from_files(
            params.input.reflections,
            params.input.experiments,
        ))

    if (len(experiments) == 0
            or len(reflections) == 0):
        parser.print_help()
        return

    # Merge multiple reflection tables
    if len(reflections) > 1:
        assert len(reflections) == len(
            experiments)
        for i in range(len(reflections)):
            reflections[i]["imageset_id"] = (
                flex.int(
                    len(reflections[i]), i))
            if i > 0:
                reflections[0].extend(
                    reflections[i])
    elif "imageset_id" not in reflections[0]:
        reflections[0]["imageset_id"] = (
            reflections[0]["id"])
    reflections = reflections[0]

    import copy
    viewer = _Viewer(
        settings=copy.deepcopy(params))
    viewer.load_models(experiments, reflections)

    out = params.output or (
        "reciprocal_lattice.rlv.json")
    title = Path(out).name
    data  = viewer.to_json(title=title)

    if out.endswith(".gz"):
        with gzip.open(
                out, "wt",
                encoding="utf-8") as fh:
            fh.write(data)
    else:
        with open(out, "w",
                  encoding="utf-8") as fh:
            fh.write(data)

    n_pts = len(viewer.rlv_window.points)
    print(
        f"Written {n_pts:,} spots to: {out}"
        f"  ({Path(out).stat().st_size:,}"
        f" bytes)")


if __name__ == "__main__":
    run()
