"""TripoSR - single-pass triplane reconstruction (stabilityai/TripoSR).

The repo is cloned to ~/.local-mesh/repos/TripoSR and put on sys.path by
worker.py. `tsr/models/isosurface.py` does `from torchmcubes import
marching_cubes` at import time; the real package is a CUDA extension that needs
nvcc, so ../shims/torchmcubes stands in for it (appended to sys.path, so a real
install still wins).

Preprocessing mirrors run.py: the RGBA cut-out is cropped to its alpha bounding
box, padded to a square, padded again to `foregroundRatio`, then composited over
mid-grey (0.5) - the network was trained on grey-backed inputs, so white or
black here visibly degrades the result.

Everything runs in fp32: the checkpoint is fp32 (~1.7 GB) and the triplane
renderer accumulates densities that overflow in fp16.

Two things about the image tokenizer need fixing up at load time:

1. `config.yaml` points it at the Hub repo "facebook/dino-vitb16", which
   `DINOSingleImageTokenizer.configure` resolves with `hf_hub_download`. The
   worker runs with HF_HUB_OFFLINE=1, so that raises LocalEntryNotFoundError on
   a machine that has never downloaded the encoder. The weights step fetches
   that repo into `<model_dir>/dino-vitb16` and `load()` points the tokenizer
   there (`_write_local_config`, `_allow_local_hub_dirs`).
2. model.ckpt is a 2024 checkpoint whose ViT weights use the old transformers
   module layout. transformers 5 renamed those submodules, so a strict
   `load_state_dict` fails against a current install (`_migrate_vit_keys`).
"""
from __future__ import annotations

import os
import re
from typing import Any, Optional

import numpy as np

from .base import Backend as BaseBackend, check_cancel, scan_weight_bytes_fp32

#: Subdirectory of the model dir the weights step puts facebook/dino-vitb16 in
#: (`extraRepos` in src/core/models.ts).
DINO_DIR = "dino-vitb16"
#: Written next to config.yaml with the tokenizer path patched to DINO_DIR.
LOCAL_CONFIG = "config.local.yaml"

#: transformers 5 flattened ViTModel: `encoder.layer.N.*` became `layers.N.*`
#: and the projections inside each layer were renamed. The order matters —
#: "attention.output.dense" has to win over the bare "output.dense".
_VIT_RENAMES = (
    ("attention.attention.query", "attention.q_proj"),
    ("attention.attention.key", "attention.k_proj"),
    ("attention.attention.value", "attention.v_proj"),
    ("attention.output.dense", "attention.o_proj"),
    ("intermediate.dense", "mlp.fc1"),
    ("output.dense", "mlp.fc2"),
)
_VIT_PREFIX = "image_tokenizer.model."
_VIT_LEGACY_LAYER = re.compile(rf"^{re.escape(_VIT_PREFIX)}encoder\.layer\.(\d+)\.")


def _migrate_vit_key(key: str) -> str:
    match = _VIT_LEGACY_LAYER.match(key)
    if not match:
        return key
    tail = key[match.end():]
    for old, new in _VIT_RENAMES:
        if tail.startswith(old):
            tail = new + tail[len(old):]
            break
    return f"{_VIT_PREFIX}layers.{match.group(1)}.{tail}"


def _migrate_vit_keys(model: Any, state: dict) -> dict:
    """Rename the checkpoint's ViT keys when the installed transformers wants the new ones.

    Everything outside the encoder layers (embeddings, final layernorm, pooler)
    kept its name across the refactor, so only `encoder.layer.N.*` moves. Left
    untouched on transformers 4.x, where the checkpoint already matches.
    """
    if not any(k.startswith(f"{_VIT_PREFIX}encoder.layer.") for k in state):
        return state
    if not any(k.startswith(f"{_VIT_PREFIX}layers.") for k in model.state_dict()):
        return state
    return {_migrate_vit_key(k): v for k, v in state.items()}


def resize_foreground(image, ratio: float):
    """run.py's tsr.utils.resize_foreground, without the repo import."""
    from PIL import Image

    array = np.array(image)
    if array.shape[-1] != 4:
        raise ValueError("TripoSR preprocessing needs an RGBA image")
    alpha = np.where(array[..., 3] > 0)
    if alpha[0].size == 0:
        raise ValueError("the image is fully transparent after background removal")
    y1, y2 = alpha[0].min(), alpha[0].max()
    x1, x2 = alpha[1].min(), alpha[1].max()
    foreground = array[y1:y2, x1:x2]

    size = max(foreground.shape[0], foreground.shape[1])
    ph0, pw0 = (size - foreground.shape[0]) // 2, (size - foreground.shape[1]) // 2
    ph1, pw1 = size - foreground.shape[0] - ph0, size - foreground.shape[1] - pw0
    padded = np.pad(foreground, ((ph0, ph1), (pw0, pw1), (0, 0)), mode="constant")

    new_size = int(padded.shape[0] / max(0.05, ratio))
    ph0, pw0 = (new_size - size) // 2, (new_size - size) // 2
    ph1, pw1 = new_size - size - ph0, new_size - size - pw0
    padded = np.pad(padded, ((ph0, ph1), (pw0, pw1), (0, 0)), mode="constant")
    return Image.fromarray(padded)


def to_grey_rgb(image):
    """Composite RGBA over 0.5 grey, exactly as run.py does."""
    from PIL import Image

    array = np.array(image).astype(np.float32) / 255.0
    array = array[:, :, :3] * array[:, :, 3:4] + (1 - array[:, :, 3:4]) * 0.5
    return Image.fromarray((array * 255.0).astype(np.uint8))


