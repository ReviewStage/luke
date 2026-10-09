# Agent guide

Luke is a macOS Electron app for planning a feature by voice: the developer
talks a plan through with Luke, who writes it down as they go.

## Commands

| Command | What it does |
| --- | --- |
| `./scripts/bootstrap.sh` | Install pinned workspace dependencies |
| `./scripts/check.sh` | Portable repository, type, test, and build checks |
| `./scripts/verify.sh` | Complete macOS validation plus visual evidence |
| `./scripts/run.sh` | Launch against live sessions, replacing any running instance (`--fixture smoke`, `--keep-running`, `--no-trace`) |
| `./scripts/evidence.sh` | Write the fixture PNG under `artifacts/` |
| `pnpm release:macos` | Local signed, notarized, verified DMG, zip, and update manifest |
| `pnpm lint:fix` | Repository formatting and safe lint fixes |

`./scripts/verify.sh` is the completion invariant for any macOS or UI change. CI
runs the portable check on Linux alone, and no macOS job is coming back: Dean
ruled on 2026-09-11 that the release rehearsal (`release.yml`'s `macos-15` job,
run on a `v*` tag push or a manual dispatch) is the only Mac gate. A pull
request builds nothing for the Mac and produces no visual evidence, so a green
PR says nothing about the Mac and there is no macOS check to wait for. A UI
PR's evidence is the developer's own `verify.sh` run, its body must say CI could
not verify it, and a Mac break that lands anyway is caught at the rehearsal on a
tag, not at review. LUKE-159 is the manual `verify.sh` pass on a Mac that stands
in for the missing job before the first release.

## Never

- Never let a credential or account secret enter a Gateway answer or event, the
  voice window, a counted event, a trace, or a fixture. Nothing in this repository
  scans for secrets, so this rule is the whole of the check.
- Session replay records the rendered panel with every word masked
  (`apps/desktop/src/renderer/session-replay.ts`), so what leaves the machine is
  layout, not text; an unmasked attribute or a new way of drawing words is what
  would change that.
- Never add to this file (`AGENTS.md`, which `CLAUDE.md` links to) unless the
  user explicitly approved the addition.

## The scheduled sweep

