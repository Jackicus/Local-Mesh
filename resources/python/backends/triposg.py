"""TripoSG - 1.5B rectified-flow shape model (VAST-AI/TripoSG).

The repo is cloned to ~/.local-mesh/repos/TripoSG and put on sys.path by
worker.py; `model_index.json` names classes inside the `triposg` package, so
`TripoSGPipeline.from_pretrained(<snapshot dir>)` only works with that clone
importable.

Two things upstream does that we deliberately do not:

* `use_flash_decoder=True` (the pipeline default) needs `diso.DiffDMC`, a CUDA
  extension shipped as an sdist. `triposg/inference_utils.py` imports `diso` at
  module scope, so ../shims/diso exists purely to let that import succeed - and
  the flash path is switched off here, because the shim raises on construction
  and `flash_extract_geometry` swallows the exception and silently returns an
  empty mesh. The hierarchical decoder is used instead; it is pure torch.
* `scripts/inference_triposg.py` runs BriaRMBG (~1 GB) for background removal.
  The worker has already produced an RGBA cut-out with rembg, so this backend
  only reproduces the framing that follows it: crop to the alpha bounds,
  composite over white, pad by 10%.

Weights are fp32 on the Hub and total ~7.9 GB, which does not fit an 8 GB card;
the worker's `auto` precision therefore lands on fp16 here, as upstream does.
The hierarchical decoder also allocates on `cuda` unconditionally, so CPU
generation is refused up front rather than failing deep inside the decode.
"""
from __future__ import annotations

import math
import os
from typing import Any, Optional

import numpy as np

from .base import Backend as BaseBackend, check_cancel, scan_weight_bytes_fp32

# The hierarchical decoder works in octree *depths*: the final grid is 2**depth.
DENSE_OCTREE_DEPTH = 8
MIN_DEPTH = 6
MAX_DEPTH = 9

_PCT_DIFFUSION_START = 18.0
_PCT_DIFFUSION_END = 72.0


def octree_depth_for(resolution: int) -> int:
    """Map the UI's resolution setting onto the nearest power-of-two depth."""
    depth = int(round(math.log2(max(2, resolution))))
    return max(MIN_DEPTH, min(MAX_DEPTH, depth))


def frame_on_white(image, padding_ratio: float = 0.1):
    """Crop to the alpha bounds, composite over white, pad by `padding_ratio`."""
    from PIL import Image

    array = np.array(image)
    if array.shape[-1] != 4:
        raise ValueError("TripoSG preprocessing needs an RGBA image")
    alpha = array[..., 3]
    rows, cols = np.where(alpha > 0)
    if rows.size == 0:
        raise ValueError("the image is fully transparent after background removal")
    y0, y1 = int(rows.min()), int(rows.max()) + 1
    x0, x1 = int(cols.min()), int(cols.max()) + 1

    crop = array[y0:y1, x0:x1].astype(np.float32) / 255.0
    mask = crop[..., 3:4]
    rgb = crop[..., :3] * mask + (1.0 - mask)  # white background

    height, width = rgb.shape[0], rgb.shape[1]
    if width > height:
        pad_x = int(width * padding_ratio)
        pad_y = int(pad_x + (width - height) / 2)
    else:
        pad_y = int(height * padding_ratio)
        pad_x = int(pad_y + (height - width) / 2)
    padded = np.pad(rgb, ((pad_y, pad_y), (pad_x, pad_x), (0, 0)), mode="constant",
                    constant_values=1.0)
    return Image.fromarray((padded * 255.0).astype(np.uint8))


class Backend(BaseBackend):
    name = "triposg"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pipeline: Any = None

    @classmethod
    def estimate_fp32_weight_bytes(cls, model_dir: str) -> Optional[int]:
        return scan_weight_bytes_fp32(model_dir)

    def load(self) -> None:
        import torch
        from triposg.pipelines.pipeline_triposg import TripoSGPipeline

        if not os.path.exists(os.path.join(self.model_dir, "model_index.json")):
            raise FileNotFoundError(
                f"model_index.json is missing from {self.model_dir}; "
                "re-download the model from the Models view")

        self.log("info", f"loading TripoSG from {self.model_dir}")
        pipeline = TripoSGPipeline.from_pretrained(self.model_dir)

        dtype = self.dtype or torch.float16
        pipeline.to(dtype=dtype)
        if self.low_vram and self.device != "cpu":
            pipeline.enable_model_cpu_offload(device=self.device)
            self.log("info", "low VRAM: diffusers model CPU offload enabled")
        else:
            pipeline.to(self.device)
        self.pipeline = pipeline

    def unload(self) -> None:
        self.pipeline = None

    def generate(self, image, settings: dict, cancel):
        import torch

        if self.pipeline is None:
            raise RuntimeError("TripoSG is not loaded")
        if self.device == "cpu":
            raise RuntimeError(
                "TripoSG needs a CUDA device: its hierarchical mesh decoder allocates "
                "on 'cuda' unconditionally. Pick another model for CPU generation.")

        steps = max(1, int(settings.get("steps", 50)))
        guidance = float(settings.get("guidance", 7.0))
        depth = octree_depth_for(int(settings.get("octreeResolution", 256)))
        seed = int(settings.get("seed", 0)) & 0x7FFFFFFF
        generator = torch.Generator(device=self.pipeline.device).manual_seed(seed)

        self.progress(10.0, "prepare", "Framing foreground on white")
        prepared = frame_on_white(image)
        check_cancel(cancel)

        self.progress(12.0, "condition", "Encoding image with DINOv2")
        span = _PCT_DIFFUSION_END - _PCT_DIFFUSION_START

        def on_step_end(_pipe, index, _timestep, callback_kwargs):
            done = index + 1
            self.progress(_PCT_DIFFUSION_START + span * done / steps,
                          "diffusion", f"Step {done}/{steps}")
            return callback_kwargs

        self.log("debug", f"hierarchical decode to a {2 ** depth}³ grid (octree depth {depth})")
        output = self.pipeline(
            image=prepared,
            generator=generator,
            num_inference_steps=steps,
            guidance_scale=guidance,
            use_flash_decoder=False,
            dense_octree_depth=min(DENSE_OCTREE_DEPTH, depth),
            hierarchical_octree_depth=depth,
            callback_on_step_end=on_step_end,
            return_dict=True,
        )
        check_cancel(cancel)

        self.progress(80.0, "decode", "Building mesh")
        meshes = getattr(output, "meshes", None) or []
        mesh = meshes[0] if meshes else None
        if mesh is None or len(mesh.faces) == 0:
            raise RuntimeError(
                "TripoSG produced an empty mesh - try a different seed or more steps")
        self.progress(88.0, "decode", f"{len(mesh.faces)} faces")
        return mesh
