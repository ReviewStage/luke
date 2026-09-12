# Test fixtures

Everything here is imported by tests alone, through the `#testing/*` alias.
**A fixture earns its place by having more than one caller** — a helper one test
file needs stays in that file, where a reader can see it beside the assertions it
serves.

`repository-checks.sh` already fails the build on a hand-rolled `mkdtemp` under
`apps/desktop/src` or `packages/host/src`, because that is how the hand-rolled
copies always begin. What it cannot tell you is why the one shared fixture lives
where it does: `temporaryDirectory(t)` is in `@sidecar/runtime/testing`, not here,
because the host's tests are in a package and a package cannot reach into an app.

There is no shared clock or microtask helper any more. A test written on
`it.effect` drives `TestClock` directly, and a plain vitest test's microtask wait
is inlined at the one call site that needs it.
