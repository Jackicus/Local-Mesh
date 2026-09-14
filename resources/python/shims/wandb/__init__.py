"""Import-only stand-in for `wandb` (Weights & Biases experiment tracking).

Step1X-3D's `step1x3d_geometry/systems/base.py` imports `utils.saving`, which
does a bare `import wandb` at module scope — and `systems` is imported by the
package root, so `import step1x3d_geometry` (which the pipeline module does)
fails without it. Every actual `wandb.log(...)` call sits inside a training
callback that inference never reaches, so nothing here needs to work; it only
needs to import. Local Mesh is offline by design and has no business talking to
an experiment tracker.

The worker appends shims/ to the *end* of sys.path, so a real `pip install
wandb` takes precedence.
"""

_MESSAGE = (
    "wandb is not installed; this is the Local Mesh import shim. "
    "Only Step1X-3D's training loop logs to Weights & Biases."
)


class _Unavailable:
    def __init__(self, *args, **kwargs):
        raise RuntimeError(_MESSAGE)


class Image(_Unavailable):
    pass


class Video(_Unavailable):
    pass


class Table(_Unavailable):
    pass


class Object3D(_Unavailable):
    pass


def log(*args, **kwargs):
    raise RuntimeError(_MESSAGE)


def init(*args, **kwargs):
    raise RuntimeError(_MESSAGE)


def finish(*args, **kwargs):
    return None


run = None

__all__ = ["Image", "Video", "Table", "Object3D", "log", "init", "finish", "run"]
