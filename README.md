# Local Mesh

Local image → 3D mesh generation on your own GPU. An Electron desktop app that
manages a Python environment, downloads open models from Hugging Face, and runs
them through a node-based pipeline with a three.js viewer.

Built for small cards: the reference machine is a GTX 1080 with 8 GB of VRAM.

## Views

- **Generate** — the three.js viewer with a floating dock: pick a pipeline, drop
  one or more images, queue jobs, watch progress and VRAM, and inspect results.
- **Pipelines** — a node editor for generation profiles: Image Input →
  Background Removal → Mesh Generator (model + model-specific settings) →
  Post-Process → Mesh Export. Pipelines are JSON files in `~/.local-mesh/pipelines`.
- **Models** — sets up the Python environment (`uv` venv, torch, worker scripts)
  and downloads each model's weights and dependencies.
- **Logs** — general, errors and generation channels, each backed by a file in
  `~/.local-mesh/logs`.
- **Settings** — theme, generation defaults (idle unload, device, precision,
  low-VRAM mode), storage.

## Models

| Model | Params | VRAM | License |
|---|---|---|---|
| Hunyuan3D 2 mini (turbo / standard, ~7.7 GB on disk) | 0.6B | ~5 GB | Tencent Hunyuan Community |
| TripoSR | ~0.5B | ~4 GB | MIT |
| TripoSG (experimental on 8 GB) | 1.5B | ~7.5 GB | MIT |
| Mock (procedural, no GPU) | – | – | – |

The registry lives in `src/core/models.ts`; each model has a backend in
`resources/python/backends/`.

## Requirements

- Node 20+, npm
- [`uv`](https://docs.astral.sh/uv/) on PATH (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- `git` (some backends are installed from their GitHub repos)
- An NVIDIA GPU with a recent driver, 8 GB VRAM or more recommended. Setup
  picks the torch build for the card from its compute capability: pre-Volta
  cards (GTX 10xx and older) get the last CUDA 12.6 build, everything newer
  through the RTX 50 series gets current PyPI torch, and machines without an
  NVIDIA GPU get the CPU build (slow, but the mock and TripoSR still work).

## Getting started

```bash
npm install
npm run dev      # dev server + Electron with hot reload
```

```bash
npm run build    # typecheck + production bundle (dist/ + dist-electron/)
npm start        # run Electron against the production build
```

Then, in the app: Models → **Set up environment** (once), then per model
**Download weights** (straight from Hugging Face, no Python needed) and
**Install dependencies** (into the environment). Drop an image into Generate.
The worker and backends ship inside the app (`resources/python`); nothing is
copied out of it. The **Mock** model needs no download and no GPU: use it
to check the whole queue → worker → viewer path first.

## How it runs

Everything user-specific lives in `~/.local-mesh`:

```text
env/          uv-managed Python 3.11 venv (torch build chosen per GPU)
repos/        git checkouts some backends need
models/<id>/  Hugging Face snapshots
inputs/       per-job copies of source images
outputs/      generated meshes (glb / obj / stl / ply)
pipelines/    saved node graphs
logs/         general.log, errors.log, generation.log
settings.json
```

The main process spawns one long-lived `worker.py` from the venv and talks to
it over JSON lines (`resources/python/PROTOCOL.md`). The worker keeps a single
model resident between jobs, reports VRAM after every step, frees per-job
tensors, and is unloaded after an idle timeout. Jobs run one at a time from a
queue owned by the main process; cancelling a running job asks the worker to
stop and kills it if it does not.

## Project layout

```text
src/
├── core/        # contracts: IPC, model registry, pipeline graph, worker protocol
├── main/        # Electron main: env setup, downloads, worker + queue, logging
├── preload/     # window.electronAPI bridge
└── ui/          # React renderer — see src/ui/README.md
resources/
├── python/      # worker, backends, downloader, requirements, manifest
└── icon.png
```