Vercel's cron calls `/api/maintenance/sweep` once a minute (`apps/web/vercel.json`;
`apps/web/server/hosted/maintenance-sweep.ts`) under the deployment's own
`CRON_SECRET`, compared in constant time; a deployment missing that secret
answers unavailable and sweeps nothing. Each call purges the conversations
stamped deleted thirty days ago, settles as abandoned every turn still running
past its bound (`apps/web/server/hosted/store/abandoned-turns.ts`'s
`TURN_ABANDON`: an hour after it started, or twenty-five hours for a coding
agent's turn, whose one turn is its whole run), and ends on Luke's key every
voice session whose device detached and did not come back within the grace. It
reads no account's words and runs no model.

## Testing

```
./scripts/check.sh                       # everything CI runs
pnpm exec vitest run <path>              # one file
pnpm --filter @luke/web test:store       # store tests on a real Postgres
pnpm --filter @luke/web test:agent       # offline brain eval, scripted model
```

`check.sh` must exit 0. A Mac or UI change also needs `./scripts/verify.sh`
evidence; CI builds nothing for the Mac.

- Every behavior change ships with a test that fails without it, same PR.
- Use the smallest layer that catches the bug: a type or lint rule, then a
  test through the module's public export, then a real Postgres or child
  process (`test:store`), then `verify.sh` evidence for a Mac, a window, or
  a live provider.
- Tests are hermetic: one process, `TestClock`, a temp dir they made, PGlite.
  No network, personal data, live provider, or real clock. They pass alone
  and in any order.
- Prefer the real implementation, then a fake, then a stub. A double is a
  test `Layer` on the subject's `Context.Tag` at a process boundary: provider
  HTTP, Apple, the model, the OS, the clock.
- Assert what a caller observes, never private state or call counts.
- Use the shared builders before inline setup: `packages/host/src/testing/`,
  `apps/web/tests/support/`, `packages/wire/src/testing/`, and
  `temporaryDirectory` from `@sidecar/runtime/testing`.
- Effect tests use `it.effect` and `TestClock.adjust`. `Effect.run*`,
  `Runtime.run*`, and `ManagedRuntime.make` in a test file fail lint
  (`testing/no-runner`); `setTimeout`, `setInterval`, `Effect.sleep`, and
  `it.live` fail lint (`testing/no-real-time`).
- Goldens change only under `LUKE_UPDATE_FIXTURES=1` through the shared
  helpers, with the diff explained in the PR.
- Never loosen, delete, or skip a test to go green. `.only`, `.skip`,
  `.todo`, and `it.flakyTest` fail lint (`testing/no-focus-or-retry`). Fix
  or delete a flaky test.
- Do not write change-detector tests: an expected value computed by the code
  under test or pasted from its output; a test of a getter, constant, type,
  re-export, or Schema round-trip on a valid value; a test that only asserts
  a fake was called; a private function exported for a test.

`tools/oxlint/testing/test-edges.json` holds the files not yet on these rules:
`runnerHoldouts` and `realTimeHoldouts` only shrink and are deleted with their
last entry. `liveClockTests` is permanent, for a subject that is a real socket
or process timeout; `it.live` is allowed only there, and each entry is named
here with its reason:


## Effect idioms

Effect is the repository's infrastructure library, replacing what used to be
hand-rolled: a Schema that both parses and emits JSON Schema, disposables,
an event emitter, independent backoff loops, `setInterval` loops, a
semaphore, single-flight, bounded queues, an idempotency ledger, a worker RPC,
an injected clock seam, and a fake clock beside it. `effect` is pinned at
`4.0.0-rc.115` through the pnpm catalog in `pnpm-workspace.yaml` and nowhere
else — every workspace that reaches it declares `"effect": "catalog:"`, so one
copy resolves across the repository, which is what keeps a `Context.Service`
minted in one package the same service in another. `@effect/platform`,
`@effect/rpc`, `@effect/sql`, and `@effect/experimental` are consolidated into
`effect` itself and reached at `effect/unstable/*`; `@effect/platform-node`,
`@effect/sql-pg`, `@effect/atom-react`, and `@effect/vitest` stay separate, each
on the same `4.0.0-rc.115` through the same catalog. The pin is an exact release
candidate rather than a range, moved deliberately, and re-evaluated once Effect
ships `4.0.0` stable.

### Where an Effect may run

An Effect describes work; only a runtime edge runs one. The edges are listed
in `tools/oxlint/anti-slop/effect-edges.json`'s `runtimeEdges`: `apps/desktop/src/main/main.ts`
(the desktop's one `ManagedRuntime`), `apps/desktop/src/main/services/compose-desktop.ts`
(the layer that runtime is built from), the renderer root
`apps/desktop/src/renderer/index.tsx` (loaded once per window, the panels and
the voice window alike, so no two windows share a browser registry),
`apps/desktop/src/renderer/renderer-runtime.ts` (the module the root's
runtime is built from: `Atom.runtime`'s layer is built, and `AtomRegistry.get`
reads it, the moment the root first reaches it, so the edge is here rather than
at the root that imports it), the renderer's own fiber sites — the
voice window's `apps/desktop/src/renderer/voice/live-call.ts` and
`apps/desktop/src/renderer/voice/use-voice-session.ts` — the web's own
module-scope memoized runtime `apps/web/server/runtime.ts` and the three doors
that hold its `runWeb`: `apps/web/server/route-effect.ts` (the adaptor every
function module under `apps/web/server/routes/**` exports its `HttpRouter`
through, which reads that runtime once per instance and lets the handler it
builds do its own running), `apps/web/server/voice/function.ts`
(the voice service, stood for a function instance's life rather than for a
request, so there is no request fiber to compose it into) and
`apps/web/server/seed-clients.ts` (the OAuth client seeding command, run as
its own process), the eve project's authored files —
`apps/web/eve/agent.ts`, `apps/web/eve/channels/eve.ts`,
`apps/web/eve/hooks/store.ts`, `apps/web/eve/instructions/prompt.ts`,
`apps/web/eve/instructions/seed.ts`, and `apps/web/eve/tools/brain.ts` — each
an edge because eve drives them through promise-shaped hooks of its own and
an authored file is where this deployment runs what it hands eve — and
`apps/web/eve/host.ts`, the one module those files share their host through,
which composes the production seams over `HostedEnvironment` with
`Effect.runSync` as it loads, because the channel's door takes the
deployment's secret as a value and the environment read suspends on nothing —
and the coding-agent eve project's authored files on the same terms —
`apps/web/coder/agent.ts`, `apps/web/coder/channels/eve.ts`,
`apps/web/coder/hooks/store.ts`, `apps/web/coder/instructions/prompt.ts`, and
`apps/web/coder/sandbox.ts` (the sandbox selector, which eve calls as a
promise when a tool first needs the sandbox and which runs the checkout
there), each an edge because eve drives them through promise-shaped hooks of
its own, and `apps/web/coder/host.ts`, the one module those files share their
host through, composed with `Effect.runSync` as it loads for the same reason
`apps/web/eve/host.ts` is. Not
every seam under `apps/web/server/hosted/` is an effect down to its floor:
`hosted/brain-host/production.ts`'s `spend` is
the AI SDK's async middleware, and `hosted/brain-host/door.ts`'s
`SessionOwnership` speaks eve's own `AuthFn<Request>` — two promise-shaped
foreign boundaries the effects around them compose over rather than
replace, `apps/web/server/db/migrate.ts` (the migration command, through
`NodeRuntime.runMain`), `apps/web/scripts/preview-probe.ts` (the deployed-shape
probe, same terms), and `tools/trace-export/src/cli.ts` (the trace command).
`Effect.runPromise`, `Effect.runSync`, `Effect.runFork`, their
`runPromiseExit`/`runSyncExit`/`runCallback` siblings, and the `…With` form of
any of them — which is where a `Runtime<R>` went, v4 having removed the type —
belong nowhere else — everything between the edges returns an Effect and lets its caller
decide — which the oxlint rule `no-run-promise-outside-edges` enforces against
that same file's `runtimeEdges`, `runShims`, and `runOnHandedRuntime` lists,
reading `apps/web/server/runtime.ts`'s own `runWeb` and `webRuntime` as the
runs they are, so a module that holds the edge's runner rather than
`Effect.runPromise` itself is no less visible to it;
`no-raw-async-primitives` enforces the equivalent for `setTimeout`,
`setInterval`, `new Promise`, `AbortController`, and `fs.watch` against its
`rawAsyncPrimitives` list. A file on those two run lists that is not a runtime
edge above is a permanent adaptor, listed below with the one thing that keeps
it from ever moving onto the edges themselves; there is no other kind of row
on those lists, because a shim on its way to deletion is deleted in the same
PR that finishes the callers it was for, not left as a name on an allowlist.

### The permanent adaptors

- **`packages/runtime/src/effect/single-flight.ts`** — the check-and-create of
  the one `Deferred` every concurrent caller joins is an uninterruptible step
  that cannot suspend, so it runs synchronously (`Effect.runSync`) and forks
  the flight it decided on as a detached root fiber (`Effect.runFork`) rather
  than a fiber of whoever asked first, because a caller that gives up on its
  own await must not take the flight the other callers are still joined to.
- **`packages/host/src/host-kernel.ts`** — `openExternalThroughNode`, the one
  promise door the kernel keeps over `NodeRegistry#invoke`'s effect: the
  composer that hands it on hands it to a seam outside this repository's host
  package — the account session manager's consent
  (`packages/credentials/src/loopback-consent.ts`, whose `openExternal` is a
  `void | Promise<void>` and whose `reopen()` is synchronous) — so what would
  end this row is a decision about that seam rather than an implementation
  detail of this door.
- **`apps/desktop/src/main/app-state.ts`** — `AppStateStore`'s `snapshot`,
  `update`, and `touch` run their `SubscriptionRef` operation through
  `Effect.runSyncWith` on the services the launch handed them, never an empty
  context of their own, because every caller but the one production subscriber
  (which forks over the store's `changes` Stream) still holds a synchronous
  object, and the ordering those callers and this file's own tests depend on —
  a listener's patch is not lost, a re-announce lands before the caller's next
  statement — is what turning them into effects a caller awaits would give up.
- **`apps/desktop/src/main/update-service.ts`** — synchronous Electron
  IPC/menu callers (start, check, install) bridge into fibers on the services
  the launch handed them, on the same terms as `app-state.ts` beside it.
- **`packages/voice/src/orchestrator/live-voice-orchestrator.ts`** — the notice
  strip's two clocks, armed from callbacks belonging to no fiber of their own,
  start on the services the orchestrator was constructed with; the standing
  call's lifecycle is a `forkDetach` and needs no door.
- **`apps/web/server/db/drizzle.ts`** — the Drizzle bridge, ported from
  `@effect/sql-drizzle` because that plugin peers the v3 line and a second
  copy of `effect` in the tree would make a `Context.Service` minted in one
  copy a different service in the other. Drizzle's proxy driver renders a
  statement and awaits a promise for its rows, and the callback it awaits
  takes the SQL and nothing else, so the door is `Effect.runPromiseExitWith`
  on the context the yielding fiber was carrying, squashed to the `SqlError`
  Drizzle re-wraps. One thing about that run is deliberate and is not to be
  tidied away. A raw `SqlClient` statement is a wait for the pool's
  connection, and Effect resumes a waiter inside the stack of whoever released
  it, so a raw statement hands its caller back in the releasing caller's
  `AsyncLocalStorage` context rather than the one it asked from. Nothing
  authored under `apps/web/eve/` stands on that context: with two sessions
  running turns in one process it is the other session's, so the hook and
  the prompt resolver pin their `defineState` handles where they are entered
  (`apps/web/server/hosted/brain-host/pinned-state.ts`, held by `apps/web/tests/eve-pinned-state.test.ts`).
  The door's own root fiber would absorb that handoff and leave the asking
  fiber in the context it registered its `then` in, so the door reproduces
  the handoff on purpose: it snapshots the async context in a finalizer
  inside the run, which is the tick the statement settled on, and the patched
  `evaluate` resumes the asking fiber inside that snapshot through
  `Effect.callback`, whose `resume` continues that fiber's loop on the stack
  it is called from. What the bridge owes is the raw statement's answer
  and not one of its own, and `apps/web/tests/drizzle-bridge.test.ts` reads
  one against the other on both dialects. Handing that run to an edge is what
  cannot be done: the
  context is the point — an enclosing `sql.withTransaction`'s connection is a
  service of the running fiber and of no runtime an edge built — so the run
  has to happen where the fiber is, which is inside the callback Drizzle
  calls. The handle the bridge hands out is no service and no layer, and
  minting one would be a regression rather than a tidy-up: it carries no
  capability, so a `Context.Service` over it would add a requirement to every
  query module that answers `Effect<A, SqlError | Schema.SchemaError,
  SqlClient>` today and buy nothing, and reading the client from the fiber
  instead is the same thing that keeps a bridged query inside the transaction
  around it.
- **The test-support edges** — `apps/web/tests/support/sql-client.ts`,
  `apps/web/tests/support/no-database.ts`,
  `apps/web/tests/support/hosted-store-database.ts`,
  `apps/web/eve/evals/brain-host.eval.ts`, `apps/web/coder/evals/coder.eval.ts`, and
  `packages/wire/src/testing/effect.ts` each build a runner (a
  `ManagedRuntime` over a throwaway database, a `SqlClient` that refuses every
  statement) so a suite or an offline eval still written on `node:assert` or a
  plain fixture can hold a promise where an effect is described; a test body is
  its own edge.

### Vocabulary

`SchemaRead` (`@sidecar/wire`) is the boundary result vocabulary a Schema
decode answers when the result crosses IPC or the wire — a `Result` inside a
process, a `SchemaRead` where a caller on the other side of a process boundary
reads it: `apps/desktop/src/shared/messages/acts.ts`,
`packages/wire/src/effect/json-schema.ts`, and
`apps/web/server/hosted/store/message-reads.ts` all produce or read it.

### Idioms

- Schema at the boundary a value crosses, never a hand-written parser beside a
  hand-written shape.
- Drizzle's query builder is the web server's statement layer, never a raw
  `sql` template beside it: a query module builds over the tables its own
  `apps/web/server/db/*-schema.ts` declares, through the one handle
  `apps/web/server/db/query.ts` holds, and still answers `Effect<A, SqlError |
  Schema.SchemaError, SqlClient>` with its rows still Schema-decoded. The
  modules are hand-maintained beside hand-written migrations — `drizzle-kit`
  generates nothing — and `apps/web/tests/drizzle-schema.test.ts` compares
  them against `information_schema` in both directions, so a migration that
  drops a column deletes it from its module in the same PR.
  `apps/web/server/README.md`'s "The data layer" is the whole of it.
- Runtime only at an edge above; everywhere else returns an Effect.
- `Scope`, not a `dispose()` a caller must remember to call.
- `Schedule`, not a hand-rolled interval or backoff loop.
- `TestClock`, not a fake clock: a test that waits on time advances the clock
  rather than arming a real `setTimeout` its own runner has to outlive.
- `MutableRef` for a synchronous facade over state a synchronous caller reads
  and writes as statements, when the fence it stands for must be up before the
  caller's next statement.
- `Effect.runPromiseExit` and `Cause.squash` at a promise door, so a caller
  still holding a `Promise` sees the same rejection shape an `Effect.tryPromise`
  would have caught, not a fiber's own defect representation.
- No `Effect.raceFirst` over an uninterruptible region: a race that loses
  interrupts the loser, and a fiber inside an uninterruptible region cannot be
  interrupted, so the race never resolves.
- `Effect.forkDetach` and a join for a deadline that must run inside an
  uninterruptible region, since the fork itself has to survive the region even
  when its result does not.
- A fork does not inherit the interrupt status of whoever forked it, so a body
  forked from inside an `Effect.acquireRelease` acquire, a finalizer, or any
  other uninterruptible region is interruptible unless it asks not to be.
- A discarded Effect, Stream, or Layer statement is a bug, not a fire-and-forget:
  `pnpm discarded-effect` refuses an expression statement of one of those
  types, `void` and `await` included, because an Effect is not thenable and a
  description a caller walks past runs nothing.
- Effect's `Clock` does not unref its timer: a wait armed on it references the
  host's event loop for as long as it stands, so a store with an automatic
  reset enabled holds its host open for as long as its generation does: mind
  this when the caller is a process that would otherwise exit.
- A bundle-budget baseline moves only for a deliberate library adoption, never
  for drift a deletion happened to leave behind (`apps/desktop/bundle-budget.json`,
  checked with 5% slack).

## Code style

The model is Redis. Full rules with sources and examples in `docs/STYLE.md`.

- Fight complexity by not creating it. Every dependency, layer, and
  abstraction earns its lines or is refused.
- Order a file: header, imports, constants, private helpers, public API,
  entry points last. Line one: `name.ts -- one line of purpose.`
- Name by layer then verb. Guard early, one exit. Assert invariants.
- A function is read in one pass. Files may be long; functions may not.
- One-line guide comments inside functions. Why comments talk: "Note that
  we X, because Y." Design comments sit above the function. No trivial
  comments.

## TypeScript

- No stringly typed fixed value sets. Use `as const` SCREAMING_SNAKE_CASE objects,
  derive unions with `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the
  constants at call sites. Raw strings are only for freeform user-facing text.
- Never build a key by concatenating or interpolating identifiers. Use nested
  objects or nested `Map`s keyed by the original identifiers.
