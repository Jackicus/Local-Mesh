"""Minimal stand-in for NVIDIA `kaolin` — only `kaolin.utils.testing.check_tensor`.

TRELLIS vendors FlexiCubes as a git submodule, and
`trellis/representations/mesh/flexicubes/flexicubes.py` opens with
`from kaolin.utils.testing import check_tensor`. That is the *whole* of kaolin's
involvement in the mesh path: six shape assertions at the top of
`FlexiCubes.__call__`, all called with `throw=False`. Everything else in the
FlexiCubes file is plain torch.

kaolin itself is a CUDA extension published only on NVIDIA's own wheel index,
pinned per torch version, so installing it would undo the point of the no-source-
build rule. `check_tensor` is reimplemented faithfully below instead.

The worker appends shims/ to the *end* of sys.path, so a real kaolin install
takes precedence.
"""

from . import utils  # noqa: F401  (so `import kaolin` exposes kaolin.utils)

__version__ = "0.0.0+localmesh-shim"
__all__ = ["utils"]
