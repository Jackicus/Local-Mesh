---
name: fonts
description: Adding or changing typefaces — sourcing from open catalogs, self-hosting, @font-face hygiene, font switchers. Use for any font or typography-asset change.
model: haiku
---

# Fonts

Check the fonts directory's CLAUDE.md for how this project loads and switches families before touching anything.

- Source from open catalogs (Google Fonts, Fontsource) under open licenses (OFL/Apache). Prefer variable fonts — one file covers every weight.
- Self-host for desktop or offline-capable apps: `.woff2` only, `@font-face` with `font-display: swap`, and a system-stack fallback so first paint never blocks on a font. A CDN `@import` is fine for prototypes but ties first paint to the network.
- Keep the set small — a UI family plus a mono family covers most apps; every extra face costs load time and coherence.
