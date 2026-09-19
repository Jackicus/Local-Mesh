#!/usr/bin/env python3
"""Long-lived model worker: JSON commands on stdin, JSON events on stdout.

See PROTOCOL.md for the wire format and src/core/generation.ts for the
TypeScript mirror. Run it by hand with:

    echo '{"cmd":"ping"}' | python -u worker.py

Design notes that are easy to get wrong:

* The real stdout is captured once at import and `sys.stdout` is pointed at
  stderr, so a library that prints (and several of them do) can never corrupt
  the event stream.
* stdin is drained by a reader thread. Commands go on a queue processed
  sequentially by the main thread; `cancel` is applied to a shared set straight
  from the reader thread, which is what makes it visible mid-`generate`.
* torch is imported lazily and its absence is tolerated - the mock backend has
  to work in a venv with nothing but trimesh/numpy/pillow.
"""
from __future__ import annotations

import gc
import json
import os
import platform
import queue
import signal
import sys
import threading
import time
import traceback
from typing import Any, Optional

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
SHIMS_DIR = os.path.join(SCRIPTS_DIR, "shims")
LOCAL_MESH_HOME = os.path.abspath(
    os.path.expanduser(os.environ.get("LOCAL_MESH_HOME", "~/.local-mesh"))
)
REPOS_DIR = os.path.join(LOCAL_MESH_HOME, "repos")

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from backends.base import Cancelled  # noqa: E402  (needs SCRIPTS_DIR on sys.path)
from backends import registry  # noqa: E402

# Shims lose to a real install: they are appended, never inserted.
if SHIMS_DIR not in sys.path:
    sys.path.append(SHIMS_DIR)

STDOUT = sys.stdout
sys.stdout = sys.stderr

_emit_lock = threading.Lock()
_cancelled_jobs: set[str] = set()
_commands: "queue.Queue[Optional[dict]]" = queue.Queue()

_torch_module: Any = None
_torch_checked = False
_rembg_session: Any = None

# The backend callbacks are built once at load time but have to tag their events
# with whichever job is running now, so the id lives in one mutable cell rather
# than being baked into a closure.
_current_job_id = ""

STAGE_PREPARE_END = 8.0
STAGE_POST_START = 90.0
STAGE_POST_END = 96.0


# ---------------------------------------------------------------------------
# Event stream
# ---------------------------------------------------------------------------

def emit(payload: dict) -> None:
    with _emit_lock:
        STDOUT.write(json.dumps(payload, default=str) + "\n")
        STDOUT.flush()


def log(level: str, message: str, job_id: Optional[str] = None) -> None:
    event = {"event": "log", "level": level, "message": message}
    if job_id:
        event["job_id"] = job_id
    emit(event)


def backend_log(level: str, message: str) -> None:
    log(level, message, _current_job_id or None)


def backend_progress(pct: float, stage: str, message: str) -> None:
    """Backend-facing progress callback.

    Doubles as the cancellation point: PROTOCOL.md promises that a backend which
    reports progress from inside a library loop is cancellable at every report.
    """
    if _current_job_id and _current_job_id in _cancelled_jobs:
        raise Cancelled()
    emit({"event": "progress", "job_id": _current_job_id,
          "pct": max(0.0, min(100.0, float(pct))), "stage": stage, "message": message})


def emit_error(message: str, job_id: Optional[str] = None, tb: Optional[str] = None,
               oom: bool = False, request_id: Optional[str] = None) -> None:
    event: dict = {"event": "error", "message": message}
    if job_id:
        event["job_id"] = job_id
    if request_id:
        event["request_id"] = request_id
    if tb:
        event["traceback"] = tb
    if oom:
        event["oom"] = True
    emit(event)


# ---------------------------------------------------------------------------
# torch / memory
# ---------------------------------------------------------------------------

def torch_module():
    """Import torch once; return None when it isn't installed."""
    global _torch_module, _torch_checked
    if not _torch_checked:
        _torch_checked = True
        try:
            import torch  # noqa: PLC0415

            _torch_module = torch
        except Exception as exc:  # noqa: BLE001
            _torch_module = None
            log("warn", f"torch could not be imported ({exc}); only the mock backend will work. "
                        "Re-run Setup in the Models view.")
    return _torch_module


