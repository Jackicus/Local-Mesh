# shell/

The window frame (top bar, dock, window controls, overlay mount) — kept flat on purpose. The top bar is a drag region, so clickable children need `-webkit-app-region: no-drag`.

`BottomDock.tsx` hosts the logs (`views/Logs/LogsPanel`) as an overlay pinned to the bottom of the content area — collapsed strip or resizable panel, state in `dockStore.bottom`, toggled from the Logs footer nav item or `Ctrl/Cmd + J`. It overlays rather than shrinks the content so full-bleed views keep their height.
