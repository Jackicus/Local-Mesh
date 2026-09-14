"""Step1X-3D Geometry 1300m - Apache-2.0 flow-matching shape model.

The repo is cloned to ~/.local-mesh/repos/Step1X-3D and put on sys.path by
worker.py (`step1x3d_geometry/` sits at the clone root, so no `subdir`).
`model_index.json` names classes inside that package, so
`Step1X3DGeometryPipeline.from_pretrained(...)` only works with the clone
importable.

Things worth knowing before changing anything here:

* **The import is heavier than the model.** `models/pipelines/pipeline.py` does a
  bare `import step1x3d_geometry`, and that package's `__init__` ends with
  `from . import data, models, systems` - so the training tree is imported too.
  Three of its module-level imports are satisfied by ../shims rather than real
  packages: `streaming` (mosaicml-streaming, dataloader only) and `wandb`
  (experiment tracking). The rest are in requirements/step1x3d.txt.
* **`subfolder` is a real argument.** The HF repo holds several models; the
  geometry one is `Step1X-3D-Geometry-1300m/`, and upstream's `smart_load_model`
  resolves `<snapshot>/<subfolder>` locally without touching the network.
* **`caption_encoder` and `label_encoder` are `[null, null]`** in
  model_index.json for this checkpoint, so diffusers skips them - no T5 weights
  are fetched and no label conditioning exists. `label`/`caption` stay unset.
* **No custom CUDA on this path.** `torch_cluster.fps` is imported lazily inside
  the VAE *encoder* (mesh -> latent), which image -> mesh never reaches, and
  `diso` only inside `DMCSurfaceExtractor.run()` - hence
  `surface_extractor_type='mc'` below.
* The misspelling `visual_eature_extractor` is upstream's, in both the class
  signature and the published repo. Do not "fix" it.
"""
from __future__ import annotations

import os
from typing import Any, Optional

from .base import Backend as BaseBackend, Cancelled, check_cancel, scan_weight_bytes_fp32

SUBFOLDER = "Step1X-3D-Geometry-1300m"

_PCT_CONDITION = 12.0
_PCT_DIFFUSION_START = 18.0
_PCT_DIFFUSION_END = 74.0
_PCT_DECODE = 78.0


