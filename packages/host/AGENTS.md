# `@sidecar/host`

## Everything of the machine arrives as a seam

`composeHost` is handed the state root, the version, the environment, the cipher,
the store worker, and the id source, and derives none of them. Nothing here reads
the hosting process's own profile, so a validation run on a temporary state root
is the same composition as a live one.

**A seam that would be easier to read directly — `app.getPath`, `process.cwd`,
`Date.now` at a call site — is the one thing that would make this package the
desktop's again.** Nothing enforces this; it is a line you hold by hand.

The same goes for drawing: there is no `electron`, `react`, or DOM import here,
and the two files that needed one were split at that line into
`apps/desktop/src/main/ipc/` and `apps/desktop/src/main/native/`.

Every environment override is a `Config` read of the variable's own name, and a
credential is `Config.redacted` because the store hands one on to that provider's
adapter and nothing else. The settings store reads no environment itself — it is
handed what was resolved.

## Three shapes in the composition that are easy to undo

Each concern is a composer owning its own state, timers, and Gateway methods,
built as a scoped layer whose build runs `start` and whose scope closing runs
`stop`. Three details of that are load-bearing and look like accidents:

- **The stop is registered before the start runs**, not as the release of a
  successful acquire, because a composer's `stop` is written to give back what a
  partial or failed `start` allocated.
- **The layers are built sequentially, never merged.** `Layer.merge` builds its
  sides concurrently and closes them in parallel; a start that fails must release
  what began, in reverse, at once.
- **A cadence forks its scope from the one its composer was built in**
  (`cadenceGate`), so its fibers run on the host's own runtime and the host's
  close ends them whatever became of the stop.

A method two composers claim fails the build with `DuplicateGatewayMethod`, so
that one does not need stating here. `client.bootstrap` is the one method no
composer owns: it reads six of them, and giving it to any would hand that
composer references to the other five.

## One drain, in one place

The quit is the closing of the one scope the host layer was built in, and the
scope's finalizers are its order: drain, loops disarmed, every composer's stop in
reverse, store closed. The drain runs once whichever door asks for it.

**A caller that ran the steps itself would be a second order for the same quit,
and there is none to run. A shutdown never fabricates a completion for work it
cut off.**

## The live session reaches the brain through one door

**It reaches Luke's judgment only through `LiveBrain`** — a transport-neutral
contract of ids and plain data, because the roster stays with the brain. Nothing
in the service imports `@sidecar/brain`. The run event kinds are read by name and
never assumed exhaustive: a brain firing kinds this build does not know must
leave the adapter standing.

**The live service is the one sink for everything Luke says unprompted** — every
briefing, every run's streamed reply, and the two onboarding beats. At most one
spoken reply per run holds by construction, since a run's sentences reach the
voice only as that run's own events arriving here, each appended once in order
and none after the run's end.

The stop key's instruction is asked for only while Luke is speaking, since the
append is standing text a silent model would read as a rule for its next answer.
A muted microphone is read as nothing but `micLive = false`.

## Two doors that exist for the graph

`account-preferences-client.ts` would belong beside the vault client in
`@sidecar/hosted`, but the snapshot it carries is `@sidecar/settings` vocabulary
and `settings` already reaches `hosted`. This is the lowest package holding both.

`@sidecar/host/testing` holds the brain composition and the operator a window's
ask crosses, so nothing that ships can reach them.
