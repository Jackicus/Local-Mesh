"""Model id -> backend module. Mirrors the `backend` field of MODELS in src/core/models.ts.

Keep the two in sync: adding a model there means adding a line here and a
backends/<name>.py module exposing a `Backend` class.
"""
from __future__ import annotations

import importlib

BACKENDS: dict[str, str] = {
    # Four Hunyuan3D 2.0 entries, one module: the 0.6B mini and the 1.1B
    # standard model, each in a distilled "turbo" and an undistilled flavour.
    # They are the same code path down to the checkpoint, so each is a subclass
    # that pins one DiT subfolder.
    "hunyuan3d_mini_turbo": "backends.hunyuan3d_mini:Backend",
    "hunyuan3d_mini": "backends.hunyuan3d_mini:Hunyuan3DMiniBackend",
    "hunyuan3d_2_turbo": "backends.hunyuan3d_mini:Hunyuan3D2TurboBackend",
    "hunyuan3d_2": "backends.hunyuan3d_mini:Hunyuan3D2Backend",
    "hunyuan3d_21": "backends.hunyuan3d_21:Backend",
    "step1x3d": "backends.step1x3d:Backend",
    "trellis": "backends.trellis:Backend",
    "triposr": "backends.triposr:Backend",
    "triposg": "backends.triposg:Backend",
    "mock": "backends.mock:Backend",
}

MODEL_TO_BACKEND: dict[str, str] = {
    "hunyuan3d-2mini-turbo": "hunyuan3d_mini_turbo",
    "hunyuan3d-2mini": "hunyuan3d_mini",
    "hunyuan3d-2-turbo": "hunyuan3d_2_turbo",
    "hunyuan3d-2": "hunyuan3d_2",
    "hunyuan3d-2.1": "hunyuan3d_21",
    "step1x-3d": "step1x3d",
    "trellis": "trellis",
    "triposr": "triposr",
    "triposg": "triposg",
    "mock": "mock",
}


def backend_name_for(model_id: str) -> str:
    try:
        return MODEL_TO_BACKEND[model_id]
    except KeyError:
        raise KeyError(f"unknown model id {model_id!r}; known: {sorted(MODEL_TO_BACKEND)}") from None


def load_backend_class(backend_name: str):
    """Import `backends.<name>` and return its Backend class."""
    try:
        spec = BACKENDS[backend_name]
    except KeyError:
        raise KeyError(f"unknown backend {backend_name!r}; known: {sorted(BACKENDS)}") from None
    module_name, _, attr = spec.partition(":")
    module = importlib.import_module(module_name)
    return getattr(module, attr or "Backend")
