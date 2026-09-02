# `@sidecar/surface`

The design generators write the surface vocabulary to
`packages/surface/src/generated`: `motion-tokens.css`, `motion-tokens.ts`,
`provider-mark-paths.ts`, and `session-display.ts` from
`design/generate-surface-shared.mjs`, and `face-art.ts` from
`design/generate-brand-assets.mjs`. The directory is gitignored: `pnpm generate`
writes it, and this package's `typecheck` and `test` scripts run that first
because `index.ts` imports from it. Change the tables in the generators; never
hand-edit the outputs, and never commit them.

This package stays React-free. `@sidecar/panel` is the shared React layer that
traces the generated artwork into the real desktop panel and the marketing
mock, so provider geometry, row anatomy, face, glyphs, timing labels, and base
panel CSS have one implementation.