def cuda_available() -> bool:
    torch = torch_module()
    try:
        return bool(torch is not None and torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        return False


def memory_stats() -> dict:
    vram_used = vram_total = None
    if cuda_available():
        torch = torch_module()
        try:
            free, total = torch.cuda.mem_get_info()
            vram_used, vram_total = int(total - free), int(total)
        except Exception:  # noqa: BLE001
            pass
    ram_used = None
    try:
        import psutil  # noqa: PLC0415

        ram_used = int(psutil.Process(os.getpid()).memory_info().rss)
    except Exception:  # noqa: BLE001
        pass
    return {"event": "memory", "vram_used": vram_used, "vram_total": vram_total, "ram_used": ram_used}


def emit_memory() -> None:
    emit(memory_stats())


def free_cuda() -> None:
    gc.collect()
    if cuda_available():
        try:
            torch_module().cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass


def is_oom(exc: BaseException) -> bool:
    torch = _torch_module
    oom_cls = getattr(torch, "OutOfMemoryError", None) if torch is not None else None
    if oom_cls is not None and isinstance(exc, oom_cls):
        return True
    text = str(exc).lower()
    return "out of memory" in text or "cuda error: out of memory" in text


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

class LoadedModel:
    def __init__(self, model_id: str, backend: Any, device: str, dtype: Any):
        self.model_id = model_id
        self.backend = backend
        self.device = device
        self.dtype = dtype


_model: Optional[LoadedModel] = None


def manifest() -> dict:
    path = os.path.join(SCRIPTS_DIR, "manifest.json")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:  # noqa: BLE001
        log("warn", f"could not read manifest.json ({exc}); backends that need a repo clone "
                    "on sys.path will fail to import")
        return {}


def add_repo_paths(model_id: str) -> None:
    """Put every `pipInstall: false` repo clone for this model on sys.path.

    A repo whose importable package is not at the clone root carries a `subdir`
    in the manifest (Hunyuan3D-2.1 keeps `hy3dshape` one level down, and
    upstream's own README does `sys.path.insert(0, './hy3dshape')`); that
    subdirectory goes on the path instead of the clone root.
    """
    entry = (manifest().get("models") or {}).get(model_id) or {}
    for repo in entry.get("repos") or []:
        if repo.get("pipInstall"):
            continue  # installed into the venv with `pip install -e`
        path = os.path.join(REPOS_DIR, repo.get("dir", ""))
        subdir = repo.get("subdir")
        if subdir:
            path = os.path.join(path, subdir)
        if not os.path.isdir(path):
            log("warn", f"{repo.get('dir', '?')} is not cloned under repos/; reinstall this model's "
                        "dependencies from the Models view or it will fail to import")
            continue
        if path not in sys.path:
            sys.path.insert(1, path)
            log("debug", f"sys.path += {path}")


def resolve_device(preference: str) -> str:
    if preference == "cpu":
        return "cpu"
    if preference == "cuda":
        if not cuda_available():
            raise RuntimeError("device 'cuda' was requested but torch reports no CUDA device")
        return "cuda"
    return "cuda" if cuda_available() else "cpu"


def resolve_dtype(precision: str, device: str, backend_cls: Any, model_dir: str):
    """fp16 vs fp32.

    Pascal (compute capability < 7.0) has no tensor cores and runs fp16 math at
    a fraction of fp32, so fp32 is the faster choice there *when the weights
    still fit*: the published checkpoints are fp16, we upcast on load. bf16 is
    never used - Pascal has no hardware for it at all.
    """
    torch = torch_module()
    if torch is None:
        return None
    if device == "cpu":
        return torch.float32
    if precision == "fp16":
        return torch.float16
    if precision == "fp32":
        return torch.float32

    try:
        major, _minor = torch.cuda.get_device_capability()
    except Exception:  # noqa: BLE001
        major = 0
    if major >= 7:
        return torch.float16

    try:
        weights = backend_cls.estimate_fp32_weight_bytes(model_dir)
    except Exception as exc:  # noqa: BLE001
        log("debug", f"weight estimate failed: {exc}")
        weights = None
    if weights is None:
        log("info", "could not size the weights on disk, so defaulting to fp16 on this pre-Volta card; "
                    "set precision to fp32 in Settings if it fits and you want the speed")
        return torch.float16

    try:
        _free, total = torch.cuda.mem_get_info()
    except Exception:  # noqa: BLE001
        return torch.float16
    budget = 0.6 * total
    if weights <= budget:
        log("info",
            f"fp32 on a pre-Volta GPU: weights ~{weights / 1e9:.2f} GB fit in "
            f"{budget / 1e9:.2f} GB of the {total / 1e9:.2f} GB card, and fp16 math is slow here")
        return torch.float32
    log("info",
        f"fp16: fp32 weights (~{weights / 1e9:.2f} GB) exceed the "
        f"{budget / 1e9:.2f} GB budget on a {total / 1e9:.2f} GB card. "
        "Expect fp16 arithmetic to be slow on Pascal.")
    return torch.float16


def do_unload(announce: bool = True) -> None:
    global _model
    if _model is not None:
        model_id = _model.model_id
        try:
            _model.backend.unload()
        except Exception as exc:  # noqa: BLE001
            log("warn", f"{model_id} raised while unloading ({exc}); its VRAM may not come back "
                        "until the worker restarts")
        _model = None
    free_cuda()
    if announce:
        emit({"event": "unloaded"})
        emit_memory()


def do_load(cmd: dict) -> None:
    global _model, _current_job_id
    _current_job_id = ""  # a load is not owned by a job; see PROTOCOL.md
    model_id = cmd["model_id"]
    model_dir = os.path.abspath(os.path.expanduser(cmd.get("model_dir") or ""))
    started = time.monotonic()

    # Unconditionally, even for the same id: a reload (new precision, or a retry
    # after main timed out on a load that actually succeeded) must not hold two
    # copies of the weights on the card while the new one builds. Only the
    # Hunyuan backends release themselves first; the rest do not.
    if _model is not None:
        do_unload(announce=False)

    backend_name = registry.backend_name_for(model_id)
    add_repo_paths(model_id)
    backend_cls = registry.load_backend_class(backend_name)

    device = resolve_device(cmd.get("device", "auto"))
    dtype = resolve_dtype(cmd.get("precision", "auto"), device, backend_cls, model_dir)
    low_vram = bool(cmd.get("low_vram", False))

    backend_progress(0.0, "load", f"Loading {model_id}")
    log("info", f"loading {model_id} via backends/{backend_name}.py "
                f"(device {device}, dtype {getattr(dtype, 'name', dtype)}, low-vram {low_vram})")
    log("debug", f"weights directory: {model_dir}")

    backend = backend_cls(model_dir, device, dtype, low_vram, backend_log, backend_progress)
    try:
        backend.load()
    except BaseException:
        # A half-built pipeline (very likely on an OOM part-way through) still
        # holds VRAM until it is dropped; the caller only sees the error.
        try:
            backend.unload()
        except Exception as exc:  # noqa: BLE001
            log("debug", f"cleanup after a failed load raised: {exc}")
        del backend
        free_cuda()
        emit_memory()
        raise
    _model = LoadedModel(model_id, backend, device, dtype)

    emit({"event": "loaded", "model_id": model_id,
          "duration_ms": int((time.monotonic() - started) * 1000)})
    emit_memory()


# ---------------------------------------------------------------------------
# Image preparation
# ---------------------------------------------------------------------------

def has_meaningful_alpha(image) -> bool:
    """True when the image already carries a usable cut-out.

    A file can be RGBA and still be fully opaque (most PNG exports are), so a
    channel test alone isn't enough: at least 1% of pixels have to be close to
    transparent before we skip background removal.
    """
    if image.mode != "RGBA":
        return False
    alpha = image.getchannel("A")
    low, _high = alpha.getextrema()
    if low > 240:
        return False
    histogram = alpha.histogram()
    transparent = sum(histogram[:128])
    return transparent >= 0.01 * (image.width * image.height)


def remove_background(image):
    global _rembg_session
    import rembg  # noqa: PLC0415

    if _rembg_session is None:
        # u2netp is ~5 MB and runs on CPU in well under a second; the heavier
        # default (bria-rmbg, ~1 GB) is not worth it next to the shape model.
        _rembg_session = rembg.new_session(os.environ.get("LOCAL_MESH_REMBG_MODEL", "u2netp"))
    return rembg.remove(image, session=_rembg_session, bgcolor=(255, 255, 255, 0)).convert("RGBA")


def prepare_image(job: dict, progress) -> Any:
    from PIL import Image, ImageOps  # noqa: PLC0415

    path = job["imagePath"]
    job_id = job.get("jobId")
    progress(1.0, "prepare", f"Loading {os.path.basename(path)}")
    image = Image.open(path)
    image = ImageOps.exif_transpose(image)
    image = image.convert("RGBA")
    log("debug", f"input {os.path.basename(path)}: {image.width}x{image.height}", job_id)

    if job.get("removeBackground"):
        if has_meaningful_alpha(image):
            log("debug", "input already has an alpha cut-out; skipping background removal", job_id)
        else:
            progress(4.0, "prepare", "Removing background")
            started = time.monotonic()
            # The first call builds the rembg session, which is where a missing
            # u2netp model shows up as a long stall (the worker runs offline).
            first = _rembg_session is None
            image = remove_background(image)
            log("debug", f"background removed in {time.monotonic() - started:.1f}s"
                         f"{' (including one-off model load)' if first else ''}", job_id)
    progress(STAGE_PREPARE_END, "prepare", f"Image ready ({image.width}x{image.height})")
    return image


# ---------------------------------------------------------------------------
# Mesh post-processing and export
# ---------------------------------------------------------------------------

def as_trimesh(result):
    import trimesh  # noqa: PLC0415

    if isinstance(result, (list, tuple)):
        if not result:
            raise RuntimeError("the backend returned no mesh")
        result = result[0]
    if isinstance(result, trimesh.Scene):
        result = trimesh.util.concatenate(tuple(result.geometry.values()))
    if result is None or not hasattr(result, "faces"):
        raise RuntimeError(f"the backend returned {type(result).__name__}, not a trimesh.Trimesh")
    if len(result.faces) == 0:
        raise RuntimeError("the backend returned an empty mesh (no faces)")
    return result


MAX_SMOOTH_ITERATIONS = 200
MIN_DECIMATE_FACES = 100


def simplify_to(mesh, max_faces: int):
    """Quadric-decimate to at most `max_faces`; returns `mesh` unchanged if it can't.

    Vertex colours and UVs do not survive: fast-simplification returns bare
    geometry and the trimesh fallback drops visuals too.
    """
    if len(mesh.faces) <= max_faces:
        return mesh
    try:
        import fast_simplification  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415
        import trimesh  # noqa: PLC0415

        reduction = 1.0 - (max_faces / float(len(mesh.faces)))
        points, faces = fast_simplification.simplify(
            np.asarray(mesh.vertices, dtype=np.float32),
            np.asarray(mesh.faces, dtype=np.int32),
            reduction,
        )
        return trimesh.Trimesh(vertices=points, faces=faces, process=False)
    except Exception as exc:  # noqa: BLE001
        log("warn", f"fast-simplification failed ({exc}); falling back to trimesh decimation")
        try:
            return mesh.simplify_quadric_decimation(face_count=max_faces)
        except Exception as exc2:  # noqa: BLE001
            log("warn", f"decimation skipped: {exc2}")
            return mesh


def fix_orientation(mesh):
    """Flip inside-out meshes.

    Marching-cubes implementations disagree about winding (the torchmcubes shim
    in particular), so normalise on the one invariant that survives: a closed
    surface wound outwards has positive signed volume.
    """
    try:
        # NOT `is_volume`: that property is already false for a negative volume,
        # which is exactly the case this has to catch.
        if mesh.is_watertight and mesh.is_winding_consistent and mesh.volume < 0:
            mesh.invert()
    except Exception:  # noqa: BLE001
        pass
    return mesh


# ---------------------------------------------------------------------------
# Mesh ops
#
# One implementation per op, shared by the post-process chain a pipeline
# compiles into a job and the `process` command behind the Generate view's
# mesh tools. Mirrored in src/core/generation.ts (MeshOp, normalizeMeshOp):
# both ends validate, so a bad value never reaches trimesh.
# ---------------------------------------------------------------------------


def validate_ops(raw: Any, allow_empty: bool = False) -> list:
    if raw is None and allow_empty:
        return []
    if not isinstance(raw, list) or (not raw and not allow_empty):
        raise ValueError("`ops` must be a non-empty list")
    ops: list = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError(f"each op must be an object, got {type(item).__name__}")
        name = item.get("op")
        if name == "remove-floaters":
            try:
                threshold = float(item.get("threshold"))
            except (TypeError, ValueError):
                raise ValueError("remove-floaters needs a numeric `threshold`") from None
            if not 0.0 < threshold <= 1.0:
                raise ValueError(
                    f"remove-floaters `threshold` must be above 0 and at most 1, got {threshold}")
            ops.append({"op": "remove-floaters", "threshold": threshold})
        elif name == "remove-degenerate":
            ops.append({"op": "remove-degenerate",
                        "mergeVertices": item.get("mergeVertices") is not False})
        elif name == "fill-holes":
            ops.append({"op": "fill-holes"})
        elif name == "decimate":
            mode = "ratio" if item.get("mode") == "ratio" else "faces"
            if mode == "ratio":
                try:
                    ratio = float(item.get("ratio"))
                except (TypeError, ValueError):
                    raise ValueError("decimate needs a numeric `ratio`") from None
                if not 0.0 < ratio < 1.0:
                    raise ValueError(
                        f"decimate `ratio` must be between 0 and 1 exclusive, got {ratio}")
                ops.append({"op": "decimate", "mode": "ratio", "ratio": ratio})
            else:
                try:
                    max_faces = int(item.get("maxFaces"))
                except (TypeError, ValueError):
                    raise ValueError("decimate needs an integer `maxFaces`") from None
                if max_faces < MIN_DECIMATE_FACES:
                    raise ValueError(
                        f"decimate `maxFaces` must be at least {MIN_DECIMATE_FACES}, got {max_faces}")
                ops.append({"op": "decimate", "mode": "faces", "maxFaces": max_faces})
        elif name == "smooth":
            try:
                iterations = int(item.get("iterations"))
            except (TypeError, ValueError):
                raise ValueError("smooth needs an integer `iterations`") from None
            if not 1 <= iterations <= MAX_SMOOTH_ITERATIONS:
                raise ValueError(
                    f"smooth `iterations` must be 1..{MAX_SMOOTH_ITERATIONS}, got {iterations}")
            ops.append({"op": "smooth", "iterations": iterations})
        elif name == "recompute-normals":
            ops.append({"op": "recompute-normals"})
        else:
            raise ValueError(f"unknown op {name!r}")
    return ops


def op_remove_floaters(mesh, op: dict, progress, pct: float):
    """Keep the largest connected component, plus anything within `threshold` of it."""
    try:
        parts = mesh.split(only_watertight=False)
    except Exception as exc:  # noqa: BLE001
        log("warn", f"floater removal skipped: {exc}")
        return mesh
    if len(parts) <= 1:
        progress(pct, "remove-floaters", "One connected part; nothing to drop")
        return mesh
    import trimesh  # noqa: PLC0415

    parts = sorted(parts, key=lambda m: len(m.faces), reverse=True)
    threshold = float(op["threshold"]) * len(parts[0].faces)
    keep = [p for p in parts if len(p.faces) >= threshold]
    progress(pct, "remove-floaters", f"Dropping {len(parts) - len(keep)} loose parts")
    return keep[0] if len(keep) == 1 else trimesh.util.concatenate(keep)


def op_remove_degenerate(mesh, op: dict, progress, pct: float):
    progress(pct, "remove-degenerate", "Dropping zero-area faces")
    try:
        if op.get("mergeVertices"):
            mesh.merge_vertices()
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.remove_unreferenced_vertices()
    except Exception as exc:  # noqa: BLE001
        log("warn", f"degenerate-face removal skipped: {exc}")
    return mesh


def op_fill_holes(mesh, op: dict, progress, pct: float):
    progress(pct, "fill-holes", "Closing boundary loops")
    try:
        before = len(mesh.faces)
        if not mesh.fill_holes():
            log("warn", "some holes were too large to fill")
        added = len(mesh.faces) - before
        if added > 0:
            log("info", f"filled holes with {added} faces")
    except Exception as exc:  # noqa: BLE001
        log("warn", f"hole filling skipped: {exc}")
    return mesh


def op_decimate(mesh, op: dict, progress, pct: float):
    if op["mode"] == "ratio":
        target = max(4, int(len(mesh.faces) * float(op["ratio"])))
    else:
        target = int(op["maxFaces"])
    if len(mesh.faces) <= target:
        progress(pct, "decimate", f"{len(mesh.faces)} faces already under {target}")
        return mesh
    progress(pct, "decimate", f"Reducing {len(mesh.faces)} -> {target} faces")
    before = len(mesh.faces)
    mesh = simplify_to(mesh, target)
    if len(mesh.faces) >= before:
        log("warn", "decimation left the face count unchanged")
    return mesh


def op_smooth(mesh, op: dict, progress, pct: float):
    import trimesh  # noqa: PLC0415

    iterations = int(op["iterations"])
    progress(pct, "smooth", f"Taubin smoothing x{iterations}")
    # Taubin alternates a shrinking and an expanding Laplacian pass, so unlike
    # plain Laplacian smoothing it keeps the volume roughly where it was.
    trimesh.smoothing.filter_taubin(mesh, iterations=iterations)
    return mesh


def op_recompute_normals(mesh, op: dict, progress, pct: float):
    progress(pct, "recompute-normals", "Recomputing normals")
    try:
        mesh.fix_normals()
    except Exception as exc:  # noqa: BLE001
        log("warn", f"normal recomputation skipped: {exc}")
    return mesh


OPS = {
    "remove-floaters": op_remove_floaters,
    "remove-degenerate": op_remove_degenerate,
    "fill-holes": op_fill_holes,
    "decimate": op_decimate,
    "smooth": op_smooth,
    "recompute-normals": op_recompute_normals,
}


def apply_ops(mesh, ops: list, progress, start: float, end: float, job_id: str = ""):
    """Run a validated op chain in order, spreading progress over start..end."""
    if not ops:
        return mesh
    span = (end - start) / len(ops)
    for index, op in enumerate(ops):
        if job_id and job_id in _cancelled_jobs:
            raise Cancelled()
        mesh = OPS[op["op"]](mesh, op, progress, start + span * index)
    return mesh


def unique_path(directory: str, stem: str, ext: str) -> str:
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{stem}.{ext}")
    index = 2
    while os.path.exists(path):
        path = os.path.join(directory, f"{stem}-{index}.{ext}")
        index += 1
    return path


# ---------------------------------------------------------------------------
# process: trimesh-only edits of an existing mesh file
#
# No model is involved and whatever is loaded stays loaded - these are the
# mesh tool buttons in the Generate view acting on a finished output.
# Progress is reported under `job_id: request_id` so the UI can attribute it.
# ---------------------------------------------------------------------------

PROCESS_OPS_START = 10.0
PROCESS_OPS_END = 90.0


def do_process(cmd: dict) -> None:
    global _current_job_id
    request_id = str(cmd.get("request_id") or "")
    started = time.monotonic()
    # backend_progress tags events with this and raises Cancelled when it is in
    # _cancelled_jobs, which is exactly the behaviour wanted here too.
    _current_job_id = request_id
    progress = backend_progress
    mesh = None
    try:
        ops = validate_ops(cmd.get("ops"))
        source = os.path.abspath(os.path.expanduser(str(cmd.get("input") or "")))
        if not os.path.isfile(source):
            raise FileNotFoundError(f"no such mesh file: {source}")
        requested = str(cmd.get("output") or "").strip()
        if not requested:
            # Checked before abspath: os.path.abspath("") is the cwd, so an
            # absent `output` would otherwise write the mesh next to the app.
            raise ValueError("`output` is required")
        target = os.path.abspath(os.path.expanduser(requested))
        out_dir = os.path.dirname(target) or os.path.dirname(source)
        stem, dotted = os.path.splitext(os.path.basename(target))
        ext = dotted.lstrip(".").lower() or "glb"

        import trimesh  # noqa: PLC0415

        progress(2.0, "load", f"Loading {os.path.basename(source)}")
        mesh = trimesh.load(source, force="mesh")
        if mesh is None or not hasattr(mesh, "faces") or len(mesh.faces) == 0:
            raise RuntimeError(f"{os.path.basename(source)} has no faces to process")
        progress(PROCESS_OPS_START, "load",
                 f"{len(mesh.vertices)} verts, {len(mesh.faces)} faces")

        mesh = apply_ops(mesh, ops, progress, PROCESS_OPS_START, PROCESS_OPS_END, request_id)

        if request_id in _cancelled_jobs:
            raise Cancelled()
        out_path = unique_path(out_dir, stem, ext)
        progress(PROCESS_OPS_END + 4.0, "export", f"Writing {os.path.basename(out_path)}")
        mesh.export(out_path)
        progress(100.0, "export", "Done")

        emit({
            "event": "processed",
            "request_id": request_id,
            "output": out_path,
            "vertices": int(len(mesh.vertices)),
            "faces": int(len(mesh.faces)),
            "duration_ms": int((time.monotonic() - started) * 1000),
        })
    except Cancelled:
        emit({"event": "cancelled", "job_id": request_id})
    except (SystemExit, KeyboardInterrupt):
        # SIGTERM lands here as SystemExit; swallowing it would keep a worker
        # main has already asked to stop alive until the SIGKILL.
        raise
    except BaseException as exc:  # noqa: BLE001
        emit_error(f"{type(exc).__name__}: {exc}", request_id=request_id,
                   tb=traceback.format_exc())
        emit_memory()  # PROTOCOL.md: a `memory` event follows every error
    finally:
        _current_job_id = ""
        _cancelled_jobs.discard(request_id)
        del mesh
        gc.collect()


# ---------------------------------------------------------------------------
# generate
# ---------------------------------------------------------------------------

def do_generate(job: dict) -> None:
    global _current_job_id
    job_id = job["jobId"]
    _current_job_id = job_id
    started = time.monotonic()

    def cancelled() -> bool:
        return job_id in _cancelled_jobs

    progress = backend_progress

    mesh = None
    image = None
    try:
        if cancelled():
            raise Cancelled()
        if _model is None:
            raise RuntimeError("no model is loaded; send `load` before `generate`")
        if _model.model_id != job.get("modelId"):
            raise RuntimeError(
                f"job wants {job.get('modelId')!r} but {_model.model_id!r} is loaded")

        image = prepare_image(job, progress)
        settings = dict(job.get("settings") or {})
        # The resolved values, which is what makes a result reproducible: the
        # renderer only ever sees the pipeline's defaults plus overrides.
        if settings:
            log("debug", "settings: " + ", ".join(f"{k}={v}" for k, v in sorted(settings.items())),
                job_id)
        mesh = as_trimesh(_model.backend.generate(image, settings, cancelled))
        # Before any op: a backend that hands back an inside-out surface should
        # be corrected at the source, not somewhere down the user's chain.
        mesh = fix_orientation(mesh)

        ops = validate_ops(job.get("postProcess"), allow_empty=True)
        if ops:
            progress(STAGE_POST_START, "postprocess", f"Post-processing ({len(ops)} steps)")
            mesh = apply_ops(mesh, ops, progress, STAGE_POST_START, STAGE_POST_END, job_id)

        export = job.get("export") or {}
        fmt = str(export.get("format", "glb"))
        out_dir = os.path.abspath(os.path.expanduser(export.get("outputDir") or "."))
        out_path = unique_path(out_dir, str(export.get("baseName", job_id)), fmt)
        progress(96.0, "export", f"Writing {os.path.basename(out_path)}")
        mesh.export(out_path)

        emit({
            "event": "done",
            "job_id": job_id,
            "output": out_path,
            "vertices": int(len(mesh.vertices)),
            "faces": int(len(mesh.faces)),
            "duration_ms": int((time.monotonic() - started) * 1000),
        })
    except Cancelled:
        emit({"event": "cancelled", "job_id": job_id})
    except (SystemExit, KeyboardInterrupt):
        raise  # SIGTERM: let the process go down instead of reporting an error
    except BaseException as exc:  # noqa: BLE001
        if is_oom(exc):
            emit_error(
                "CUDA ran out of memory. Try a lower octree/marching-cubes resolution, "
                "more decode chunks, low-VRAM mode, or the CPU device.",
                job_id=job_id, tb=traceback.format_exc(), oom=True)
        else:
            emit_error(f"{type(exc).__name__}: {exc}", job_id=job_id, tb=traceback.format_exc())
    finally:
        _current_job_id = ""
        _cancelled_jobs.discard(job_id)
        del mesh, image
        free_cuda()
        emit_memory()


# ---------------------------------------------------------------------------
# stdin reader + main loop
# ---------------------------------------------------------------------------

def read_stdin() -> None:
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
            except json.JSONDecodeError as exc:
                emit_error(f"could not parse command: {exc}")
                continue
            if not isinstance(command, dict):
                # Valid JSON that is not an object: report it and keep reading.
                # Letting it reach .get() would kill this thread and, through the
                # EOF sentinel below, shut the whole worker down.
                emit_error(f"expected a JSON object command, got {type(command).__name__}")
                continue
            if command.get("cmd") == "cancel":
                job_id = command.get("job_id")
                if job_id:
                    _cancelled_jobs.add(job_id)
                    # The queue already logged the request; this only confirms
                    # the worker saw it, which matters when it then does not stop.
                    log("debug", "cancel received", job_id)
                continue
            _commands.put(command)
    except Exception as exc:  # noqa: BLE001
        emit_error(f"stdin reader stopped: {exc}")
    finally:
        _commands.put(None)  # EOF: shut down


def emit_ready() -> None:
    torch = torch_module()
    gpu = None
    vram_total = None
    cuda = cuda_available()
    if cuda:
        try:
            gpu = torch.cuda.get_device_name(0)
            vram_total = int(torch.cuda.get_device_properties(0).total_memory)
        except Exception:  # noqa: BLE001
            pass
    emit({
        "event": "ready",
        "python": platform.python_version(),
        "torch": getattr(torch, "__version__", None) if torch is not None else None,
        "cuda": cuda,
        "gpu": gpu,
        "vram_total": vram_total,
    })


def handle(command: dict) -> bool:
    """Run one command; return False to stop the loop."""
    name = command.get("cmd")
    if name == "ping":
        emit({"event": "pong"})
    elif name == "load":
        do_load(command)
    elif name == "unload":
        do_unload()
    elif name == "generate":
        do_generate(command.get("job") or {})
    elif name == "process":
        do_process(command)
    elif name == "memory":
        emit_memory()
    elif name == "shutdown":
        do_unload(announce=False)
        return False
    else:
        emit_error(f"unknown command {name!r}")
    return True


def main() -> int:
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    threading.Thread(target=read_stdin, name="stdin", daemon=True).start()
    emit_ready()

    while True:
        command = _commands.get()
        if command is None:
            do_unload(announce=False)
            return 0
        try:
            if not handle(command):
                return 0
        except Cancelled:
            pass
        except (SystemExit, KeyboardInterrupt):
            do_unload(announce=False)
            return 0
        except BaseException as exc:  # noqa: BLE001
            emit_error(f"{type(exc).__name__}: {exc}", tb=traceback.format_exc(),
                       oom=is_oom(exc))
            emit_memory()


if __name__ == "__main__":
    sys.exit(main())
