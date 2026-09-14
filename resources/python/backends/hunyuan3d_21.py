"""Hunyuan3D 2.1 - the 3.3B shape DiT, shape only (`hy3dshape`), never `hy3dpaint`.

Separate from backends/hunyuan3d_mini.py because 2.1 is a *different repository*
with a different package: `Tencent-Hunyuan/Hunyuan3D-2.1`, cloned to
~/.local-mesh/repos/Hunyuan3D-2.1, whose importable package sits one level down
at `<clone>/hy3dshape/hy3dshape`. manifest.json therefore gives that repo entry
`"subdir": "hy3dshape"` and worker.py puts `<clone>/hy3dshape` on sys.path, which
is exactly what upstream's own README does (`sys.path.insert(0, './hy3dshape')`).

Layout facts, verified against the HF tree and hy3dshape/pipelines.py:

* `hunyuan3d-dit-v2-1/` holds `config.yaml` and `model.fp16.ckpt` (7.37 GB) and
  **no safetensors at all** - hence `use_safetensors=False`, the default. The
  load is `torch.load(..., weights_only=True)`, so the .ckpt is not an arbitrary
  pickle; torch >= 2.6's default is already safe and no allowlist is needed.
* As in 2.0, that one checkpoint carries the DiT, the VAE and the DINOv2
  conditioner: `from_single_file` splits the state dict by top-level key and
  builds each submodule from the `model:`/`vae:`/`conditioner:` blocks of the
  DiT's own config.yaml. `hunyuan3d-vae-v2-1/` is not needed.
* `smart_load_model` joins the model path onto `$HY3DGEN_MODELS`; os.path.join
  keeps an absolute path, so a local snapshot dir is used as-is and offline.

Precision: only fp16 weights are published. bf16 is never produced by upstream,
and on Pascal the worker upcasts to fp32 when the card can hold it.
"""
from __future__ import annotations

import os
from typing import Any

from .base import Backend as BaseBackend, Cancelled, check_cancel, scan_weight_bytes_fp32

SUBFOLDER = "hunyuan3d-dit-v2-1"

_PCT_CONDITION = 12.0
_PCT_DIFFUSION_START = 18.0
_PCT_DIFFUSION_END = 74.0
_PCT_DECODE = 78.0


class Backend(BaseBackend):
    name = "hunyuan3d_21"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pipeline: Any = None

    @classmethod
    def estimate_fp32_weight_bytes(cls, model_dir: str):
        # 7.37 GB of fp16 -> ~14.7 GB fp32; scan_weight_bytes_fp32 doubles
        # anything with "fp16" in the name, which model.fp16.ckpt has.
        return scan_weight_bytes_fp32(model_dir, include=[SUBFOLDER])

    # -- loading ----------------------------------------------------------

    def load(self) -> None:
        import torch
        from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline

        checkpoint = os.path.join(self.model_dir, SUBFOLDER, "model.fp16.ckpt")
        if not os.path.exists(checkpoint):
            raise FileNotFoundError(
                f"{checkpoint} is missing; re-download the model from the Models view")

        self._release()
        self.log("info", f"loading {SUBFOLDER} from {self.model_dir}")
        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            self.model_dir,
            subfolder=SUBFOLDER,
            use_safetensors=False,   # only .ckpt is published for 2.1
            variant="fp16",          # the only published checkpoint variant
            device=self.device,
            dtype=self.dtype or torch.float16,
        )

        if self.low_vram:
            self._offload_conditioner(pipeline)

        self.pipeline = pipeline

    def _offload_conditioner(self, pipeline) -> None:
        """Park the DINOv2 conditioner on the CPU except while it is running.

        Same trick as the 2.0 backend and for the same reason: 2.1 declares
        `model_cpu_offload_seq` but `Hunyuan3DDiTPipeline` still has no
        `components` dict, so diffusers' `enable_model_cpu_offload` cannot walk
        it. Wrapping `encode_cond` is the two-module equivalent and keeps the
        1024-dim DINOv2 tower (~1.1 GB) off the card for the whole flow-matching
        loop, which is where 2.1's 3.3B DiT needs every byte.
        """
        import torch

        conditioner = pipeline.conditioner
        conditioner.to("cpu")
        original = pipeline.encode_cond

        def encode_cond(image, additional_cond_inputs, do_classifier_free_guidance, dual_guidance):
            conditioner.to(self.device)
            try:
                return original(
                    image=image,
                    additional_cond_inputs=additional_cond_inputs,
                    do_classifier_free_guidance=do_classifier_free_guidance,
                    dual_guidance=dual_guidance,
                )
            finally:
                conditioner.to("cpu")
                if self.device != "cpu":
                    torch.cuda.empty_cache()

        pipeline.encode_cond = encode_cond
        self.log("info", "low VRAM: image conditioner offloaded to CPU between jobs")

    def _release(self) -> None:
        import gc

        self.pipeline = None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass

    def unload(self) -> None:
        self._release()

    # -- generation -------------------------------------------------------

    def generate(self, image, settings: dict, cancel):
        import torch

        if self.pipeline is None:
            raise RuntimeError("Hunyuan3D 2.1 is not loaded")
        check_cancel(cancel)

        steps = max(1, int(settings.get("steps", 50)))
        guidance = float(settings.get("guidance", 5.0))
        octree_resolution = int(settings.get("octreeResolution", 384))
        num_chunks = int(settings.get("numChunks", 8000))
        mc_level = float(settings.get("mcLevel", 0.0))
        box_v = float(settings.get("boxV", 1.01))
        seed = int(settings.get("seed", 0)) & 0x7FFFFFFF
        generator = torch.Generator(device=self.device).manual_seed(seed)

        self.progress(_PCT_CONDITION, "condition", "Encoding image with DINOv2")

        span = _PCT_DIFFUSION_END - _PCT_DIFFUSION_START

        def callback(step_index, _timestep, _outputs):
            done = step_index + 1
            if done >= steps:
                # The VAE decode + marching cubes run after the loop with no
                # hook of their own, so the last step announces the next stage.
                self.progress(_PCT_DECODE, "decode",
                              f"Decoding to a {octree_resolution}³ grid")
            else:
                self.progress(_PCT_DIFFUSION_START + span * done / steps,
                              "diffusion", f"Step {done}/{steps}")

        outputs = self.pipeline(
            image=image,
            num_inference_steps=steps,
            guidance_scale=guidance,
            octree_resolution=octree_resolution,
            num_chunks=num_chunks,
            mc_level=mc_level,
            box_v=box_v,
            # mc_algo=None leaves the VAE on its default MCSurfaceExtractor
            # (skimage marching cubes). Passing 'dmc' would need the real diso
            # CUDA extension, which ../shims/diso deliberately does not provide.
            mc_algo=None,
            generator=generator,
            output_type="trimesh",
            enable_pbar=False,
            callback=callback,
            callback_steps=1,
        )
        check_cancel(cancel)

        mesh = outputs[0] if isinstance(outputs, (list, tuple)) else outputs
        if mesh is None:
            raise RuntimeError(
                "Hunyuan3D 2.1 produced no surface - try a lower mc level or a different seed")
        self.progress(88.0, "decode", f"{len(mesh.faces)} faces")
        return mesh


__all__ = ["Backend", "Cancelled", "SUBFOLDER"]