class Backend(BaseBackend):
    name = "triposr"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model: Any = None
        self._chunk_size: Optional[int] = None

    @classmethod
    def estimate_fp32_weight_bytes(cls, model_dir: str) -> Optional[int]:
        # model.ckpt is already fp32, so its size on disk is the footprint.
        return scan_weight_bytes_fp32(model_dir, include=["model.ckpt"])

    def _write_local_config(self, config: str) -> str:
        """Copy config.yaml with the DINO encoder pointed at the local snapshot.

        Interpolations such as ${tokenizer.num_channels} survive because
        OmegaConf.save does not resolve by default; TSR.from_pretrained resolves
        after loading, exactly as it would with the original file.
        """
        from omegaconf import OmegaConf

        cfg = OmegaConf.load(config)
        dino_dir = os.path.join(self.model_dir, DINO_DIR)
        if not os.path.isdir(dino_dir):
            self.log("warn",
                     f"{DINO_DIR}/ is missing from {self.model_dir}; TripoSR will try to fetch "
                     "facebook/dino-vitb16 from the Hub, which fails while the worker is offline. "
                     "Re-download the model from the Models view.")
            return os.path.basename(config)
        cfg.image_tokenizer.pretrained_model_name_or_path = dino_dir
        local = os.path.join(self.model_dir, LOCAL_CONFIG)
        OmegaConf.save(cfg, local)
        self.log("debug", f"DINO image encoder resolved to {dino_dir}")
        return LOCAL_CONFIG

    @staticmethod
    def _allow_local_hub_dirs() -> None:
        """Let the DINO tokenizer accept a directory where it expects a repo id.

        `tsr/models/tokenizers/image.py` reads the encoder config with
        `hf_hub_download(repo_id=cfg.pretrained_model_name_or_path, ...)`, which
        rejects a filesystem path outright (HFValidationError), so pointing the
        config at a local directory is not enough on its own. Wrap that module's
        reference so a directory short-circuits to the file inside it; anything
        that still looks like a repo id goes to the real function.
        """
        from tsr.models.tokenizers import image as tsr_image

        if getattr(tsr_image.hf_hub_download, "_local_mesh_patched", False):
            return
        upstream = tsr_image.hf_hub_download

        def hf_hub_download(repo_id: str, filename: str, **kwargs):
            if isinstance(repo_id, str) and os.path.isdir(repo_id):
                local = os.path.join(repo_id, filename)
                if os.path.exists(local):
                    return local
            return upstream(repo_id=repo_id, filename=filename, **kwargs)

        hf_hub_download._local_mesh_patched = True  # type: ignore[attr-defined]
        tsr_image.hf_hub_download = hf_hub_download

    @staticmethod
    def _tsr_class() -> Any:
        """TSR with the ViT key migration spliced into its state-dict load.

        `TSR.from_pretrained` builds the model with `cls(cfg)` and calls
        `load_state_dict` on it, so a subclass is enough — no patching of the
        repo's own module.
        """
        from tsr.system import TSR

        class MigratingTSR(TSR):
            def load_state_dict(self, state_dict, *args, **kwargs):
                return super().load_state_dict(
                    _migrate_vit_keys(self, state_dict), *args, **kwargs
                )

        return MigratingTSR

    def load(self) -> None:
        config = os.path.join(self.model_dir, "config.yaml")
        weights = os.path.join(self.model_dir, "model.ckpt")
        for path in (config, weights):
            if not os.path.exists(path):
                raise FileNotFoundError(
                    f"{os.path.basename(path)} is missing from {self.model_dir}; "
                    "re-download the model from the Models view")

        self._allow_local_hub_dirs()
        config_name = self._write_local_config(config)

        self.log("info", f"loading TripoSR from {self.model_dir}")
        model = self._tsr_class().from_pretrained(
            self.model_dir, config_name=config_name, weight_name="model.ckpt"
        )
        model.to(self.device)
        model.eval()
        self.model = model
        self._chunk_size = None

        import torch

        if self.dtype is not None and self.dtype is not torch.float32:
            self.log("info", "TripoSR always runs in fp32; the precision setting is ignored")

    def unload(self) -> None:
        self.model = None
        self._chunk_size = None

    def generate(self, image, settings: dict, cancel):
        import torch

        if self.model is None:
            raise RuntimeError("TripoSR is not loaded")

        chunk_size = int(settings.get("chunkSize", 8192))
        if chunk_size != self._chunk_size:
            self.model.renderer.set_chunk_size(chunk_size)
            self._chunk_size = chunk_size
        resolution = int(settings.get("mcResolution", 256))
        ratio = float(settings.get("foregroundRatio", 0.85))
        # TripoSR is a single deterministic forward pass - there is nothing to seed.
        self.log("debug", "TripoSR is deterministic; the seed setting has no effect")

        self.progress(10.0, "prepare", f"Framing foreground at {ratio:.2f}")
        prepared = to_grey_rgb(resize_foreground(image, ratio))
        check_cancel(cancel)

        self.progress(20.0, "condition", "Encoding image to triplanes")
        with torch.no_grad():
            scene_codes = self.model([prepared], device=self.device)
        check_cancel(cancel)

        self.progress(55.0, "decode", f"Marching cubes at {resolution}³")
        meshes = self.model.extract_mesh(
            scene_codes, has_vertex_color=False, resolution=resolution
        )
        check_cancel(cancel)

        mesh = meshes[0]
        if mesh is None or len(mesh.faces) == 0:
            raise RuntimeError(
                "TripoSR produced an empty mesh - the subject may be too small in frame; "
                "try a higher foreground ratio")
        self.progress(88.0, "decode", f"{len(mesh.faces)} faces")
        return mesh
