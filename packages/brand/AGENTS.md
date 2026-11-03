# `@repo/brand`

The product's brand: the design sources, the generators that cut every
committed copy from them, and what those copies are.

- `assets/` holds the SVG and PNG sources and the cut artwork: icon, mark,
  logo, wordmark, avatar, DMG background, social card, download button.
  `README.md` is the asset sheet.
- `scripts/` holds the two generators (`pnpm --filter @repo/brand generate`),
  the brand's colour table both read (`brand-palette.mjs`), and the DMG window
  layout the desktop's packaging reads.
- `src/` holds geometry and the generated mark art, brand palette, motion
  tokens, and provider-mark paths the apps draw from.

Regenerate the generated files (under `src/generated/`, `assets/`, and
`@repo/ui`'s `src/tokens/brand.css` and `motion-tokens.css`) from the sources
rather than hand-editing; `pnpm --filter @repo/brand check` reports drift when
run by hand.

This package draws nothing itself. `@repo/ui` is the shared React layer
that traces the generated artwork into the window (`ProductMark`), so the mark
and the glyphs have one implementation.
