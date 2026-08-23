# Electron + React Template

Desktop app template: Electron + React 19 + Vite + TypeScript. Plain CSS (cascade layers, OKLCH tokens); no component or state library — runtime deps are React, `lucide-react`, `better-sqlite3`, and `@fontsource` font files.

## Run

- `npm run dev` — Vite dev server + Electron, hot reload
- `npm run build` — typecheck + bundle to `dist/` (renderer) and `dist-electron/` (main + preload)
- `npm start` — Electron against the production build
- `npm run sync-skills` — regenerate the `.agents/skills/` mirror after editing `.claude/skills/` (never edit the mirror)

## Map

- `src/main/` — Electron main process: window lifecycle, state persistence, SQLite (`db.ts`), file logging (`logger.ts`), IPC handlers
- `src/preload/` — sandboxed bridge exposing `window.electronAPI`
- `src/core/` — IPC channel names and types shared by main, preload, and renderer
- `src/ui/` — React renderer; each subdirectory (including `assets/`) carries a `CLAUDE.md` of local conventions
- `.claude/skills/` — generic, project-agnostic skills (`frontend-design`, `fonts`, `icons`, `images`); project specifics stay in the CLAUDE.md files, so skills can be swapped or reused as the template evolves

New IPC surface touches three files: channel name in `core/types.ts`, handler in `main/main.ts`, `ElectronAPI` method in `preload/preload.ts`.

The Developer view (in-app, dev only) renders and edits the `src/ui/*/CLAUDE.md` files, one tab per directory.
