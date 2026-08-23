# Electron + React Template

A desktop app starter built on **Electron**, **React**, **Vite**, and **TypeScript**, with plain CSS (cascade layers, OKLCH colors) and no runtime dependencies beyond React and an icon set.

## What's included

- **Frameless window chrome** — custom draggable top bar with minimize / maximize / close buttons, wired through a context-isolated IPC bridge.
- **Window state persistence** — size, position, and maximized state are saved to `userData` and restored on launch (with a sanity check that the window is still on a visible display).
- **Resizable navigation dock** — collapsible sidebar with drag-to-resize (180–360px). Toggle with `Ctrl/Cmd + B`.
- **Overlay system** — `Modal` dialogs, imperative toasts (`toast.success(...)`), a right-click `ContextMenu`, and `Tooltip`s, all rendered through a single `OverlayHost`.
- **UI primitives** — `Button`, `Badge`, compound `Card` and `Form` families. Styled with plain CSS, no component library.
- **Theming** — system/light/dark mode, five accent colors, three font choices, and three font scales, persisted to `localStorage`. Accent hover/subtle shades are derived in CSS with OKLCH relative colors.
- **Lightweight state** — small stores built on React's `useSyncExternalStore`; no state library.
- **SQLite storage** — `better-sqlite3` in the main process (`src/main/db.ts`), served over IPC, with a demo Notes view.
- **Desktop app plumbing** — single-instance lock, crash logging to `userData/logs/`, and an app-info IPC endpoint.
- **Error boundary** — render errors show a recovery card instead of a white screen.
- **Developer view** — an in-app playground demoing each primitive, hook, and store.

## Getting started

```bash
npm install
npm run dev      # dev server + Electron with hot reload
```

```bash
npm run build    # typecheck + production bundle (dist/ + dist-electron/)
npm start        # run Electron against the production build
```

## Project layout

```text
src/
├── main/        # Electron main process (window creation, state persistence, IPC handlers)
├── preload/     # Context-isolated bridge exposing window.electronAPI
├── core/        # IPC channel names + types shared by main and preload
└── ui/          # React renderer — see src/ui/README.md for a full guide
    ├── assets/      # Styles (@layer), icons, fonts
    ├── components/  # UI primitives
    ├── hooks/       # useWindowControls, useKeyboardShortcuts
    ├── shell/       # TopBar, LeftDock, WindowControls, OverlayHost
    ├── stores/      # dockStore, themeStore
    └── views/       # Home, Developer, Settings, Help screens
```

To add a screen, see the walkthrough in [`src/ui/README.md`](src/ui/README.md).

## Notes

- **Agent skills** live in [`.claude/skills/`](.claude/skills/) — that's the canonical copy, picked up by Claude Code. `npm run sync-skills` mirrors them into `.agents/skills/` for tools that read that path instead. Edit under `.claude/`, then re-run the sync; don't edit `.agents/` directly.
- **Packaging isn't set up.** When you're ready to ship installers, add [electron-builder](https://www.electron.build/) or [Electron Forge](https://www.electronforge.io/).
- **Fonts are self-hosted** via `@fontsource` packages (`src/ui/assets/fonts/fonts.css`) — no network needed at runtime.
- **Electron is paired with better-sqlite3's prebuilt binaries** so a fresh install needs no C++ toolchain: the `postinstall` script fetches the matching Electron-ABI binding. When bumping Electron majors, check that a `better-sqlite3` release ships prebuilds for that ABI (or install VS Build Tools and use `electron-rebuild`).
- **No linter or tests are included** — bring your own ESLint/Vitest setup if you want them.
