# src/ui

The React renderer. Each directory carries a `CLAUDE.md` with its own
conventions; this file is only the map.

```text
src/ui/
├── assets/       styles (one file per cascade layer, tokens in variables.css),
│                 icons (semantic re-exports of lucide-react), self-hosted fonts
├── components/   primitives: Button, Card, Badge, Form.*, Modal, Toast,
│                 Tooltip, ContextMenu, ErrorBoundary
├── hooks/        useKeyboardShortcuts (Ctrl+B dock, Ctrl+J logs), useNow,
│                 useWindowControls
├── shell/        window frame: TopBar, LeftDock (+ EngineItem), BottomDock
│                 (the logs), OverlayHost
├── stores/       one small store per concern, mirroring main-process state
│                 via push events; bound once in App.tsx
├── views/        Generate (landing: viewer + job queue), Models, Pipelines
│                 (node editor, hidden until advanced), Logs (panel in the
│                 bottom dock), Settings, Help, Developer (dev builds only)
├── App.tsx       binds the stores, hosts the shell and the view router
└── main.tsx      mounts React
```

Adding a view: a folder under `views/` with `XView.tsx` + `index.ts`, a case
in `views/index.tsx`, and a nav item in `shell/LeftDock.tsx`. Views read
stores, never `window.electronAPI` directly.
