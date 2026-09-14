"""Procedural backend: no torch, no download. Exercises the queue/viewer/logs end to end.

Settings (src/core/models.ts, id "mock"): shape (torus-knot|sphere|box),
seconds (fake duration), seed (drives a small deterministic deformation).
"""
from __future__ import annotations

import math
import time

import numpy as np
import trimesh

from .base import Backend as BaseBackend, check_cancel

# (pct_start, pct_end, share of the fake duration)
_STAGES = (
    ("condition", 10.0, 15.0, 0.10, "Encoding image (mock)"),
    ("diffusion", 15.0, 70.0, 0.60, "Sampling"),
    ("decode", 70.0, 90.0, 0.30, "Decoding latents to mesh (mock)"),
)
_DIFFUSION_STEPS = 20
_TICK = 0.1


def torus_knot(p: int = 2, q: int = 3, radius: float = 1.0, tube: float = 0.32,
               tubular_segments: int = 192, radial_segments: int = 20) -> trimesh.Trimesh:
    """Same parametrisation as three.js TorusKnotGeometry, on a (tubular x radial) grid."""
    def curve(t: np.ndarray) -> np.ndarray:
        cu, su = np.cos(t), np.sin(t)
        qu = (q / p) * t
        cs = np.cos(qu)
        return np.stack([radius * (2 + cs) * 0.5 * cu,
                         radius * (2 + cs) * 0.5 * su,
                         radius * np.sin(qu) * 0.5], axis=-1)

    t = np.linspace(0, p * 2 * math.pi, tubular_segments, endpoint=False)
    p1 = curve(t)
    p2 = curve(t + 0.01)
    tangent = p2 - p1
    normal = p2 + p1
    binormal = np.cross(tangent, normal)
    normal = np.cross(binormal, tangent)
    binormal /= np.linalg.norm(binormal, axis=1, keepdims=True)
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)

    v = np.linspace(0, 2 * math.pi, radial_segments, endpoint=False)
    cx = -tube * np.cos(v)
    cy = tube * np.sin(v)
    verts = p1[:, None, :] + cx[None, :, None] * normal[:, None, :] + cy[None, :, None] * binormal[:, None, :]
    verts = verts.reshape(-1, 3)

    i = np.arange(tubular_segments)[:, None]
    j = np.arange(radial_segments)[None, :]
    a = i * radial_segments + j
    b = ((i + 1) % tubular_segments) * radial_segments + j
    c = ((i + 1) % tubular_segments) * radial_segments + (j + 1) % radial_segments
    d = i * radial_segments + (j + 1) % radial_segments
    faces = np.concatenate([np.stack([a, b, d], -1).reshape(-1, 3),
                            np.stack([b, c, d], -1).reshape(-1, 3)])
    return trimesh.Trimesh(vertices=verts, faces=faces, process=False)


def build_shape(shape: str) -> trimesh.Trimesh:
    if shape == "sphere":
        return trimesh.creation.icosphere(subdivisions=4, radius=1.0)
    if shape == "box":
        return trimesh.creation.box(extents=(1.6, 1.0, 1.2))
    return torus_knot()


def deform(mesh: trimesh.Trimesh, seed: int, amount: float = 0.06) -> trimesh.Trimesh:
    """Deterministic low-frequency bumps along the normals so different seeds look different."""
    rng = np.random.default_rng(int(seed) & 0xFFFFFFFF)
    verts = mesh.vertices.copy()
    normals = mesh.vertex_normals
    disp = np.zeros(len(verts))
    for _ in range(4):
        k = rng.normal(size=3) * rng.uniform(2.0, 5.0)
        phase = rng.uniform(0, 2 * math.pi)
        disp += rng.uniform(0.3, 1.0) * np.sin(verts @ k + phase)
    verts += normals * (disp * amount / 4.0)[:, None]
    return trimesh.Trimesh(vertices=verts, faces=mesh.faces, process=False)


class Backend(BaseBackend):
    name = "mock"

    @classmethod
    def estimate_fp32_weight_bytes(cls, model_dir: str):
        return 0

    def load(self) -> None:
        self.log("info", "mock backend loaded (no weights)")

    def generate(self, image, settings: dict, cancel):
        seconds = max(0.0, float(settings.get("seconds", 4)))
        seed = int(settings.get("seed", 0))
        shape = str(settings.get("shape", "torus-knot"))
        self.log("debug", f"mock generate: shape={shape} seed={seed} seconds={seconds} image={image.size}")

        for stage, start, end, share, message in _STAGES:
            budget = seconds * share
            steps = _DIFFUSION_STEPS if stage == "diffusion" else 1
            self.progress(start, stage, message)
            for step in range(steps):
                self._sleep(budget / steps, cancel)
                pct = start + (end - start) * (step + 1) / steps
                text = f"Step {step + 1}/{steps}" if steps > 1 else message
                self.progress(pct, stage, text)

        check_cancel(cancel)
        mesh = deform(build_shape(shape), seed)
        return mesh

    @staticmethod
    def _sleep(duration: float, cancel) -> None:
        deadline = time.monotonic() + duration
        while True:
            check_cancel(cancel)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(_TICK, remaining))
