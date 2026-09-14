"""Backend contract shared by every model (PROTOCOL.md, "Backends")."""
from __future__ import annotations

import os
from typing import Any, Callable, Optional

LogFn = Callable[[str, str], None]           # log(level, message)
ProgressFn = Callable[[float, str, str], None]  # progress(pct, stage, message)
CancelFn = Callable[[], bool]


class Cancelled(Exception):
    """Raise from inside generate() to abort cleanly; the worker emits `cancelled`.

    The worker's `progress` callback raises this itself whenever the job has been
    cancelled, so any backend that reports progress from inside a library loop
    (per-step callbacks) is cancellable at each report without extra code.
    """


def check_cancel(cancel: CancelFn) -> None:
    if cancel():
        raise Cancelled()


WEIGHT_EXTENSIONS = (".safetensors", ".ckpt", ".bin", ".pth", ".pt")


def scan_weight_bytes_fp32(model_dir: str, include: Optional[list[str]] = None) -> Optional[int]:
    """Rough fp32 footprint of the weight files under model_dir.

    Files with "fp16"/"bf16" in the name are counted twice (their fp32 size);
    `include` restricts to relative paths containing one of the substrings.
    Returns None when nothing was found so callers can fall back to a default.
    """
    total = 0
    for root, _dirs, files in os.walk(model_dir):
        for name in files:
            if not name.endswith(WEIGHT_EXTENSIONS):
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, model_dir)
            if include and not any(s in rel for s in include):
                continue
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            total += size * 2 if ("fp16" in rel or "bf16" in rel) else size
    return total or None


class Backend:
    """Base class. `dtype` is a torch.dtype when torch is importable, else None."""

    name = "base"

    def __init__(self, model_dir: str, device: str, dtype: Any, low_vram: bool, log: LogFn, progress: ProgressFn):
        self.model_dir = model_dir
        self.device = device
        self.dtype = dtype
        self.low_vram = low_vram
        self.log = log
        self.progress = progress

    @classmethod
    def estimate_fp32_weight_bytes(cls, model_dir: str) -> Optional[int]:
        """Used by the worker to pick fp32 vs fp16 on cards with slow fp16 (Pascal)."""
        return scan_weight_bytes_fp32(model_dir)

    def load(self) -> None:
        raise NotImplementedError

    def generate(self, image, settings: dict, cancel: CancelFn):
        """Return a trimesh.Trimesh. `image` is a PIL RGBA image, background already removed if requested."""
        raise NotImplementedError

    def unload(self) -> None:
        pass
