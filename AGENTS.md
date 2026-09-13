# Agent guide

Luke is a macOS-first Electron sidecar that observes coding-agent sessions while
preserving existing provider workflows.

## Commands

| Command | What it does |
| --- | --- |
| `./scripts/bootstrap.sh` | Install pinned workspace dependencies |
| `./scripts/check.sh` | Portable repository, type, test, and build checks |
| `./scripts/verify.sh` | Complete macOS validation plus visual evidence |
| `./scripts/run.sh` | Launch against live sessions, replacing any running instance (`--fixture smoke`, `--keep-running`, `--no-trace`) |
| `./scripts/evidence.sh` | Write the fixture PNG under `artifacts/` |
| `pnpm evidence:record` | Record the fixture transition on a physical Mac |
| `pnpm release:macos` | Local signed, notarized, verified DMG, zip, and update manifest |
| `pnpm lint:fix` | Repository formatting and safe lint fixes |

`./scripts/verify.sh` is the completion invariant for any macOS or UI change. CI
runs the portable check on Linux alone, and no macOS job is coming back: Dean
ruled on 2026-09-11 that the release rehearsal (`release.yml`'s `macos-15` job,
run on a `v*` tag push or a manual dispatch) is the only Mac gate, recorded on
`orchestration/storage-plan` at `e7b57a9a` in `plan/decisions.md`. A pull
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
- Session replay records the rendered panel with no allowlist in front of it, so
  drawing something new on the panel decides what leaves the machine.

## The scheduled pass and the briefing push

