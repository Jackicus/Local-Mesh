"""TRELLIS image-large - MIT, sparse-structure flow -> structured latents -> mesh.

Architecturally the odd one out in this app: instead of a DiT over point latents
it samples a 16³ occupancy grid, then a sparse 64³ "SLat" volume, then runs a
sparse-transformer decoder whose output is a FlexiCubes mesh. It therefore fails
differently from the other models, which is half the reason it is here.

The repo is cloned to ~/.local-mesh/repos/TRELLIS and put on sys.path by
worker.py. That clone **must** be recursive (`"submodules": true` in
manifest.json): `trellis/representations/mesh/flexicubes` is a git submodule and
the mesh decoder imports `FlexiCubes` from it at module scope.

Four things this backend does deliberately:

1. **Env vars before the first `import trellis`.** `trellis/modules/sparse/
   __init__.py` reads SPARSE_BACKEND / ATTN_BACKEND / SPCONV_ALGO *at import
   time* and defaults ATTN to `flash_attn`, which has no reliable wheel. They are
   set in `_configure_env()` below, which runs before the import in `load()`.
2. **`formats=['mesh']`.** `decode_slat` runs one decoder per requested format;
   the gaussian and radiance-field decoders are pure waste here (and their
   *renderers* would need CUDA rasterisers, though those are behind a lazy
   `__getattr__` and never import).
3. **No `trellis.utils.postprocessing_utils`.** That module imports
   `nvdiffrast.torch`, xatlas, pyvista, pymeshfix and igraph at module level.
   Its `to_glb` is the only thing upstream offers for mesh export, so the
   vertices/faces tensors are turned into a trimesh by hand below - including
   upstream's own z-up -> y-up rotation, copied from `to_glb`.
4. **Two shims.** `open3d` (only the text-to-3D pipeline's annotations need the
   name to resolve, and `trellis/pipelines/__init__.py` imports both pipelines)
   and `kaolin` (FlexiCubes' six `check_tensor` shape assertions). See
   ../shims/.

The DINOv2 image conditioner is *not* on Hugging Face: `_init_image_cond_model`
calls `torch.hub.load('facebookresearch/dinov2', 'dinov2_vitl14_reg')`, a GitHub
clone plus a ~1.1 GB .pth from dl.fbaipublicfiles.com. The dependency install
pre-seeds both into $TORCH_HOME (~/.local-mesh/torch-hub) through the manifest's
`postInstall` hook, and the worker runs with the same TORCH_HOME, so the call
resolves from cache with the network still unavailable.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import numpy as np

from .base import Backend as BaseBackend, Cancelled, check_cancel, scan_weight_bytes_fp32

# trellis/modules/sparse/__init__.py::__from_env, read once at import.
TRELLIS_ENV = {
    # flash_attn is the upstream default and has no reliable PyPI wheel.
    "ATTN_BACKEND": "xformers",
    # torchsparse would need a source CUDA build.
    "SPARSE_BACKEND": "spconv",
    # Skip spconv's autotune sweep on the first conv of every run.
    "SPCONV_ALGO": "native",
}

# to_glb() in trellis/utils/postprocessing_utils.py, verbatim.
Z_UP_TO_Y_UP = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float32)

_PCT_CONDITION = 10.0
_PCT_STRUCTURE_START = 16.0
_PCT_STRUCTURE_END = 42.0
_PCT_SLAT_START = 44.0
_PCT_SLAT_END = 80.0


def _configure_env(log) -> None:
    """Set the three env vars TRELLIS reads at import time, if not already set."""
    for key, value in TRELLIS_ENV.items():
        current = os.environ.get(key)
        if current and current != value:
            log("warn", f"{key} is already {current!r}; leaving it (TRELLIS wants {value!r})")
            continue
        os.environ[key] = value


class Backend(BaseBackend):
    name = "trellis"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pipeline: Any = None
        self._patched_tqdm_module: Any = None
        self._original_tqdm: Any = None

    @classmethod
    def estimate_fp32_weight_bytes(cls, model_dir: str) -> Optional[int]:
        # Every published checkpoint is fp16 ("_fp16" in the file name), so
        # scan_weight_bytes_fp32 already doubles them.
        return scan_weight_bytes_fp32(model_dir)

    # -- loading ----------------------------------------------------------

    def load(self) -> None:
        if self.device == "cpu":
            raise RuntimeError(
                "TRELLIS needs a CUDA device: its sparse convolutions (spconv) and "
                "attention (xformers) are GPU-only. Pick another model for CPU generation.")

        _configure_env(self.log)
        # Imported after the env vars are in place - see the module docstring.
        from trellis.pipelines import TrellisImageTo3DPipeline

        if not os.path.exists(os.path.join(self.model_dir, "pipeline.json")):
            raise FileNotFoundError(
                f"pipeline.json is missing from {self.model_dir}; "
                "re-download the model from the Models view")

        self.log("info", f"loading TRELLIS from {self.model_dir}")
        pipeline = TrellisImageTo3DPipeline.from_pretrained(self.model_dir)
        pipeline.cuda()  # checkpoints are fp16 and stay fp16
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
        import trimesh

        if self.pipeline is None:
            raise RuntimeError("TRELLIS is not loaded")
        check_cancel(cancel)

        ss_steps = max(1, int(settings.get("ssSteps", 12)))
        ss_guidance = float(settings.get("ssGuidance", 7.5))
        slat_steps = max(1, int(settings.get("slatSteps", 12)))
        slat_guidance = float(settings.get("slatGuidance", 3.0))
        seed = int(settings.get("seed", 0)) & 0x7FFFFFFF

        self._require_alpha(image)
        self.progress(_PCT_CONDITION, "condition", "Encoding image with DINOv2")
        self._install_progress_hook(ss_steps, slat_steps)
        try:
            output = self.pipeline.run(
                image,
                seed=seed,
                formats=["mesh"],
                # Required: this is also where the 518x518 framing the model
                # expects happens. It keeps an existing alpha cut-out untouched,
                # which _require_alpha above has just guaranteed.
                preprocess_image=True,
                sparse_structure_sampler_params={
                    "steps": ss_steps,
                    "cfg_strength": ss_guidance,
                },
                slat_sampler_params={
                    "steps": slat_steps,
                    "cfg_strength": slat_guidance,
                },
            )
        finally:
            self._remove_progress_hook()
        check_cancel(cancel)

        meshes = output.get("mesh") or []
        result = meshes[0] if meshes else None
        if result is None or result.faces.shape[0] == 0:
            raise RuntimeError(
                "TRELLIS produced an empty mesh - try a different seed or more sparse-structure steps")

        self.progress(84.0, "decode", "Converting FlexiCubes output")
        vertices = result.vertices.detach().float().cpu().numpy() @ Z_UP_TO_Y_UP
        faces = result.faces.detach().cpu().numpy()
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
        self.progress(88.0, "decode", f"{len(mesh.faces)} faces")
        return mesh

    def _require_alpha(self, image) -> None:
        """Refuse an opaque image rather than let the pipeline reach for the network.

        `TrellisImageTo3DPipeline.preprocess_image` uses an existing alpha
        channel when it finds one and otherwise calls `rembg.new_session('u2net')`
        - a *different*, ~176 MB model from the `u2netp` the app pre-seeds, and
        one it would fetch from GitHub mid-generation. The worker is offline by
        design, so that turns into a stall or an opaque failure. Better to say so.
        """
        import numpy as np  # noqa: PLC0415  (local: keeps the module import light)

        if image.mode == "RGBA" and not np.all(np.array(image)[:, :, 3] == 255):
            return
        raise RuntimeError(
            "TRELLIS needs an image with a transparent background. Turn on background "
            "removal in the pipeline, or supply a cut-out PNG: TRELLIS would otherwise "
            "download its own background-removal model, which the offline worker cannot do.")

    # -- progress ---------------------------------------------------------

    def _install_progress_hook(self, ss_steps: int, slat_steps: int) -> None:
        """Report sampler progress through tqdm, which is all the pipeline exposes.

        Both samplers run `tqdm(..., desc="Sampling")` inside
        `FlowEulerSampler.sample`; there is no callback argument anywhere in
        `TrellisImageTo3DPipeline.run`. `self.progress` raises Cancelled when the
        job is cancelled, so this hook is also what makes generation
        interruptible between steps.
        """
        import trellis.pipelines.samplers.flow_euler as flow_euler

        original = flow_euler.tqdm
        state = {"stage": 0}

        def tracked(iterable=None, *args, **kwargs):
            state["stage"] += 1
            stage = state["stage"]
            total = ss_steps if stage == 1 else slat_steps
            label = "Sparse structure" if stage == 1 else "Structured latents"
            start = _PCT_STRUCTURE_START if stage == 1 else _PCT_SLAT_START
            end = _PCT_STRUCTURE_END if stage == 1 else _PCT_SLAT_END

            def generate():
                for index, item in enumerate(iterable):
                    yield item
                    done = index + 1
                    self.progress(start + (end - start) * done / max(1, total),
                                  "diffusion", f"{label} {done}/{total}")

            return generate()

        flow_euler.tqdm = tracked
        self._patched_tqdm_module = flow_euler
        self._original_tqdm = original

    def _remove_progress_hook(self) -> None:
        module = getattr(self, "_patched_tqdm_module", None)
        original = getattr(self, "_original_tqdm", None)
        if module is not None and original is not None:
            module.tqdm = original
        self._patched_tqdm_module = None
        self._original_tqdm = None


__all__ = ["Backend", "Cancelled", "TRELLIS_ENV"]
