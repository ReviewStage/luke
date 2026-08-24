# `@sidecar/surface`

The design generators write their committed surface vocabulary to
`packages/surface/src/generated`: `motion-tokens.css`, `motion-tokens.ts`,
`provider-marks.ts`, and `face-art.ts`. Regenerate those files from the design
sources; do not hand-edit them.

This package stays React-free. `@sidecar/panel` is the shared React layer that
traces the generated artwork into the real desktop panel and the marketing
mock, so provider geometry, row anatomy, face, glyphs, timing labels, and base
panel CSS have one implementation.
