"""Import-only stand-in for `open3d`.

`trellis/pipelines/__init__.py` imports both pipelines, and the *text*-to-3D one
starts with `import open3d as o3d` and then uses `o3d.geometry.TriangleMesh` in
method annotations — which Python evaluates at class-definition time. So
`from trellis.pipelines import TrellisImageTo3DPipeline` cannot even import
without the name resolving, despite the image pipeline never touching open3d.

The real wheel is ~400 MB of render/IO machinery we would never call, so this
shim provides just enough surface for the annotations and for a clear failure if
anything actually tries to use it.

The worker appends shims/ to the *end* of sys.path, so a real `pip install
open3d` takes precedence.
"""

_MESSAGE = (
    "open3d is not installed; this is the Local Mesh import shim. "
    "Only TRELLIS's text-to-3D pipeline uses it, and Local Mesh is image-to-3D only."
)


def _refuse(*args, **kwargs):
    raise RuntimeError(_MESSAGE)


class _Unavailable:
    """A stand-in type: fine to name, impossible to construct or call into."""

    def __init__(self, *args, **kwargs):
        raise RuntimeError(_MESSAGE)

    def __getattr__(self, name):
        raise RuntimeError(_MESSAGE)

    def __class_getitem__(cls, item):
        return cls


class _UnavailableMeta(type):
    """Factory classmethods (`VoxelGrid.create_from_triangle_mesh_within_bounds`
    and friends) are reached on the *class*, so unknown class attributes resolve
    to the same refusal rather than an AttributeError."""

    def __getattr__(cls, name):
        if name.startswith("__"):
            raise AttributeError(name)
        return _refuse


class _Namespace:
    """Any attribute access yields a class that refuses to be used.

    Open-ended on purpose: the point is that every `o3d.<anything>` a module
    mentions at import time resolves, without this shim having to track open3d's
    API surface.
    """

    def __init__(self, name):
        self.__name__ = name
        self._cache = {}

    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        if name not in self._cache:
            self._cache[name] = _UnavailableMeta(name, (_Unavailable,), {})
        return self._cache[name]


geometry = _Namespace("open3d.geometry")
utility = _Namespace("open3d.utility")
io = _Namespace("open3d.io")
visualization = _Namespace("open3d.visualization")
t = _Namespace("open3d.t")

__version__ = "0.0.0+localmesh-shim"
__all__ = ["geometry", "utility", "io", "visualization", "t"]
