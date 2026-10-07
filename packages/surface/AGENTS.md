# `@sidecar/surface`

`repository-checks.sh` fails on drift in the generated files under
`src/generated/`, so regenerate from the design sources rather than hand-editing.

This package stays React-free. `@sidecar/panel` is the shared React layer that
traces the generated artwork into the desktop window, so the face and the glyphs
have one implementation.
