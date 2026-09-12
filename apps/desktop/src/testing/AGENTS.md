# Test fixtures

Everything here is imported by tests alone, through the `#testing/*` alias, and
never by anything that ships. A fixture earns its place by having more than one
caller: a helper one test file needs stays in that file, where a reader can see
it beside the assertions it serves.

The shared ones, and the rule each carries:

- `native-helper.ts` — a `NativeHelperProcess` that never was, for the
  watchers over the macOS helpers: the test says what came back on stdout and
  reads what was written to stdin.
- `connection-fixtures.ts` — what a connection row is judged from and acted
  through, at a stated resting state and at every connection offered, with
  every action wired to nothing: the table's own tests and the row's read the
  same fixture, so neither can pass against a shape the other never sees.
- `spoken-setting-bridge.ts` — the bridge a spoken settings change crosses.

One fixture every test in the repository shares lives in
`@sidecar/runtime/testing` instead, because the host's tests are in a package
and a package cannot reach into an app: `temporaryDirectory(t)` (a directory
of the test's own, removed when the test ends, re-exported from
`@sidecar/wire/testing`, which every package here already reaches). The
brain composition and the operator a window's ask crosses went with the host
they compose, behind `@sidecar/host/testing`. P12-03 deleted the seam's
`FakeClock` and `drainMicrotasks` that used to stand beside `temporaryDirectory`
here: a test written on `it.effect` drives `TestClock` directly, and a plain
vitest test's own microtask wait is inlined at the one call site that needs
it rather than shared.

A test file does not hand-roll a temporary directory or a native-helper
process: `repository-checks.sh` fails the build on a `mkdtemp` under
`apps/desktop/src` or `packages/host/src`, because that is how the
hand-rolled copies always begin.
