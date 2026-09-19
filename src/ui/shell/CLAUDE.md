# shell/

The window frame (top bar, dock, window controls, overlay mount) — kept flat on purpose. The top bar is a drag region, so clickable children need `-webkit-app-region: no-drag`.

`BottomDock.tsx` hosts the logs (`views/Logs/LogsPanel`) as an overlay pinned to the bottom of the content area — a resizable panel while open and nothing at all while closed, state in `dockStore.bottom`, toggled from the Logs footer nav item or `Ctrl/Cmd + J`. It overlays rather than shrinks the content so full-bleed views keep their height; `Shell.tsx` publishes its height as `--bottomdock-height` (0 when closed) for the floating plates in Generate and Pipelines. Unseen errors show as a quiet count on the LeftDock's Logs item.

`EngineItem.tsx` sits at the top of the LeftDock footer, above Logs: the python worker's state, the loaded model, VRAM and the idle-unload countdown, with Unload and Stop. It is the only home for that readout — the Generate view has no right dock.