class Backend(BaseBackend):
    name = "step1x3d"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pipeline: Any = None
        self._original_progress_bar: Any = None

    @classmethod
    def estimate_fp32_weight_bytes(cls, model_dir: str) -> Optional[int]:
        # The published safetensors are fp32 already (5.27 GB DiT + 0.77 GB VAE
        # + 1.22 GB encoder), so no doubling happens and the sum is the answer.
        return scan_weight_bytes_fp32(model_dir, include=[SUBFOLDER])

    # -- loading ----------------------------------------------------------

    def load(self) -> None:
        import torch
        from step1x3d_geometry.models.pipelines.pipeline import Step1X3DGeometryPipeline

        index = os.path.join(self.model_dir, SUBFOLDER, "model_index.json")
        if not os.path.exists(index):
            raise FileNotFoundError(
                f"{index} is missing; re-download the model from the Models view")

        self.log("info", f"loading {SUBFOLDER} from {self.model_dir}")
        pipeline = Step1X3DGeometryPipeline.from_pretrained(self.model_dir, subfolder=SUBFOLDER)

        dtype = self.dtype or torch.float16
        pipeline.to(dtype=dtype)
        if self.low_vram and self.device != "cpu":
            # Unlike the Hunyuan pipelines this really is a diffusers
            # DiffusionPipeline, so the stock offload works: the DiT, the VAE and
            # the DINOv2 tower each move to the card only while they run. Worth
            # several GB of peak on the 1.3B model.
            pipeline.enable_model_cpu_offload(device=self.device)
            self.log("info", "low VRAM: diffusers model CPU offload enabled")
        else:
            pipeline.to(self.device)
        self.pipeline = pipeline

    def unload(self) -> None:
        import gc

        self.pipeline = None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass

    # -- generation -------------------------------------------------------

    def generate(self, image, settings: dict, cancel):
        import torch

        if self.pipeline is None:
            raise RuntimeError("Step1X-3D is not loaded")
        check_cancel(cancel)

        steps = max(1, int(settings.get("steps", 50)))
        guidance = float(settings.get("guidance", 7.5))
        octree_resolution = int(settings.get("octreeResolution", 384))
        mc_level = float(settings.get("mcLevel", 0.0))
        foreground_ratio = float(settings.get("foregroundRatio", 0.95))
        max_faces = int(settings.get("maxFaces", 200000))
        seed = int(settings.get("seed", 0)) & 0x7FFFFFFF
        generator = torch.Generator(device=self.pipeline.device).manual_seed(seed)

        self.progress(_PCT_CONDITION, "condition", "Encoding image with DINOv2")
        span = _PCT_DIFFUSION_END - _PCT_DIFFUSION_START

        # The pipeline drives a tqdm bar rather than offering a step callback, so
        # progress is reported by wrapping the bar's update.
        self._install_progress_hook(steps, span, octree_resolution)
        try:
            output = self.pipeline(
                image=image,
                num_inference_steps=steps,
                guidance_scale=guidance,
                octree_resolution=octree_resolution,
                mc_level=mc_level,
                bounds=float(settings.get("bounds", 1.05)),
                # 'mc' = skimage marching cubes; 'dmc' would need the real diso.
                surface_extractor_type="mc",
                foreground_ratio=foreground_ratio,
                # The worker already handed us an RGBA cut-out, and upstream's
                # preprocess_image detects a populated alpha channel and skips
                # its own rembg pass. Forcing it would run background removal twice.
                force_remove_background=False,
                do_remove_floater=True,
                do_remove_degenerate_face=False,
                do_reduce_face=max_faces > 0,
                max_facenum=max_faces,
                do_shade_smooth=True,
                output_type="trimesh",
                generator=generator,
                return_dict=True,
            )
        finally:
            self._remove_progress_hook()
        check_cancel(cancel)

        meshes = getattr(output, "mesh", None) or []
        mesh = meshes[0] if meshes else None
        if mesh is None or len(mesh.faces) == 0:
            raise RuntimeError(
                "Step1X-3D produced an empty mesh - try a different seed or more steps")
        self.progress(88.0, "decode", f"{len(mesh.faces)} faces")
        return mesh

    # -- progress ---------------------------------------------------------

    def _install_progress_hook(self, steps: int, span: float, octree_resolution: int) -> None:
        """Report diffusion progress (and cancellation) through the tqdm bar.

        `self.progress` raises Cancelled when the job has been cancelled, so
        hooking the per-step bar update is also what makes this backend
        interruptible mid-generation.
        """
        pipeline = self.pipeline
        original = pipeline.progress_bar
        state = {"done": 0}

        def progress_bar(iterable=None, total=None):
            bar = original(iterable=iterable, total=total)
            bar_update = bar.update

            def update(n=1):
                state["done"] += int(n or 0)
                done = state["done"]
                if done >= steps:
                    self.progress(_PCT_DECODE, "decode",
                                  f"Decoding to a {octree_resolution}³ grid")
                else:
                    self.progress(_PCT_DIFFUSION_START + span * done / steps,
                                  "diffusion", f"Step {done}/{steps}")
                return bar_update(n)

            bar.update = update
            return bar

        pipeline.progress_bar = progress_bar
        self._original_progress_bar = original

    def _remove_progress_hook(self) -> None:
        original = getattr(self, "_original_progress_bar", None)
        if original is not None and self.pipeline is not None:
            self.pipeline.progress_bar = original
        self._original_progress_bar = None


__all__ = ["Backend", "Cancelled", "SUBFOLDER"]
