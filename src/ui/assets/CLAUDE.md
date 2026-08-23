# assets/

Generic guidance lives in the repo skills (`frontend-design`, `fonts`, `icons`, `images`); this is just the local map.

- `styles/` — one file per cascade layer (`index.css` declares the order); design values come from tokens in `variables.css`, and themes override tokens under the `data-*` attributes set by `themeStore`. The neutral-gray palette and shell architecture follow the jt-electron-shell lineage.
- `icons/` — import from `icons/index.ts` (semantic re-exports of `lucide-react`); custom marks like `LogoIcon.tsx` get their own file.
- `fonts/` — `fonts.css` imports self-hosted `@fontsource` weights (no network at runtime); a new family also wants a `[data-font]` stack in `variables.css` and a `FontFamily` option in `themeStore.ts`.
- `images/` — import as modules so Vite bundles them; `public/` is for fixed-URL files.
