# `@sidecar/surface`

The design generators write their committed surface vocabulary to
`packages/surface/src/generated`: `motion-tokens.css`, `motion-tokens.ts`,
`provider-mark-paths.ts`, and `face-art.ts`. Regenerate those files from the design
sources; do not hand-edit them.

This package stays React-free. `@sidecar/panel` is the shared React layer that
traces the generated artwork into the real desktop panel and the marketing
mock, so provider geometry, row anatomy, face, glyphs, timing labels, and base
panel CSS have one implementation.

The urgency value set itself is `@sidecar/session`'s: a fixture snapshot and a
session model both name it, and neither may reach presentation for a value
set. What this package generates is only the wording and the ranking —
`URGENCY_LABEL`, `urgencyLabel`, `URGENCY_PRIORITY`, `compareSessionsByUrgency`
— so the marketing mock cannot advertise a different sentence or a different
top row than the product draws.

`geometry.ts`'s `PANEL_FORM_FACTOR` is this package's one wire-facing vocabulary:
`PanelFormFactorSchema` is declared beside the `as const` object as a
`Schema.Literal` over its values, and `isPanelFormFactor` is that schema's own
`Schema.is`, following `@sidecar/session`'s vocabulary-schema shape. The
generated files above name no guard and stay untouched by this: they hold
drawing tables the render layer indexes by a known key, never a value read
from persisted or renderer-supplied data.
