# `@luke/brand`

Luke's brand: the design sources, the generators that cut every committed copy
from them, and what those copies are.

- `assets/` holds the SVG and PNG sources and the cut artwork: icon, mark,
  logo, avatar, DMG background, social card, motion. `README.md` is the asset
  sheet.
- `scripts/` holds the two generators (`pnpm --filter @luke/brand generate`)
  and the DMG window layout the desktop's packaging reads.
- `src/` holds geometry and the generated face art, motion tokens, and
  provider-mark paths the apps draw from.

Regenerate the generated files (under `src/generated/`, `assets/`, and the
renderer's `styles/generated/`) from the sources rather than hand-editing;
`pnpm --filter @luke/brand check` reports drift when run by hand.

This package draws nothing itself. `@luke/ui` is the shared React layer
that traces the generated artwork into the desktop window, so the face and the
glyphs have one implementation.