- The one observation that runs on a clock of Luke's own is the service's
  scheduled pass, and it is bounded on every side. Vercel's cron calls
  `/api/observation/tick` once a minute (`apps/web/vercel.json`;
  `apps/web/server/hosted/observation-tick.ts`) under the deployment's own
  `CRON_SECRET`, compared in constant time, and a deployment missing that secret
  or the key-encryption secret answers unavailable and observes nothing, since a
  pass that could read no key would be written down as an account with nothing.
  It runs only for an account that holds a synced cloud provider key and has a
  device row seen within the last 7 days
  (`OBSERVATION_TICK.ACCOUNT_SEEN_WITHIN_MS`; `listEligibleAccounts` in
  `apps/web/server/observation-app.ts`), at most 200 accounts a tick, least
  recently attempted first, four at a time inside a 50-second budget with a
  25-second deadline per account; and every tick begins by dropping the
  snapshot, the waiting diffs, the brain's bookmark, and the pass record of
  every account no longer eligible, so a deleted key or a week's silence ends
  the observation and empties what it kept. One account's pass is the same
  read-only fan-out the on-demand endpoint runs, on a plugin built for that
  pass alone under the account's decrypted key (`observation-pass.ts` over
  `cloud-observe.ts`): the workspaces, the chats, each chat's status, the agent
  kinds, and the projects the provider reports, and no chat's messages. A pass
  every provider answered whole replaces the account's one `roster_snapshot`
  row, sealed under the same server-only secret as the keys and stamped with a
  fingerprint of the key it was observed under, so a snapshot observed under
  another key is neither served, admitted against, nor diffed from; a pass any
  provider refused, rate limited, or failed leaves the previous snapshot
  standing and is recorded as failed. Nothing in the pass decides anything: no
  model runs in it, and nothing leaves it. What the snapshot is kept for is the
  opener (`apps/web/server/hosted/brain-host/opener.ts`), which runs for the
  same account right after its pass and under the same deadline: it derives
  what changed by diffing the snapshot the pass just wrote against the bookmark
  it last kept level with a snapshot (`roster_consumed`), and hands the hosted
  brain one observation turn per session the diff named, at most eight turns an
  account a tick with a hold's releases counted among them, as the deployment
  acting for that one account under the tick's own secret
  (`EVE_CALLER.DEPLOYMENT`), so the account named to the brain is only ever one
  this tick enumerated, and nothing but such a diff or a hold's release opens a
  scheduled turn. A visit that could not hand its change over leaves the
  bookmark where it was, and the next visit derives the same change again,
  wider by whatever moved since, until the two rows stand more than five
  minutes apart on their own instants (`OBSERVATION_TICK.STALE_GAP_MS`), which
  means no visit has caught the brain up for that long (a paused cron, a deploy
  gap, a rotated secret, a provider refusing every pass, or the brain refusing
  every turn): the visit then reseeds the bookmark from the snapshot as it
  stands, wakes nothing from the gap, and counts the reseed in the tick's
  answer as `turns.reseeded`, because what changed in between is history the
  roster already shows and not news. A visit with nothing to wake keeps the
  bookmark level with the snapshot all the same, so an idle roster never reads
  as a gap, and the next change under a reseeded bookmark wakes as usual. The
  wake carries the session as the snapshot holds it and its change in words
  rendered as data, and, for a chat the diff named, what its transcript gained
  since the cursor kept for it, read through the provider's documented
  incremental read (Conductor's `transcriptSince`) under the same synced key,
  cut from the front to 20,000 characters (`BRAIN_HOST.TRANSCRIPT_DELTA_CHARS`),
  its cursor advanced only past one the provider handed back and only once the
  brain has accepted the turn. That read is the one place a scheduled turn
  reads a message; the pass itself never does. Widening what the pass reads,
  who it runs for, how long a snapshot stands, how wide a gap still wakes, or
  what a wake carries is a product decision, not an implementation detail, and
  `PRIVACY.md` discloses the pass under "Scheduled observation of your
  Conductor sessions".
- Luke's words leave his own service unbidden in one place, and it is the
  service rather than this Mac they leave from: the briefing push to a phone
  (`apps/web/server/hosted/speech-push.ts`), run on the scheduled tick after the
  speech sweep and by nothing else. What it may carry is only a briefing the
  brain has already decided, the settled `announce` call's own words read back
  from the announcing row under the tool's 600-character bound
  (`briefing-words.ts`; `maximumBriefingLength`), and it decides from two things
  it reads and nothing it infers: how the offer stands, and what the account's
  devices last reported of themselves. No Mac reporting itself active means the
  words are pushed now; a Mac active but not claiming within two minutes of the
  offer (`SPEECH_PUSH.GRACE_MS`) means they are pushed anyway; a claim means a
  device is saying them and the offer is never pushed, whatever became of the
  claim; a quiet instant standing on any device of the account, a meeting its
  calendar hold observes, means nothing is pushed and nothing expires until it
  lifts; and an offer past its own instant is the sweep's to end, never pushed
  stale. A phone or watch reporting itself present is no reason to wait, since
  neither can say a briefing (`SPEAKING_PLATFORMS`). The mark precedes the send:
  `markSpeechPushed` settles the offer under the conversation's lock, only a
  mark that landed is sent, and the next tick finds it settled, so what is
  guaranteed is at most one push per briefing, never that it arrived; a send
  Apple refused or the network dropped is counted, ends the pass, and is retried
  nowhere, and a token Apple reports gone deletes that device's row. One device
  is addressed, the account's most recently seen device holding a push token,
  because a phone forwards to its paired watch itself and two pushes would be
  one briefing told twice. The notification (`briefingNotification`) is the
  words as the alert body, the default sound, the ordinary interruption level
  that breaks through no Focus, and one custom key, the pushed message's id
  (`BRIEFING_PUSH_PAYLOAD_KEY.MESSAGE_ID` in
  `packages/hosted/src/device-wire.ts`), an opaque UUID of Luke's own that the
  phone's tap opens the Conversation at; no title, subtitle, thread, or collapse
  key, and no session title, branch, path, error line, or identity beyond what
  the words themselves contain. It is readable on a locked screen and Apple
  carries it under its own terms, which is why the words and that id are the
  whole payload. A deployment without the Apple credential (`APNS_ENVIRONMENT`)
  constructs no sender and pushes nothing, the same kill switch every hosted
  endpoint keeps. Widening what a push carries, when it is sent, or which
  platforms it waits for is a product decision, not an implementation detail,
  and `PRIVACY.md` says each in as many words under "Briefing notifications" and
  the Apple line of "Who we send it to".

## Effect idioms

Effect is the repository's infrastructure library, replacing what used to be
hand-rolled: a Schema that both parses and emits JSON Schema, disposables,
an event emitter, independent backoff loops, `setInterval` loops, a
semaphore, single-flight, bounded queues, an idempotency ledger, a worker RPC,
an injected clock seam, and a fake clock beside it. `effect` is pinned at
`3.22.2`, the newest 3.x release, through the pnpm catalog in
`pnpm-workspace.yaml` and nowhere else — every workspace that reaches it
declares `"effect": "catalog:"`, so one copy resolves across the repository,
which is what keeps a `Context.Tag` minted in one package the same service in
another. `@effect/platform` joins at `0.97.2`, `@effect/sql`/`@effect/sql-pg`
at `0.52.1`, and `@effect/experimental` at `0.61.1`, each the newest release
whose peer range accepts that `effect`. Effect 4 is not adopted: its release
line is a release candidate as of this writing, and `@effect/platform`,
`@effect/sql`, and `@effect/rpc` each ship a stable line against 3.x only; the
decision is re-evaluated once Effect 4 has a stable release and all three ship
4-compatible stable lines against it.

### Where an Effect may run

An Effect describes work; only a runtime edge runs one. The edges are listed
in `tools/oxlint/anti-slop/effect-edges.json`'s `runtimeEdges`: `apps/desktop/src/main/main.ts`
(the desktop's one `ManagedRuntime`), `apps/desktop/src/main/services/compose-desktop.ts`
(the layer that runtime is built from), `apps/desktop/src/main/store-worker.ts`
and `packages/brain/src/store/worker-entry.ts` (the store's worker thread, its
own edge because a worker starts from its own file), the two renderer roots
`apps/desktop/src/renderer/index.tsx` and `apps/desktop/src/renderer/voice/index.tsx`
(one browser `ManagedRuntime` each, so the panel and the voice window never
share a registry), `apps/desktop/src/renderer/renderer-runtime.ts` (the module
each root's runtime is built from), the renderer's own fiber sites —
`apps/desktop/src/renderer/introduction/introduction-takeover.tsx` and the
voice window's `apps/desktop/src/renderer/voice/live-call.ts` and
`apps/desktop/src/renderer/voice/use-voice-session.ts` — each `apps/web/api/**`
function module through the module-scope memoized runtime `apps/web/server/runtime.ts`
holds, `apps/web/server/db/migrate.ts` (the migration command, through
`NodeRuntime.runMain`), `apps/web/scripts/preview-probe.ts` (the deployed-shape
probe, same terms), and `tools/trace-export/src/cli.ts` (the trace command).
`Effect.runPromise`, `Effect.runSync`, and `Effect.runFork` belong nowhere
else — everything between the edges returns an Effect and lets its caller
decide — which the oxlint rule `no-run-promise-outside-edges` enforces against
that same file's `runtimeEdges`, `runShims`, and `runOnHandedRuntime` lists;
`no-raw-async-primitives` enforces the equivalent for `setTimeout`,
`setInterval`, `new Promise`, `AbortController`, and `fs.watch` against its
`rawAsyncPrimitives` list. A file on those two run lists that is not a runtime
edge above is a permanent adaptor, listed below with the one thing that keeps
it from ever moving onto the edges themselves; there is no other kind of row
on those lists, because a shim on its way to deletion is deleted in the same
PR that finishes the callers it was for, not left as a name on an allowlist.

### The permanent adaptors

- **`packages/brain/src/effect/carry.ts`** — `detachOn`, the brain's detach
  door: `Runtime.runFork` starts on the calling stack while `Effect.fork`,
  `forkIn`, and `forkDaemon` hand the work to the scheduler instead, and only
  a run makes `BrainAgent#enqueue`'s acquisition (what `busy()` reads) stand in
  the step that detached. The same file's `runtimeExit` is the shared door
  `packages/brain/src/client.ts`'s `BrainTransport#send` (`runCall`) and
  `packages/devtrace/src/brain-trace.ts`'s `tracedModelAdapter` both run
  through, because every caller of the brain's model transport still holds a
  promise and the `ModelAdapter` interface it answers is one: `compaction.ts`
  is a port of OpenClaw `b7528507` that awaits `model.respond` and imports
  nothing from `effect`, so no adapter above this transport can answer an
  effect while that port stands.
- **`packages/brain/src/store/store-client.ts`** — `StoreClient`'s promise
  face over the store's Rpc client: `BrainStateRepository` and `ChildStore`
  are read by OpenClaw ports (`state-store.ts`, `children.ts`) that may not
  import `effect`, so neither interface can be stated as effects while its
  port stands. What would end this row is a decision about the ports
  themselves, not an implementation detail of this migration.
- **`packages/brain/src/store/database.ts`** — `StoreDatabase#run`, the
  synchronous accessor two OpenClaw ports reach the store through:
  `archives.ts` and `maintenance-run.ts` import nothing from `effect` and hold
  a database handle, so the tables they read answer through the door's old
  synchronous signature rather than an effect.
- **`packages/brain/src/generation.ts`** — `retireGeneration`'s `Scope.close`
  over `Effect.runSync`: which generation stands is a `MutableRef`, so the
  fence a replacement raises is up before the caller's next statement with no
  run anywhere in the open, but the close is two synchronous finalizers
  (the abort signal every wait settles on, the runtime's own context) that
  must stand nowhere before the caller's next statement either — a `Scope` is
  what already states reverse order and closing exactly once, so the row is
  bookkeeping for a synchronous fence rather than a deletion owed.
- **`packages/credentials/src/single-flight.ts`** — the check-and-create of
  the one `Deferred` every concurrent caller joins is an uninterruptible step
  that cannot suspend, so it runs synchronously (`Effect.runSync`) and forks
  the flight it decided on as a daemon of the default runtime
  (`Effect.runFork`) rather than a fiber of whoever asked first, because a
  caller that gives up on its own await must not take the flight the other
  callers are still joined to.
- **`packages/host/src/compose-calendars.ts`** — the calendars composer forks
  its observation-driven fibers (the held-notice release, the Apple access
  poll, the meeting-boundary wake) from synchronous callbacks — a finalizer,
  the composer's own lifetime — onto the runtime its own layer was built on.
- **`packages/host/src/host-kernel.ts`** — `openExternalThroughNode`, the one
  promise door the kernel keeps over `NodeRegistry#invoke`'s effect: the three
  composers that hand it on hand it to seams outside this repository's host
  package — the account session manager's consent
  (`packages/credentials/src/loopback-consent.ts`, whose `openExternal` is a
  `void | Promise<void>` and whose `reopen()` is synchronous), the calendar
  sign-in's page (`packages/calendar/src/oauth.ts`), and the roster
  subscriber's created-workspace open, a synchronous listener — so what would
  end this row is a decision about those seams rather than an implementation
  detail of this door.
- **`apps/desktop/src/main/app-state.ts`** — `AppStateStore`'s `snapshot`,
  `update`, and `touch` run their `SubscriptionRef` operation through
  `Runtime.runSync` on the launch's own runtime, never a second one, because
  every caller but the one production subscriber (which forks over the
  store's `changes` Stream) still holds a synchronous object, and the
  ordering those callers and this file's own tests depend on — a listener's
  patch is not lost, a re-announce lands before the caller's next statement —
  is what turning them into effects a caller awaits would give up.
- **`apps/desktop/src/main/update-service.ts`** — synchronous Electron
  IPC/menu callers (start, check, install) bridge into fibers on the launch's
  own runtime, on the same terms as `app-state.ts` beside it.
- **`packages/gateway/src/client.ts`** — `GatewayClient#take` forks its
  reconnection with `Runtime.runFork` on the calling stack, because a gap
  must open its reconnection on the tick that found it: `Effect.fork*` would
  hand the work to the scheduler and move the in-flight count
  `node-invocations.test.ts` asserts on the statement right after a publish.
- **`packages/voice/src/orchestrator/live-voice-orchestrator.ts`** — one
  `runFork`, blocked on Effect itself: a fork cannot be both detached and
  started at once.
- **`packages/runtime/src/children.effect.ts` and
  `packages/runtime/src/queue.effect.ts`** — each wraps an OpenClaw port
  (`children.ts`, `queue.ts`) that awaits promises and may not import
  `effect`, so the Effect sibling runs on the runtime its caller handed it
  rather than one it builds; `packages/runtime/src/lanes.ts` and
  `packages/runtime/src/lanes.effect.ts` are the same port and sibling shape,
  on the raw-primitive allowlist rather than this one.
- **`packages/brain/src/asks.ts`** — `PendingInputQueue`'s debounce takes two
  closures (`queueTimersOn`) over one of the agent's own armed waits, because
  the queue is the same kind of OpenClaw port and may not import `effect`.
- **The test-support edges** — `apps/web/tests/support/sql-client.ts`,
  `apps/web/tests/support/no-database.ts`,
  `apps/web/tests/support/hosted-store-database.ts`,
  `apps/web/eve/evals/brain-host.eval.ts`, `packages/brain/src/store/testing.ts`,
  and `packages/wire/src/testing/effect.ts` each build a runner (a
  `ManagedRuntime` over a throwaway database, a `SqlClient` that refuses every
  statement, a synchronous database handle) so a suite or an offline eval
  still written on `node:assert` or a plain fixture can hold a promise where
  an effect is described; a test body is its own edge.

### Vocabulary

`SchemaRead` (`@sidecar/wire`) is the boundary result vocabulary a Schema
decode answers when the result crosses IPC or the wire — an `Either` inside a
process, a `SchemaRead` where a caller on the other side of a process boundary
reads it: `apps/desktop/src/shared/messages/acts.ts`,
`packages/hosted/src/reads-wire.ts`, `packages/hosted/src/live-contract.ts`,
`packages/wire/src/effect/json-schema.ts`, `packages/brain/src/ui-message-context.ts`,
and `apps/web/server/hosted/store/message-reads.ts` all produce or read it.

### Idioms

- Schema at the boundary a value crosses, never a hand-written parser beside a
  hand-written shape.
- Runtime only at an edge above; everywhere else returns an Effect.
- `Scope`, not a `dispose()` a caller must remember to call.
- `Schedule`, not a hand-rolled interval or backoff loop.
- `TestClock`, not a fake clock: a test that waits on time advances the clock
  rather than arming a real `setTimeout` its own runner has to outlive.
- `MutableRef` for a synchronous facade over state a synchronous caller reads
  and writes as statements, when the fence it stands for must be up before the
  caller's next statement (`generation.ts` above).
- `Effect.runPromiseExit` and `Cause.squash` at a promise door, so a caller
  still holding a `Promise` sees the same rejection shape an `Effect.tryPromise`
  would have caught, not a fiber's own defect representation.
- No `Effect.raceFirst` over an uninterruptible region: a race that loses
  interrupts the loser, and a fiber inside an uninterruptible region cannot be
  interrupted, so the race never resolves.
- `Effect.forkDaemon(interruptible)` and a join for a deadline that must run
  inside an uninterruptible region, since the fork itself has to survive the
  region even when its result does not.
- Fork an `Effect.interruptible` body from inside an `Effect.acquireRelease`
  acquire, a finalizer, or any other uninterruptible region: a fiber inherits
  the interrupt status of whoever forked it, so a fiber forked uninterruptible
  is one no `Fiber.interruptFork` or `Scope.close` can ever end.
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

## TypeScript

- No stringly typed fixed value sets. Use `as const` SCREAMING_SNAKE_CASE objects,
  derive unions with `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the
  constants at call sites. Raw strings are only for freeform user-facing text.
- Never build a key by concatenating or interpolating identifiers. Use nested
  objects or nested `Map`s keyed by the original identifiers.
