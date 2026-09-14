"""`kaolin.utils.testing.check_tensor` — the one kaolin symbol FlexiCubes needs.

Semantics copied from kaolin's own implementation: every criterion is optional
(None = don't care), a `shape` entry of None matches any size on that axis, and
`throw` chooses between raising a ValueError and returning False. FlexiCubes
always passes `throw=False` inside an `assert`, so a wrong shape still produces
upstream's own assertion message.
"""
from __future__ import annotations

from typing import Optional, Sequence


def check_tensor(
    tensor,
    shape: Optional[Sequence[Optional[int]]] = None,
    dtype=None,
    device=None,
    throw: bool = True,
) -> bool:
    """True when `tensor` matches every non-None criterion."""

    def fail(message: str) -> bool:
        if throw:
            raise ValueError(message)
        return False

    if shape is not None:
        if tensor.ndim != len(shape):
            return fail(
                f"tensor has {tensor.ndim} dimensions, expected {len(shape)} "
                f"(shape {tuple(tensor.shape)} vs {tuple(shape)})"
            )
        for axis, expected in enumerate(shape):
            if expected is not None and tensor.shape[axis] != expected:
                return fail(
                    f"tensor has shape {tuple(tensor.shape)}, expected {tuple(shape)}"
                )

    if dtype is not None:
        allowed = dtype if isinstance(dtype, (list, tuple)) else (dtype,)
        if tensor.dtype not in allowed:
            return fail(f"tensor has dtype {tensor.dtype}, expected one of {allowed}")

    if device is not None:
        allowed = device if isinstance(device, (list, tuple)) else (device,)
        if str(tensor.device).split(":")[0] not in [str(d).split(":")[0] for d in allowed]:
            return fail(f"tensor is on device {tensor.device}, expected one of {allowed}")

    return True


def check_spc_tensors(*args, **kwargs):  # pragma: no cover - not used by TRELLIS
    raise NotImplementedError("kaolin shim: only check_tensor is implemented")


__all__ = ["check_tensor"]
