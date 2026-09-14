"""Import-only stand-in for `mosaicml-streaming`.

Step1X-3D's package root ends with `from . import data, models, systems`, and
`step1x3d_geometry/data/Objaverse.py` does `from streaming import
StreamingDataLoader` at module scope. That is the *training* dataloader; the
image -> mesh path never touches it, but the import runs regardless. The real
package drags in boto3 / azure-storage / oci / google-cloud-storage, so this
shim satisfies the import instead. Constructing the class raises a clear error.

The worker appends shims/ to the *end* of sys.path, so a real
`pip install mosaicml-streaming` takes precedence.
"""


class _Unavailable:
    def __init__(self, *args, **kwargs):
        raise RuntimeError(
            "mosaicml-streaming is not installed; this is the Local Mesh import shim. "
            "Only Step1X-3D's training dataloaders need it — inference does not."
        )


class StreamingDataLoader(_Unavailable):
    pass


class StreamingDataset(_Unavailable):
    pass


class Stream(_Unavailable):
    pass


__all__ = ["StreamingDataLoader", "StreamingDataset", "Stream"]
