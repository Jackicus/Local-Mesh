"""Hunyuan3D 2 - shape only (`hy3dgen.shapegen`), never `hy3dgen.texgen`.

Four models share this module, one class each:

    Backend                -> hunyuan3d-2mini-turbo  (0.6B, distilled, ~5 steps)
    Hunyuan3DMiniBackend   -> hunyuan3d-2mini        (0.6B, 30-50 steps)
    Hunyuan3D2TurboBackend -> hunyuan3d-2-turbo      (1.1B, distilled, ~5 steps)
    Hunyuan3D2Backend      -> hunyuan3d-2            (1.1B, 30-50 steps)

They are the same code path down to the checkpoint - identical pipeline class,
clone and requirements file - so a subclass only names the one DiT subfolder it
loads. backends/registry.py maps each model id to the right class.

This used to be two classes reading a `variant` setting, which forced one
download of *both* checkpoints per family. Each model id now pins its own
folder, downloads only that folder, and quotes a size and a step count that are
true of the thing it actually runs.

The repo is cloned to ~/.local-mesh/repos/Hunyuan3D-2 and put on sys.path by
worker.py, so `import hy3dgen` resolves without a pip install.

How the weights are laid out (verified against the HF tree and
hy3dgen/shapegen/utils.py::smart_load_model):

* Each DiT subfolder - `hunyuan3d-dit-v2-mini`, `-mini-turbo`, `-mini-fast` and
  their `-v2-0` counterparts - holds a `config.yaml` and a single
  `model.fp16.safetensors` (~3.8 GB for the mini, ~4.93 GB for the 1.1B).
* That one checkpoint contains the DiT **and** the VAE **and** the DINOv2
  conditioner: `from_single_file` splits the state dict by its top-level key
  prefix and builds the VAE from the `vae:` block of the *DiT's* config.yaml.
  The separate `hunyuan3d-vae-v2-mini*` subfolders are therefore NOT needed for
  generation - they only matter to `enable_flashvdm(replace_vae=True)`, which
  downloads them from the Hub and which this backend never uses.
* `smart_load_model` joins the model path onto `$HY3DGEN_MODELS` - harmless
  here because os.path.join keeps an absolute path, so a local snapshot dir is
  used as-is and nothing touches the network.

Only fp16 checkpoints are published; `variant='fp16'` below selects the *file*,
while `dtype` is the compute precision the weights are cast to on load.
"""
from __future__ import annotations

import fnmatch
import os
from typing import Any, Optional

from .base import Backend as BaseBackend, Cancelled, check_cancel

_PCT_CONDITION = 12.0
_PCT_DIFFUSION_START = 18.0
_PCT_DIFFUSION_END = 74.0
_PCT_DECODE = 78.0


def _subfolder_weight_bytes(model_dir: str, subfolder: str) -> int:
    """fp32 footprint of one DiT subfolder, preferring safetensors over ckpt.

    Both files are published and both may be on disk; counting them together
    would double the estimate.
    """
    directory = os.path.join(model_dir, subfolder)
    if not os.path.isdir(directory):
        return 0
    best = 0
    for extension in (".safetensors", ".ckpt"):
        total = 0
        for name in os.listdir(directory):
            if name.endswith(extension):
                try:
                    total += os.path.getsize(os.path.join(directory, name))
                except OSError:
                    pass
        if total:
            best = total
            break
    return best * 2  # fp16 on disk -> fp32 in memory


def _sibling_subfolders(model_dir: str, glob: str) -> list[str]:
    """Checkpoint folders of the same family that are actually on disk."""
    try:
        names = sorted(os.listdir(model_dir))
    except OSError:
        return []
    return [
        name for name in names
        if fnmatch.fnmatch(name, glob) and os.path.isdir(os.path.join(model_dir, name))
    ]


