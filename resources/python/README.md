# resources/python

Everything the Python side of Local Mesh needs. The Electron main process runs
these scripts in place from the app bundle, using the uv-managed venv at
`~/.local-mesh/env`; nothing is copied out. Nothing here is bundled into the
renderer, and nothing here imports Electron.

```
manifest.json          what to install: torch pin + index, base requirements,
                       per-model requirements and git repos (read by main)
VERSION                bumped when anything here changes; main writes it into
                       models/<id>/.deps-installed to detect a stale env
PROTOCOL.md            the worker's JSON-lines contract (mirrored in src/core/generation.ts)
hf_download.py         one-shot weight downloader with JSON progress
worker.py              the long-lived generation process
backends/              one module per model, plus the shared Backend base and the registry
requirements/          base.txt (always) + one file per model
shims/                 CPU stand-ins for CUDA extensions we refuse to build
                       (torchmcubes for TripoSR, diso for TripoSG/Hunyuan's DMC path)
```

## How main invokes each script

Environment setup, once:

```sh
uv venv ~/.local-mesh/env --python 3.11
uv pip install --python ~/.local-mesh/env/bin/python torch==2.9.1 torchvision \
    --index-url https://download.pytorch.org/whl/cu126
uv pip install --python ~/.local-mesh/env/bin/python -r <app>/resources/python/requirements/base.txt
```

The cu126 pin is not cosmetic: it is the last PyTorch wheel channel that still
compiles `sm_61`, the target GTX 1080. Newer channels (cu128+) dropped Pascal.

Per model:

```sh
# weights — the app downloads these itself in the main process (src/main/hfDownload.ts,
# straight from Hugging Face, no python needed); hf_download.py is an equivalent CLI
~/.local-mesh/env/bin/python -u <app>/resources/python/hf_download.py \
    --repo tencent/Hunyuan3D-2mini \
    --dest ~/.local-mesh/models/hunyuan3d-2mini \
    --allow "hunyuan3d-dit-v2-mini-turbo/*" --allow "*.json"

# code the backend imports (manifest.json -> models.<id>.repos)
git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git ~/.local-mesh/repos/Hunyuan3D-2

# dependencies
uv pip install --python ~/.local-mesh/env/bin/python -r <app>/resources/python/requirements/hunyuan3d.txt
```

`hf_download.py` writes one JSON object per line to stdout — `start`,
`progress` (at most four per second), then `done` or `error` — and leaves a
`.complete` marker in the destination so main can tell a finished snapshot from
an interrupted one. SIGTERM exits 130 and keeps the partial files; the next run
resumes. Exit code 1 means the `error` event is the reason.

Generation:

```sh
~/.local-mesh/env/bin/python -u <app>/resources/python/worker.py
```

Main keeps that process alive across jobs, writes commands to its stdin and
reads events from its stdout. Everything on stderr is log noise and goes to the
`generation` log channel at debug level. See PROTOCOL.md for the message shapes.

## Running the worker by hand

```sh
echo '{"cmd":"ping"}' | python -u worker.py
```

A whole job, against the mock backend (no torch, no weights, no GPU):

```sh
printf '%s\n' \
  '{"cmd":"load","model_id":"mock","model_dir":"/tmp","device":"cpu","precision":"fp32","low_vram":false}' \
  '{"cmd":"generate","job":{"jobId":"j1","modelId":"mock","imagePath":"in.png","removeBackground":false,
     "settings":{"shape":"torus-knot","seconds":1,"seed":7},
     "postProcess":{"removeFloaters":true,"removeDegenerateFaces":true,"maxFaces":null,"smoothNormals":false},
     "export":{"format":"glb","outputDir":"/tmp/out","baseName":"demo"}}}' \
  '{"cmd":"shutdown"}' | python -u worker.py
```

(Keep each command on a single line — the reader is line-delimited.)
`LOCAL_MESH_HOME` overrides `~/.local-mesh` if you want to point the repo and
shim search at a scratch tree.

## Adding a model

1. Add the entry to `MODELS` in `src/core/models.ts` with a `backend` name.
2. Mirror the id → backend mapping in `backends/registry.py`.
3. Write `backends/<backend>.py` with a `Backend` class (see `backends/base.py`;
   `backends/mock.py` is the smallest complete example).
4. Add `requirements/<name>.txt` and a `models.<id>` entry in `manifest.json`.
5. Bump `VERSION` so existing installs reinstall their dependencies.

Backends receive a PIL RGBA image with the background already removed, report
progress through the callbacks they were constructed with, and return a
`trimesh.Trimesh`. Cleanup, decimation, orientation and export belong to
`worker.py`, so every model produces comparable output.
