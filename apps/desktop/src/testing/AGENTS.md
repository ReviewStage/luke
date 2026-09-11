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

Three fixtures every test in the repository shares live in
`@sidecar/runtime/testing` instead, because the host's tests are in a package
and a package cannot reach into an app: `temporaryDirectory` (a directory of
the test's own, removed by `t.after` — a test that makes one by hand forgets
the cleanup, and four of them had), `drainMicrotasks(ticks)` (the tick count
is the length of the await chain being waited out, stated rather than guessed;
hand-rolled copies had settled on four different numbers for the same wait),
and `FakeClock` (a clock the test drives, so a deadline is crossed without
waiting out a real one). The brain composition and the operator a window's
ask crosses went with the host they compose, behind `@sidecar/host/testing`.

A test file does not hand-roll a temporary directory, a microtask drain, a
clock, or a native-helper process: `repository-checks.sh` fails the build on a
`mkdtemp` or a `setImmediate` under `apps/desktop/src` or `packages/host/src`,
because those two are how the hand-rolled copies always begin.
