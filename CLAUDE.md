# Local Mesh

Desktop app for local image → 3D mesh generation. Electron + React 19 + Vite + TypeScript, plain CSS (cascade layers, OKLCH tokens); no component or state library — runtime deps are React, `lucide-react`, `three`, and `@fontsource` font files. Models run in Python from a uv-managed venv under `~/.local-mesh`; target hardware is an 8 GB Pascal card (GTX 1080: no bf16, slow fp16, torch 2.9.1+cu126).

## Run

- `npm run dev` — Vite dev server + Electron, hot reload
- `npm run build` — typecheck + bundle to `dist/` (renderer) and `dist-electron/` (main + preload)
- `npm start` — Electron against the production build
- `node scripts/drive-app.mjs <ss|eval|text|click|click-text|nav> [arg]` — drive a running instance over CDP (start it with `./node_modules/.bin/electron . --remote-debugging-port=9222` after `npm run build`); screenshots land in `.shots/`
- `npm run sync-skills` — regenerate the `.agents/skills/` mirror after editing `.claude/skills/` (never edit the mirror)

## Map

- `src/core/` — contracts shared by main, preload and renderer: `types.ts` (`ElectronAPI`, `IPC_CHANNELS`), `models.ts` (the model registry — settings forms and downloads are driven by it), `pipeline.ts` (node graph + `validatePipeline`/`compilePipeline`), `generation.ts` (jobs, queue state, worker protocol), `logs.ts`, `env.ts` (paths, env status, settings)
- `src/main/` — Electron main: window lifecycle, `logger.ts` (three channels: general / errors / generation), `envManager.ts` (uv venv setup), `hfDownload.ts` + `modelManager.ts` (weights straight from Hugging Face in Node; per-model deps as a separate install step), `worker.ts` + `queue.ts` (python worker process, job queue, memory/idle unload), `pipelines.ts`, `outputs.ts`, `settings.ts`
- `src/preload/` — sandboxed bridge exposing `window.electronAPI`
- `src/ui/` — React renderer; each subdirectory (including `assets/`) carries a `CLAUDE.md` of local conventions. Views: Generate (three.js scene + right dock, the landing view), Pipelines (node editor), Models (environment + downloads), Logs, Settings, Help, Developer (dev only)
- `resources/python/` — the Python side, run in place from the app bundle (never copied): `worker.py` (long-lived JSON-lines process, see `PROTOCOL.md`), `backends/` (one module per model), `hf_download.py`, `requirements/`, `manifest.json` (torch index, per-model repos/requirements)
- `resources/icon.png` — the window icon Linux needs explicitly (regenerate from `icon.svg`)
- `.claude/skills/` — generic, project-agnostic skills (`frontend-design`, `fonts`, `icons`, `images`)

## Conventions

- New IPC surface touches three files: channel name + `ElectronAPI` method in `core/types.ts`, wrapper in `preload/preload.ts`, handler in `main/`.
- Adding a model: an entry in `core/models.ts`, a backend in `resources/python/backends/`, an entry in `resources/python/manifest.json` (+ a requirements file). Nothing else.
- Installing a model is two independent user steps: weights (Node downloader, no env needed) and dependencies (uv into the env, keyed on the bundled scripts version).
- Renderer stores (`src/ui/stores/`) mirror main-process state via push events and are bound once in `App.tsx`; views read stores, not `window.electronAPI`.
- Per-view CSS lives in `src/ui/assets/styles/<view>.css` inside `@layer views`.
- `~/.local-mesh/` layout: `env/` `repos/` `models/<id>/` `inputs/` `outputs/` `pipelines/` `logs/` `settings.json`.

The Developer view (in-app, dev only) renders and edits the `src/ui/*/CLAUDE.md` files, one tab per directory.
