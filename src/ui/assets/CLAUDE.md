# assets/

Generic guidance lives in the repo skills (`frontend-design`, `fonts`, `icons`, `images`); this is just the local map.

- `styles/` — one file per cascade layer (`index.css` declares the order); design values come from tokens in `variables.css`, and themes override tokens under the `data-*` attributes set by `themeStore`. Neutrals are a graphite ramp (one faint cool hue) with a fixed elevation order — `--bg-dock` < `--bg-app` < `--bg-block` < `--bg-surface` in the dark; depth comes from `--shadow-*`/`--edge-light`, floating plates from `--plate-*`. Accents share one lightness band (dark text on filled buttons in dark mode) and are mirrored in `AVAILABLE_ACCENTS`. The 3D viewport's axis colours are `--axis-x/y/z`. Shell architecture follows the jt-electron-shell lineage.
- `icons/` — import from `icons/index.ts` (semantic re-exports of `lucide-react`); custom marks like `LogoIcon.tsx` get their own file.
- `fonts/` — `fonts.css` imports self-hosted `@fontsource` files (Geist + Geist Mono variable by default, Inter as an option; no network at runtime); a new family also wants a `[data-font]` stack in `variables.css` and a `FontFamily` option in `themeStore.ts`.
- `images/` — import as modules so Vite bundles them; `public/` is for fixed-URL files.