class Backend(BaseBackend):
    """hunyuan3d-2mini-turbo - the distilled 0.6B checkpoint."""

    name = "hunyuan3d_mini_turbo"
    # The one DiT folder this model id is; every subclass names its own.
    subfolder_name = "hunyuan3d-dit-v2-mini-turbo"
    # Its siblings in the same repo, for the "you downloaded the other one"
    # fallback below and for the load-time memory estimate. Only the 1.1B pair
    # overrides this.
    subfolder_glob = "hunyuan3d-dit-v2-mini*"
    # What this checkpoint is tuned for, and the registry's `steps` default.
    # Only there so a job that arrives without settings still runs sensibly.
    default_steps = 5

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pipeline: Any = None
        self.subfolder: Optional[str] = None

    @classmethod
    def estimate_fp32_weight_bytes(cls, model_dir: str) -> Optional[int]:
        pinned = _subfolder_weight_bytes(model_dir, cls.subfolder_name)
        if pinned:
            return pinned
        # The pinned folder is missing, so load() will fall back to a sibling;
        # size the largest one rather than reporting nothing.
        sizes = [_subfolder_weight_bytes(model_dir, name)
                 for name in _sibling_subfolders(model_dir, cls.subfolder_glob)]
        largest = max(sizes) if sizes else 0
        return largest or None

    # -- loading ----------------------------------------------------------

    def _resolve_subfolder(self) -> str:
        """The pinned checkpoint folder, or the best sibling that is on disk.

        A model installed before turbo and standard became separate entries has
        both folders under the *other* id's directory, and an interrupted
        download can leave the wrong one behind. Running the sibling is a much
        better outcome than refusing to load, so long as the log says plainly
        that this is not the model that was asked for.
        """
        wanted = self.subfolder_name
        if os.path.isdir(os.path.join(self.model_dir, wanted)):
            return wanted
        for name in _sibling_subfolders(self.model_dir, self.subfolder_glob):
            self.log("warn", f"{wanted} is not downloaded, falling back to {name}; "
                             "re-download the model from the Models view to get the one you chose")
            return name
        raise FileNotFoundError(
            f"no {self.subfolder_glob} subfolder under {self.model_dir}; "
            "re-download the model from the Models view")

    def _build(self, subfolder: str) -> None:
        import torch
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

        self._release()
        self.log("info", f"weights subfolder: {subfolder}")
        pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            self.model_dir,
            subfolder=subfolder,
            use_safetensors=True,
            variant="fp16",          # the only published checkpoint variant
            device=self.device,
            dtype=self.dtype or torch.float16,
        )

        if self.low_vram:
            if hasattr(pipeline, "enable_flashvdm"):
                try:
                    # replace_vae=True would fetch hunyuan3d-vae-v2-mini-turbo from
                    # the Hub; mc_algo='mc' keeps us off the DMC path (needs diso).
                    pipeline.enable_flashvdm(enabled=True, mc_algo="mc", replace_vae=False)
                    self.log("info", "FlashVDM decoding enabled")
                except Exception as exc:  # noqa: BLE001
                    self.log("warn", f"could not enable FlashVDM: {exc}")
            self._offload_conditioner(pipeline)

        self.pipeline = pipeline
        self.subfolder = subfolder

    def _offload_conditioner(self, pipeline) -> None:
        """Park the DINOv2 conditioner on the CPU except while it is running.

        `enable_model_cpu_offload` is unusable here: it walks `self.components`,
        which Hunyuan3DDiTPipeline never defines. Wrapping `encode_cond` is the
        equivalent for a two-module pipeline and keeps ~2 GB off the card for
        the whole diffusion loop.
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
        self.subfolder = None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass

    def load(self) -> None:
        self._build(self._resolve_subfolder())

    def unload(self) -> None:
        self._release()

    # -- generation -------------------------------------------------------

    def generate(self, image, settings: dict, cancel):
        import torch

        subfolder = self._resolve_subfolder()
        if self.pipeline is None or subfolder != self.subfolder:
            self.progress(9.0, "load", f"Loading {subfolder}")
            self._build(subfolder)
        check_cancel(cancel)

        steps = max(1, int(settings.get("steps", self.default_steps)))
        guidance = float(settings.get("guidance", 5.0))
        octree_resolution = int(settings.get("octreeResolution", 256))
        num_chunks = int(settings.get("numChunks", 8000))
        mc_level = float(settings.get("mcLevel", 0.0))
        seed = int(settings.get("seed", 0)) & 0x7FFFFFFF
        generator = torch.Generator(device=self.device).manual_seed(seed)

        self.progress(_PCT_CONDITION, "condition", "Encoding image")

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
                "Hunyuan3D produced no surface - try a lower mc level or a different seed")
        self.progress(88.0, "decode", f"{len(mesh.faces)} faces")
        return mesh


class Hunyuan3DMiniBackend(Backend):
    """hunyuan3d-2mini - the undistilled 0.6B checkpoint.

    Same repo and same ~3.8 GB checkpoint shape as the turbo above; it simply
    was not distilled, so it wants 30-50 steps instead of 5.
    """

    name = "hunyuan3d_mini"
    subfolder_name = "hunyuan3d-dit-v2-mini"
    default_steps = 30


class Hunyuan3D2TurboBackend(Backend):
    """hunyuan3d-2-turbo - the distilled 1.1B checkpoint, `tencent/Hunyuan3D-2`.

    Only the DiT subfolder names differ from the mini: `hunyuan3d-dit-v2-0*`,
    each a single ~4.93 GB fp16 checkpoint that again carries the VAE and the
    DINOv2 conditioner inside it. Same clone (repos/Hunyuan3D-2), same
    requirements file, same conditioner offload.
    """

    name = "hunyuan3d_2_turbo"
    subfolder_name = "hunyuan3d-dit-v2-0-turbo"
    subfolder_glob = "hunyuan3d-dit-v2-0*"


class Hunyuan3D2Backend(Hunyuan3D2TurboBackend):
    """hunyuan3d-2 - the undistilled 1.1B checkpoint."""

    name = "hunyuan3d_2"
    subfolder_name = "hunyuan3d-dit-v2-0"
    default_steps = 30


__all__ = [
    "Backend",
    "Hunyuan3DMiniBackend",
    "Hunyuan3D2TurboBackend",
    "Hunyuan3D2Backend",
    "Cancelled",
]
