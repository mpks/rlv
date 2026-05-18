from __future__ import annotations

import json
import math
from pathlib import Path
from dxtbx import flumpy
import numpy as np

from scitbx.array_family import flex
from scitbx.math import minimum_covering_sphere

from dials.util.napari_rlv import Render3d
from dials.util.options import reflections_and_experiments_from_files
from dials.util.options import ArgumentParser
import libtbx.phil


phil_scope = libtbx.phil.parse(
    """
include scope dials.util.reciprocal_lattice.phil_scope

show_rotation_axis = False
  .type = bool
show_beam_vector = False
  .type = bool
show_reciprocal_cell = True
  .type = bool
marker_size = 3
  .type = int(value_min=1)
port = 0
  .type = int
  .help = "Port to use for the local HTTP server. 0 = auto-select."
""",
    process_includes=True,
)

help_message = """ """


def main(args=None):

    parser = ArgumentParser(
        usage="dials.new_rlv [options] models.expt observations.refl",
        phil=phil_scope,
        read_experiments=True,
        read_reflections=True,
        check_format=False,
        epilog=help_message,
    )

    params, options = parser.parse_args(args, show_diff_phil=True)

    reflections, experiments = reflections_and_experiments_from_files(
        params.input.reflections, params.input.experiments
    )

    # msg = 'Export DIALS data to .rlv.json for the RLV viewer.'
    # parser = argparse.ArgumentParser(description=msg)
    # parser.add_argument('expt_file', type=str, help='expt file')
    #  parser.add_argument('refl_file', type=str, help='refl file')
    # parser.add_argument('--json_file', type=str, default='data.rlv.json',
    #                     help='output json filename')
    # args = parser.parse_args()

    # reflections, experiments = (
    #     reflections_and_experiments_from_files(
    #         [args.refl_file], [args.expt_file],
    #     ))

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

    viewer = _Viewer()
    viewer.load_models(experiments, reflections)

    out = args.json_file
    title = Path(out).name
    viewer.to_json(title=title)

    n_pts = len(viewer.rlv_window.points)
    print(f"Written {n_pts:,} spots to: {out}")


class _Window:

    def __init__(self):
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
            h, k, l = (                         # noqa: E741
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
        n = min(1000, self.points.size())
        isel = flex.random_permutation(
            self.points.size())[:n]
        self.minimum_covering_sphere = (minimum_covering_sphere(
                                        self.points.select(isel)))

    def draw_cells(self):
        return {}


class _Viewer(Render3d):

    def to_json(self, title=""):

        win = self.rlv_window
        pts = flumpy.to_numpy(
            win.points).tolist()
        pd = win.points_data
        n = len(pd["id"])

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

            exp_meta.append({
                "id": i,
                "beam_vector": win.beam_vector,
                "s0_scaled": s0_scaled,
                "rotation_axis": win.rotation_axis,
                "recip_latt_vectors": cell_vecs,
                "scan": scan_info,
                "wavelength": wavelength,
                "ewald_radius": ewald_radius,
            })

        return json.dumps({
            "title":        title,
            "scale_factor": self._scale_factor,
            "points":       pts,
            "colors":       win.colors,
            "groups":       groups,
            "data":         pd,
            "experiments":  exp_meta,
        })


if __name__ == "__main__":
    main()
