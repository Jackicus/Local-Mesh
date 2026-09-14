"""Import-only stand-in for `diso` (differentiable iso-surface extraction).

TripoSG's triposg/inference_utils.py does `from diso import DiffDMC` at module
level, and Hunyuan3D's DMC surface extractor imports it lazily. The real package
is a CUDA extension shipped as sdist only (needs nvcc), so this shim lets the
modules import; the backends never call the flash/DMC decoders (they use the
hierarchical + marching-cubes paths instead). Instantiating either class raises
a clear error. A real `pip install diso` takes precedence because the worker
appends this directory to the *end* of sys.path.
"""


class _Unavailable:
    def __init__(self, *args, **kwargs):
        raise RuntimeError(
            "diso (DiffDMC/DiffMC) is not installed; this is the Local Mesh import shim. "
            "Install the real package with a CUDA toolkit, or keep using the marching-cubes decoder."
        )


class DiffDMC(_Unavailable):
    pass


class DiffMC(_Unavailable):
    pass


__all__ = ["DiffDMC", "DiffMC"]
