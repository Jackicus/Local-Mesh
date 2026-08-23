---
name: icons
description: Sourcing and adding icons — pick from open icon collections, never hand-invent SVG paths. Use whenever UI needs an icon, an icon set is being chosen, or a custom glyph is requested.
---

# Icons

Check the icons directory's CLAUDE.md for this project's catalog and naming before adding anything.

- **Source from an established open collection** with a permissive, no-attribution license: Lucide (ISC), Heroicons (MIT), Tabler (MIT), Phosphor (MIT). Avoid sets that require credit or per-use permission — attribution obligations spread to every screen the icon touches.
- **Stick to one collection per project.** Sets are drawn on a shared grid and stroke width; mixing sets produces glyphs that read as visibly off next to the rest.
- **Never invent SVG path data** — no hand-drawn, generated, or eyeballed paths, for the same reason. If the primary collection lacks a glyph, take the nearest match from another open collection and normalize it to the primary set's viewBox and stroke.
- **Create an icon only for identity marks** (logo, wordmark) that no collection can supply — one component per file, following the project's icon component pattern.
