# `@sidecar/realtime`

## `realtime-protocol` and `realtime-tools` now point one way

`realtime-tools.ts` imports `type RealtimeFunctionCall` from
`realtime-protocol.ts`, and the protocol imports nothing back. The cycle these
six modules were kept together for is gone: the spoken surfaces no longer
count tools, so the protocol has no reach into the tools.

So splitting a protocol package from a tools package is now possible where it
once was not. It is still a product decision rather than a tidying: the two
halves are read together by everything that speaks, and a split earns its
keep only if something outside needs one without the other. Until then, do
not add a module that points the protocol back at the tools; that would
restore the knot rather than inherit it.

## The guide's tests live here

`guide.test.ts` covers `@sidecar/guide` through the spoken tool grammar:
`REALTIME_TOOL`, the app-tool routing, and the protocol's own bounds. The
guide itself depends on nothing but `@sidecar/wire`; only its tests need the
protocol, and keeping them here is what stops guide and realtime depending on
each other.
