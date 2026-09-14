# Worker protocol

`worker.py` is a long-lived process spawned by the Electron main process from the
uv-managed venv at `~/.local-mesh/env`. It keeps one model resident between jobs
so loading (the expensive part) happens once. Communication is newline-delimited
JSON: commands on **stdin**, events on **stdout**. Anything the worker (or a
library it imports) prints to **stderr** is captured by main and logged to the
`generation` channel at `debug` level, so noisy libraries never corrupt the
event stream. Never print non-JSON to stdout.

The TypeScript mirror of these shapes is `src/core/generation.ts`
(`WorkerCommand`, `WorkerEvent`, `GenerationJobSpec`). Keep them in sync.

## Lifecycle

```
main spawns:  <env>/bin/python -u <scripts>/worker.py
worker  →  {"event":"ready", ...}          once imports are done (torch may be absent)
main    →  {"cmd":"load", ...}             before the first job, or when the model changes
worker  →  {"event":"log"...}* then {"event":"loaded", ...} or {"event":"error", ...}
main    →  {"cmd":"generate","job":{...}}  one at a time; main owns the queue
worker  →  {"event":"progress",...}* then {"event":"done"|"error"|"cancelled"}
main    →  {"cmd":"unload"}                idle timeout, or before loading another model
main    →  {"cmd":"shutdown"}              worker exits 0; main SIGKILLs after 5s
```

Commands are processed sequentially on the main thread of the worker. `cancel`
is the one exception: main writes it while a `generate` is running; the worker
reads stdin on a background thread and sets a cancel flag that the backend
checks between stages/steps. If a backend cannot stop mid-run, main also has a
hard path: it kills the process and marks the job cancelled.

## Commands (stdin, one JSON object per line)

| cmd        | fields                                                                                   |
|------------|------------------------------------------------------------------------------------------|
| `ping`     | –                                                                                        |
| `load`     | `model_id`, `model_dir` (HF snapshot dir), `device` (`auto|cuda|cpu`), `precision` (`auto|fp16|fp32`), `low_vram` (bool) |
| `unload`   | –                                                                                        |
| `generate` | `job` = GenerationJobSpec (below)                                                        |
| `process`  | `request_id`, `input` (an existing mesh file), `output` (absolute path incl. extension; unique-ify the stem if taken), `ops` (list of `{"op":"decimate","ratio":0.5}` / `{"op":"smooth","iterations":10}`) — trimesh only, no model needed; emits `progress` with `job_id: request_id`, then `processed` or `error` (with `request_id`) |
| `memory`   | –                                                                                        |
| `shutdown` | –                                                                                        |

### GenerationJobSpec

```json
{
  "jobId": "job-...",
  "modelId": "hunyuan3d-2mini",
  "imagePath": "/home/u/.local-mesh/inputs/job-.../cat.png",
  "removeBackground": true,
  "settings": { "variant": "turbo", "steps": 5, "guidance": 5, "octreeResolution": 256, "numChunks": 8000, "mcLevel": 0, "seed": 1234 },
  "postProcess": { "removeFloaters": true, "removeDegenerateFaces": true, "maxFaces": null, "smoothNormals": false },
  "export": { "format": "glb", "outputDir": "/home/u/.local-mesh/outputs", "baseName": "cat-hunyuan3d-2mini-142233" }
}
```

`settings` keys are exactly the `key`s of the model's `settings` array in
`src/core/models.ts`; `seed` is always a resolved non-negative integer. The
worker writes `<outputDir>/<baseName>.<format>` and must report that path in
`done.output`. If the file already exists, append `-2`, `-3`, ... to the stem.

## Events (stdout, one JSON object per line)

| event       | fields                                                                                     |
|-------------|--------------------------------------------------------------------------------------------|
| `ready`     | `python` (version string), `torch` (version or null), `cuda` (bool), `gpu` (name or null), `vram_total` (bytes or null) |
| `pong`      | –                                                                                          |
| `log`       | `level` (`debug|info|warn|error`), `message`, optional `job_id`                            |
| `progress`  | `job_id`, `pct` (0-100), `stage`, `message`                                                |
| `loaded`    | `model_id`, `duration_ms`                                                                  |
| `unloaded`  | –                                                                                          |
| `done`      | `job_id`, `output` (absolute path), `vertices`, `faces`, `duration_ms`                     |
| `cancelled` | `job_id`                                                                                   |
| `processed` | `request_id`, `output`, `vertices`, `faces`, `duration_ms`                                 |
| `error`     | `message`, optional `job_id` / `request_id`, `traceback`, `oom` (true on CUDA OOM)         |
| `memory`    | `vram_used`, `vram_total`, `ram_used` (bytes, or null when unknown)                        |

`progress` events emitted while a `load` is running carry `job_id: ""` — a model
load is not owned by a job (main may load ahead of the queue), so main should
attribute those to the model, not to `activeJobId`.

Progress stages, in order, so the UI can label them:
`load` (model load only), `prepare` (image load + background removal),
`condition`, `diffusion` (per-step progress inside), `decode` (latents → mesh),
`postprocess`, `export`. A `process` request has its own short sequence -
`load`, `decimate`, `smooth`, `export` - tagged with `job_id: request_id`, and
answers with `processed`, `error` (carrying `request_id`), or `cancelled` when a
`cancel` names that request id. After `done` or `error` the worker frees per-job
tensors and calls `torch.cuda.empty_cache()`; the model stays loaded.

A `memory` event is also emitted unprompted after `loaded`, `unloaded`, `done`
and `error`, so the UI's VRAM bar stays current without polling.

## Backends

`backends/<name>.py` exposes a class with:

```python
class Backend:
    def __init__(self, model_dir: str, device: str, dtype, low_vram: bool, log, progress): ...
    def load(self) -> None: ...
    def generate(self, image, settings: dict, cancel: Callable[[], bool]) -> trimesh.Trimesh: ...
    def unload(self) -> None: ...
```

`progress(pct, stage, message)` and `log(level, message)` are callbacks
supplied by the worker and already tagged with the job id. `image` is a PIL
RGBA image with background already removed when the job asked for it (the
worker handles background removal centrally so every backend gets the same
input). `cancel()` returns True when the job should stop; raise
`worker.Cancelled` from inside `generate` to abort cleanly.

The worker resolves `modelId` → backend module name with the same table as
`src/core/models.ts` (`backend` field); `backends/registry.py` mirrors it.
Post-processing and export are done by the worker (trimesh), not by backends.
