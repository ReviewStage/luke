# Test fixtures

Everything here is imported by tests alone, through the `#testing/*` alias, and
never by anything that ships. A fixture earns its place by having more than one
caller: a helper one test file needs stays in that file, where a reader can see
it beside the assertions it serves.

The shared ones, and the rule each carries:

- `temporary-directory.ts` — a directory of the test's own, removed by
  `t.after`. A test that makes one by hand forgets the cleanup, and four of
  them had.
- `drain.ts` — `drainMicrotasks(ticks)`, which lets queued microtasks and
  immediates run. The tick count is the length of the await chain being
  waited out, stated rather than guessed; hand-rolled copies had settled on
  four different numbers for the same wait.
- `fake-clock.ts` — a clock the test drives, so a deadline is crossed without
  waiting out a real one. `advance` runs what is due, `fireAll` runs
  everything armed now and nothing a callback arms behind it.
- `native-helper.ts` — a `NativeHelperProcess` that never was, for the
  watchers over the macOS helpers: the test says what came back on stdout and
  reads what was written to stdin.
- `brain-harness.ts` — the agent, store, host, follower, delivery ledger,
  receiver, and submission path composed as the main process composes them,
  with only the model and the disk synthetic. Its pieces
  (`MemoryBrainStorage`, `heldModel`, `answered`) are exported on their own
  for the tests that compose the brain differently.
- `settings-fixtures.ts` — an `AppSettingsView` with every member at a stated
  value, so a test is told apart from the next only by what it moves.
- `realtime-fixtures.ts` and `spoken-setting-bridge.ts` — the browser surfaces
  the realtime session opens, and the bridge a spoken settings change crosses.
- `operator-over-brain.ts` — the operator a window's ask crosses, stood over
  one brain and one thread, so a test submits the way production does without
  composing the rest of the host. It lives here rather than beside the
  service because scaffolding for tests does not belong in the tree that
  ships.

A test file does not hand-roll a temporary directory, a microtask drain, a
clock, or a native-helper process: `repository-checks.sh` fails the build on a
`mkdtemp` or a `setImmediate` under `apps/desktop/src`, because those two are
how the hand-rolled copies always begin.
