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
            log("warn", f"torch is not available: {exc}")
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
        log("warn", f"could not read manifest.json: {exc}")
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
            log("warn", f"repo clone missing: {path}")
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
        log("info", "could not size the weights; using fp16 on a pre-Volta card")
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
        try:
            _model.backend.unload()
        except Exception as exc:  # noqa: BLE001
            log("warn", f"backend unload raised: {exc}")
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

    if _model is not None and _model.model_id != model_id:
        do_unload(announce=False)

    backend_name = registry.backend_name_for(model_id)
    add_repo_paths(model_id)
    backend_cls = registry.load_backend_class(backend_name)

    device = resolve_device(cmd.get("device", "auto"))
    dtype = resolve_dtype(cmd.get("precision", "auto"), device, backend_cls, model_dir)
    low_vram = bool(cmd.get("low_vram", False))

    backend_progress(0.0, "load", f"Loading {model_id}")
    log("info", f"loading {model_id} via backends/{backend_name}.py "
                f"(device={device}, dtype={getattr(dtype, 'name', dtype)}, low_vram={low_vram})")

    backend = backend_cls(model_dir, device, dtype, low_vram, backend_log, backend_progress)
    backend.load()
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
    progress(1.0, "prepare", f"Loading {os.path.basename(path)}")
    image = Image.open(path)
    image = ImageOps.exif_transpose(image)
    image = image.convert("RGBA")

    if job.get("removeBackground"):
        if has_meaningful_alpha(image):
            log("debug", "image already has an alpha cut-out; skipping background removal",
                job.get("jobId"))
        else:
            progress(4.0, "prepare", "Removing background")
            image = remove_background(image)
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


def drop_floaters(mesh, progress):
    """Keep the largest connected component, plus any component within 10% of it."""
    try:
        parts = mesh.split(only_watertight=False)
    except Exception as exc:  # noqa: BLE001
        log("warn", f"floater removal skipped: {exc}")
        return mesh
    if len(parts) <= 1:
        return mesh
    import trimesh  # noqa: PLC0415

    parts = sorted(parts, key=lambda m: len(m.faces), reverse=True)
    threshold = 0.1 * len(parts[0].faces)
    keep = [p for p in parts if len(p.faces) >= threshold]
    progress(91.0, "postprocess", f"Dropping {len(parts) - len(keep)} loose parts")
    return keep[0] if len(keep) == 1 else trimesh.util.concatenate(keep)


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


def decimate(mesh, max_faces: int, progress):
    if len(mesh.faces) <= max_faces:
        return mesh
    progress(93.0, "postprocess", f"Decimating {len(mesh.faces)} -> {max_faces} faces")
    return simplify_to(mesh, max_faces)


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


def post_process(mesh, spec: dict, progress):
    progress(STAGE_POST_START, "postprocess", "Cleaning mesh")
    if spec.get("removeDegenerateFaces"):
        try:
            mesh.update_faces(mesh.nondegenerate_faces())
            mesh.remove_unreferenced_vertices()
        except Exception as exc:  # noqa: BLE001
            log("warn", f"degenerate-face removal skipped: {exc}")
    if spec.get("removeFloaters"):
        mesh = drop_floaters(mesh, progress)
    max_faces = spec.get("maxFaces")
    if max_faces:
        mesh = decimate(mesh, int(max_faces), progress)
    mesh = fix_orientation(mesh)
    if spec.get("smoothNormals"):
        progress(94.0, "postprocess", "Recomputing normals")
        try:
            mesh.fix_normals()
        except Exception as exc:  # noqa: BLE001
            log("warn", f"normal smoothing skipped: {exc}")
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
# Reduce / Smooth buttons in the Generate view acting on a finished output.
# Progress is reported under `job_id: request_id` so the UI can attribute it.
# ---------------------------------------------------------------------------

MAX_SMOOTH_ITERATIONS = 200
PROCESS_OPS_START = 10.0
PROCESS_OPS_END = 90.0


def validate_ops(raw: Any) -> list:
    if not isinstance(raw, list) or not raw:
        raise ValueError("`ops` must be a non-empty list")
    ops: list = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError(f"each op must be an object, got {type(item).__name__}")
        name = item.get("op")
        if name == "decimate":
            try:
                ratio = float(item.get("ratio"))
            except (TypeError, ValueError):
                raise ValueError("decimate needs a numeric `ratio`") from None
            if not 0.0 < ratio < 1.0:
                raise ValueError(f"decimate `ratio` must be between 0 and 1 exclusive, got {ratio}")
            ops.append({"op": "decimate", "ratio": ratio})
        elif name == "smooth":
            try:
                iterations = int(item.get("iterations"))
            except (TypeError, ValueError):
                raise ValueError("smooth needs an integer `iterations`") from None
            if not 1 <= iterations <= MAX_SMOOTH_ITERATIONS:
                raise ValueError(
                    f"smooth `iterations` must be 1..{MAX_SMOOTH_ITERATIONS}, got {iterations}")
            ops.append({"op": "smooth", "iterations": iterations})
        else:
            raise ValueError(f"unknown op {name!r}")
    return ops


def op_decimate(mesh, ratio: float, progress, pct: float):
    target = max(4, int(len(mesh.faces) * ratio))
    progress(pct, "decimate", f"Reducing {len(mesh.faces)} -> {target} faces")
    before = len(mesh.faces)
    mesh = simplify_to(mesh, target)
    if len(mesh.faces) >= before:
        log("warn", "decimation left the face count unchanged")
    return mesh


def op_smooth(mesh, iterations: int, progress, pct: float):
    import trimesh  # noqa: PLC0415

    progress(pct, "smooth", f"Taubin smoothing x{iterations}")
    # Taubin alternates a shrinking and an expanding Laplacian pass, so unlike
    # plain Laplacian smoothing it keeps the volume roughly where it was.
    trimesh.smoothing.filter_taubin(mesh, iterations=iterations)
    return mesh


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
        target = os.path.abspath(os.path.expanduser(str(cmd.get("output") or "")))
        if not target:
            raise ValueError("`output` is required")
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

        span = (PROCESS_OPS_END - PROCESS_OPS_START) / len(ops)
        for index, op in enumerate(ops):
            if request_id in _cancelled_jobs:
                raise Cancelled()
            pct = PROCESS_OPS_START + span * index
            if op["op"] == "decimate":
                mesh = op_decimate(mesh, op["ratio"], progress, pct)
            else:
                mesh = op_smooth(mesh, op["iterations"], progress, pct)

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
    except BaseException as exc:  # noqa: BLE001
        emit_error(f"{type(exc).__name__}: {exc}", request_id=request_id,
                   tb=traceback.format_exc())
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
        mesh = as_trimesh(_model.backend.generate(image, settings, cancelled))

        mesh = post_process(mesh, job.get("postProcess") or {}, progress)

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
            if command.get("cmd") == "cancel":
                job_id = command.get("job_id")
                if job_id:
                    _cancelled_jobs.add(job_id)
                    log("info", f"cancel requested for {job_id}", job_id)
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
        except BaseException as exc:  # noqa: BLE001
            emit_error(f"{type(exc).__name__}: {exc}", tb=traceback.format_exc(),
                       oom=is_oom(exc))
            emit_memory()


if __name__ == "__main__":
    sys.exit(main())
