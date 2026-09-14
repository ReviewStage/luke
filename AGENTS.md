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

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required. If you need to
learn more about particular Effect apis and concepts that the guide doesn't
cover, search through the source code in `node_modules/effect/src`.

Effect is the repository's infrastructure library, replacing what used to be
hand-rolled: a Schema that both parses and emits JSON Schema, disposables,
an event emitter, independent backoff loops, `setInterval` loops, a
semaphore, single-flight, bounded queues, an idempotency ledger, a worker RPC,
an injected clock seam, and a fake clock beside it. `effect` is pinned at
`4.0.0-rc.115` through the pnpm catalog in `pnpm-workspace.yaml` and nowhere
else — every workspace that reaches it declares `"effect": "catalog:"`, so one
copy resolves across the repository, which is what keeps a `Context.Service`
minted in one package the same service in another. The pin is **exact, not a
range**: this is a release candidate, and an rc line takes breaking changes
between patches, so a caret would let a `pnpm install` move the repository to a
different Effect without a diff saying so. What used to be four sibling
packages is now one: `@effect/platform`, `@effect/rpc`, `@effect/sql` and
`@effect/experimental` were consolidated into `effect` itself and are reached
at `effect/unstable/http`, `effect/unstable/rpc`, `effect/unstable/sql` and
`effect/unstable/*` — an `unstable` path is a correct v4 import that may take a
breaking change in a minor. Only the packages that could not merge remain
separate, each on the same `4.0.0-rc.115` and each through the catalog:
`@effect/platform-node`, `@effect/sql-pg`, `@effect/atom-react`, and
`@effect/vitest`. The pin is re-evaluated once Effect ships `4.0.0` stable, at
which point the exactness is what should be revisited first.

### Where an Effect may run

An Effect describes work; only a runtime edge runs one. The edges are listed
in `tools/oxlint/anti-slop/effect-edges.json`'s `runtimeEdges`: `apps/desktop/src/main/main.ts`
(the desktop's one `ManagedRuntime`), `apps/desktop/src/main/services/compose-desktop.ts`
(the layer that runtime is built from), `apps/desktop/src/main/store-worker.ts`
and `packages/brain/src/store/worker-entry.ts` (the store's worker thread, its
own edge because a worker starts from its own file), the two renderer roots
`apps/desktop/src/renderer/index.tsx` and `apps/desktop/src/renderer/voice/index.tsx`
(one browser registry each, so the panel and the voice window never
share one), `apps/desktop/src/renderer/renderer-runtime.ts` (the module each root's
runtime is built from: `Atom.runtime`'s layer is built, and the registry's
`get` reads it, the moment a root first reaches it, so the edge is here rather
than at each of the two roots that import it), the renderer's own fiber sites —
`apps/desktop/src/renderer/introduction/introduction-takeover.tsx`, the
panel's own `apps/desktop/src/renderer/use-voice-view.ts` (the panel's notice
strip forks its own clock the same way the voice window's does), and the
voice window's `apps/desktop/src/renderer/voice/live-call.ts` and
`apps/desktop/src/renderer/voice/use-voice-session.ts` — the web's own
module-scope memoized runtime `apps/web/server/runtime.ts` and the four doors
that hold its `runWeb`: `apps/web/server/route-effect.ts` (the adaptor every
function module under `apps/web/server/routes/**` exports its router through —
`routeFromHttpRouter`, named for the `HttpRouter` it builds a web handler from,
v4 having dropped the `HttpApp` module the old name was taken from — which
reads that runtime once per instance and lets the handler it builds do its own
running), `apps/web/server/hosted/store-route.ts` (the same door for a hosted
store route, whose handler is composed over the ambient `SqlClient` rather than
a router), `apps/web/server/voice/function.ts`
(the voice service, stood for a function instance's life rather than for a
request, so there is no request fiber to compose it into) and
`apps/web/server/seed-clients.ts` (the OAuth client seeding command, run as
its own process), the eve project's authored files —
`apps/web/eve/agent.ts`, `apps/web/eve/channels/eve.ts`,
`apps/web/eve/hooks/store.ts`, `apps/web/eve/instructions/prompt.ts`,
`apps/web/eve/instructions/seed.ts`, and `apps/web/eve/tools/brain.ts` — each
an edge because eve drives them through promise-shaped hooks of its own and
an authored file is where this deployment runs what it hands eve. Not
every seam under `apps/web/server/hosted/` is an effect down to its floor:
`hosted/store/asks.ts`'s `dispatchAskOnce` awaits eve's own HTTP client
inside an `Effect.promise`, `hosted/brain-host/production.ts`'s `spend` is
the AI SDK's async middleware, and `hosted/brain-host/door.ts`'s
`SessionOwnership` speaks eve's own `AuthFn<Request>` — three promise-shaped
foreign boundaries the effects around them compose over rather than
replace, `apps/web/server/db/migrate.ts` (the migration command, through
`NodeRuntime.runMain`), `apps/web/scripts/preview-probe.ts` (the deployed-shape
probe, same terms), and `tools/trace-export/src/cli.ts` (the trace command).

`Effect.runPromise`, `Effect.runSync`, `Effect.runFork` and their
`runPromiseExit`/`runSyncExit`/`runCallback` siblings belong nowhere else — and
neither does the `…With` form of any of them. That form is where a `Runtime<R>`
went: v4 removed the type, so services a caller used to carry as a runtime it
carries as a `Context` and hands to `Effect.runForkWith(context)(effect)`,
which is every bit the run its v3 spelling was. Everything between the edges
returns an Effect and lets its caller decide. The oxlint rule
`no-run-promise-outside-edges` enforces this against that same file's
`runtimeEdges`, `runShims`, and `runOnHandedRuntime` lists, over all twelve
`Effect.run*`/`run*With` members plus `ManagedRuntime.make`,
`Runtime.makeRunMain` and `NodeRuntime.runMain`, and it reads
`apps/web/server/runtime.ts`'s own `runWeb` and `webRuntime` as the runs they
are, so a module that holds the edge's runner rather than `Effect.runPromise`
itself is no less visible to it. `scripts/repository-checks.sh` spells the same
set as a regex to catch the other direction — a row that outlived the run it
was written for — so the two must be kept in step.
`no-raw-async-primitives` enforces the equivalent for `setTimeout`,
`setInterval`, `new Promise`, `AbortController`, and `fs.watch` against its
`rawAsyncPrimitives` list. A file on those two run lists that is not a runtime
edge above is a permanent adaptor, listed below with the one thing that keeps
it from ever moving onto the edges themselves; there is no other kind of row
on those lists, because a shim on its way to deletion is deleted in the same
PR that finishes the callers it was for, not left as a name on an allowlist.

### The permanent adaptors

- **`packages/brain/src/effect/carry.ts`** — `detachOn`, the brain's detach
  door: `Effect.runForkWith` evaluates the effect on the calling stack, while
  `Effect.forkChild`, `forkIn`, and `forkDetach` hand the work to the scheduler
  instead, and only a run makes `BrainAgent#enqueue`'s acquisition (what
  `busy()` reads) stand in the step that detached. v4's
  `forkDetach(…, { startImmediately: true })` says detached-and-started in one
  combinator, but it only exists *inside* a fiber, and every caller here is a
  synchronous non-fiber collaborator, so the door stays a run.
  `packages/brain/src/agent.ts`'s `BrainAgent#enqueue` and
  `packages/host/src/brain/wiring.ts`'s composition each hold `detachOn`'s
  returned door on the services the caller handed them and start a turn on the
  calling stack through it, which is why both are named on the run
  allowlist's `runOnHandedRuntime` rows rather than left for a new file to
  fork through unseen. The dispatch between a `ManagedRuntime` and a bare
  `Context` is `ManagedRuntime.isManagedRuntime`, v4 having stopped exporting
  `ManagedRuntime.TypeId`, and a fiber that must die with a scope is registered
  through `Fiber.runIn` rather than a `scope` option `Effect.RunOptions` no
  longer has. The same file's `runtimeExit` is the shared door
  `packages/brain/src/client.ts`'s `BrainTransport#send` (`runCall`) and
  `packages/devtrace/src/brain-trace.ts`'s `tracedModelAdapter` both run
  through, because every caller of the brain's model transport still holds a
  promise and the `ModelAdapter` interface it answers is one: `compaction.ts`
  is a port of OpenClaw `b7528507` that awaits `model.respond` and imports
  nothing from `effect`, so no adapter above this transport can answer an
  effect while that port stands.
- **`packages/runtime/src/execution.ts`**'s `ModelAdapter`, `EmbeddingAdapter`,
  and `MaybePromise` vocabulary, and **`packages/brain/src/transcript-recorder.ts`**'s
  `RecordingContextEngine` — each answers in a `Promise` or a bare value
  because the ports beneath them do: `compaction.ts`'s adapters await
  `model.respond`, and `context-engine.ts`'s engines await their lifecycle
  hooks, both OpenClaw ports of `b7528507` that import nothing from `effect`.
- **`packages/brain/src/store/store-client.ts`** — `StoreClient`'s promise
  face over the store's Rpc client. The client's own door is `request`, an
  effect over that Rpc client that runs nothing, and what still stands on the
  promise face beside it is exactly two interfaces: `BrainStateRepository` and
  `ChildStore`, read by OpenClaw ports (`packages/brain/src/state-store.ts`,
  `packages/runtime/src/children.ts`) that may not import `effect`, so neither
  can be stated as effects while its port stands. What would end this row is a
  decision about the ports themselves, not an implementation detail of this
  migration. `NotebookMemoryStore` (`packages/memory/src/notebook-memory.ts`)
  was the third interface this face answered and the one with no port behind
  it; it answers effects over `request` now, and the notebook's index, a
  scoped effect, yields them rather than wrapping promises.
- **`packages/brain/src/store/database.ts`** — `StoreDatabase#run`, the
  synchronous accessor two OpenClaw ports reach the store through:
  `archives.ts` and `maintenance-run.ts` import nothing from `effect` and hold
  a database handle, so the tables they read answer through the door's old
  synchronous signature rather than an effect.
- **`packages/host/src/store-wiring.ts`** and **`packages/brain/src/ledger.ts`**
  — promise faces downstream of the ports above: `store-wiring.ts` composes
  the host's store over `StoreClient`'s promises directly, and `ledger.ts`
  holds `Promise`s of its own over `BrainStateStore` (`state-store.ts`'s
  port). Neither imports `effect`; each stays a promise face because the port
  it stands on does.
- **`packages/brain/src/generation.ts`** — `retireGeneration`'s `Scope.close`
  alone. Which generation stands is a `MutableRef`, so the fence a replacement
  raises is up before the caller's next statement with no run anywhere in the
  open, and construction needs no run either now that v4 spells it
  `Scope.makeUnsafe`/`Scope.forkUnsafe`. What is left is the close: two
  synchronous finalizers (the abort signal every wait settles on, the runtime's
  own context) that must stand nowhere before the caller's next statement — and
  a `Scope` is what already states reverse order and closing exactly once, so
  the row is bookkeeping for a synchronous fence rather than a deletion owed.
- **`packages/credentials/src/single-flight.ts`** — the check-and-create of
  the one `Deferred` every concurrent caller joins is an uninterruptible step
  that cannot suspend, so it runs synchronously (`Effect.runSync`) and forks
  the flight it decided on as a detached root fiber (`Effect.runFork`, which in
  v4 is `runForkWith(Context.empty())`) rather than a fiber of whoever asked
  first, because a caller that gives up on its own await must not take the
  flight the other callers are still joined to.
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
  `Effect.runSyncWith` on the services the launch handed them, never an empty
  context of their own, because every caller but the one production subscriber
  (which forks over the store's `changes` Stream) still holds a synchronous
  object, and the ordering those callers and this file's own tests depend on —
  a listener's patch is not lost, a re-announce lands before the caller's next
  statement — is what turning them into effects a caller awaits would give up.
  `runSyncWith` is as synchronous as the `Runtime.runSync` it replaced: it
  evaluates on a `MixedScheduler("sync")`, flushes, and reads the exit, with no
  task scheduled in between.
- **`apps/desktop/src/main/update-service.ts`** — synchronous Electron
  IPC/menu callers (start, check, install) bridge into fibers on the services
  the launch handed them, on the same terms as `app-state.ts` beside it.
- **`packages/gateway/src/client.ts`** — `GatewayClient#take` forks its
  reconnection with `Effect.runForkWith` on the calling stack, because a gap
  must open its reconnection on the tick that found it: `take` is the
  transport's own synchronous callback with no fiber to fork from, so
  `forkChild({ startImmediately: true })` is not available to it at all, and a
  scheduler-deferred fork would move the in-flight count
  `node-invocations.test.ts` asserts on the statement right after a publish.
  The fiber is tied to its scope with `Fiber.runIn`.
- **`packages/voice/src/orchestrator/live-voice-orchestrator.ts`** — the notice
  strip's two clocks, whose `showError`/`showNotice` are synchronous statements
  armed from callbacks belonging to no fiber, start on the services the
  orchestrator was constructed with. The standing call's lifecycle no longer
  needs this door: v4 says detached-and-started-at-once as
  `forkDetach(…, { startImmediately: true })`, and that is what it uses.
- **`packages/runtime/src/children.effect.ts` and
  `packages/runtime/src/queue.effect.ts`** — each wraps an OpenClaw port
  (`children.ts`, `queue.ts`) that awaits promises and may not import
  `effect`, so the Effect sibling runs on the services its caller handed it
  rather than a context it builds; `packages/runtime/src/lanes.ts` and
  `packages/runtime/src/lanes.effect.ts` are the same port and sibling shape,
  on the raw-primitive allowlist rather than this one.
- **The test-support edges** — `apps/web/tests/support/sql-client.ts`,
  `apps/web/tests/support/no-database.ts`,
  `apps/web/tests/support/hosted-store-database.ts`,
  `apps/web/eve/evals/brain-host.eval.ts`, `packages/brain/src/store/testing.ts`,
  and `packages/wire/src/testing/effect.ts` each build a runner (a
  `ManagedRuntime` over a throwaway database, a `SqlClient` that refuses every
  statement, a synchronous database handle) so a suite or an offline eval
  still written on `node:assert` or a plain fixture can hold a promise where
  an effect is described; a test body is its own edge.

`packages/host/src/compose-calendars.ts` was a row here and is one no longer.
It forked the announcement hold onto a captured runtime because a v3 finalizer
was a synchronous callback with no fiber of its own to yield on; in v4 a
finalizer is an Effect on a fiber, and
`Effect.forkDetach(…, { startImmediately: true })` says what it needed in one
combinator. The captured runtime and the run are gone.

### Vocabulary

`SchemaRead` (`@sidecar/wire`) is the boundary result vocabulary a Schema
decode answers when the result crosses IPC or the wire — a `Result` inside a
process (v4's name for what v3 called `Either`, with `failure`/`success` in
place of `left`/`right`), a `SchemaRead` where a caller on the other side of a
process boundary reads it: `apps/desktop/src/shared/messages/acts.ts`,
`packages/hosted/src/reads-wire.ts`, `packages/hosted/src/live-contract.ts`,
`packages/wire/src/effect/json-schema.ts`, `packages/brain/src/ui-message-context.ts`,
and `apps/web/server/hosted/store/message-reads.ts` all produce or read it. The
repository's own helpers still carry the older name in their spelling —
`readEither`, `resolveConfigurationEither`, `readStoredUIMessagesEither`,
`settingGuardFromEither` — and answer a `Result`; renaming them is a vocabulary
decision nobody has taken, not a migration owed.

### Idioms

- A named function whose whole body is `return Effect.gen(function* () { … })`
  is written as `Effect.fn`/`Effect.fnUntraced` instead, the generator itself
  rather than a wrapper around one. Which of the two is not a matter of taste:
  **`Effect.fn("name")` at an exported operation boundary** — one unit of
  request or provider work, the name matching the binding — and
  **`Effect.fnUntraced` for a module-private helper or anything on a per-row,
  per-event, or per-message path**, because `Effect.fn` attaches a span and the
  default `Tracer` is `nativeTracer`, which allocates an in-memory span per call
  and exports it nowhere; on a hot path that is pure cost. Never `.pipe` off an
  `Effect.fn` — trailing combinators are extra arguments to it. An anonymous
  inline `Effect.gen` stays what it is; the rule is about wrappers, not
  generators.
- Three things that bite when converting one, each found by a suite rather than
  by `tsc`:
  - **`Effect.fn`'s span is observable in a failure.** The `Cause` gains
    annotations naming the function, so a test asserting structurally on an
    `Exit` or a `Cause` sees a different value. `withMigrationLock`
    (`apps/web/server/db/migrate.ts`) is `fnUntraced` for exactly this reason.
  - **`Effect.fn` is not timing-neutral against a bare `Effect.gen`.** The span
    wrapper defers the body relative to the caller, which is enough to reorder a
    `forkScoped` reader against what it was meant to have consumed.
  - **A converted binding is a top-level call, and esbuild cannot prove it
    side-effect-free.** A `function` declaration shook out of a bundle when
    unused; `const f = Effect.fn(…)(…)` does not, and drags its imports in with
    it. Every converted binding carries `/* @__PURE__ */`, which is worth ~3.6 KB
    on the panel bundle and ~2.7 KB on the voice window's.
- A function with a statement *before* its `return Effect.gen(…)` is not this
  pattern and is left alone: moving that statement inside the generator turns
  work done once per call into work done once per run.
- Schema at the boundary a value crosses, never a hand-written parser beside a
  hand-written shape.
- Runtime only at an edge above; everywhere else returns an Effect.
- `Scope`, not a `dispose()` a caller must remember to call.
- `Schedule`, not a hand-rolled interval or backoff loop.
- `TestClock`, not a fake clock: a test that waits on time advances the clock
  rather than arming a real `setTimeout` its own runner has to outlive. There
  is no counterpart to v3's `TestClock.sleeps`, so a test that asserted on the
  set of pending sleeps has to assert on what the sleep does instead.
- `MutableRef` for a synchronous facade over state a synchronous caller reads
  and writes as statements, when the fence it stands for must be up before the
  caller's next statement (`generation.ts` above).
- `Effect.runPromiseExit` and `Cause.squash` at a promise door, so a caller
  still holding a `Promise` sees the same rejection shape an `Effect.tryPromise`
  would have caught, not a fiber's own defect representation.
- No `Effect.raceFirst` over an uninterruptible region: a race that loses
  interrupts the loser, and a fiber inside an uninterruptible region cannot be
  interrupted, so the race never resolves.
- `Effect.forkDetach` and a join for a deadline that must run inside an
  uninterruptible region, since the fork itself has to survive the region even
  when its result does not, and the fiber it detaches is interruptible whatever
  the region around the fork, so the deadline still has something to end.
- A fork does **not** inherit the interrupt status of whoever forked it.
  `forkUnsafe` defaults `uninterruptible` to `false`, so a fiber forked from
  inside an `Effect.acquireRelease` acquire, a finalizer, or any other
  uninterruptible region is interruptible unless it asks not to be; inheritance
  is the opt-in `uninterruptible: "inherit"`. The wrappers this repository wrote
  for the v3 rule — an `Effect.interruptible(…)` standing as the immediate
  argument of a `fork*` — are gone, so an `Effect.interruptible(…)` that remains
  is one restoring interruptibility inside a region that really is
  uninterruptible around it, and is load-bearing.
- `startImmediately: true` on `forkChild`/`forkDetach`/`forkScoped`/`forkIn`
  evaluates the child on the calling stack. This is new ground: v3 could not
  say detached-and-started-at-once, and two permanent adaptors existed only for
  the gap. Reach for it before reaching for a run.
- `Effect.gen({ self: this }, …)`, not `Effect.gen(this, …)`, and
  `Fiber.runIn(fiber, scope)` for a fiber that must die with a scope —
  `Effect.RunOptions` has no `scope`.
- A discarded Effect, Stream, or Layer statement is a bug, not a fire-and-forget:
  `pnpm discarded-effect` refuses an expression statement of one of those
  types, `void` and `await` included, because an Effect is not thenable and a
  description a caller walks past runs nothing. It reads v4's brand properties
  (`~effect/Effect`, `~effect/Stream`, `~effect/Layer`) and excludes
  `~effect/Exit`, which extends `Effect` and has already run.
- Effect's `Clock` does not unref its timer: `sleepMillis` arms a bare
  `setTimeout`, and the only `unref` in the core is `ChildProcessSpawner`'s. So
  a wait armed on the clock references the host's event loop for as long as it
  stands, and a store with an automatic reset enabled holds its host open for
  as long as its generation does: mind this when the caller is a process that
  would otherwise exit. The one keep-alive interval Effect arms for itself is
  inside `Runtime.makeRunMain`, which is why a `runMain` process stays up for
  its root fiber's whole life and exits when that fiber ends.
- Four v4 behaviours the suites caught, each of which reads as a bug rather
  than a difference:
  - `Queue.takeAll` **waits** on an empty queue rather than answering empty.
    `Queue.clear` is what drains one.
  - `Runtime.defaultTeardown` maps an interrupts-only exit to code 130, and the
    worker runner ends a worker by interrupting it, so an orderly worker
    shutdown reads as a crash unless the teardown says otherwise.
  - `ConfigProvider.fromEnv()` copies `process.env` eagerly and the Reference
    default is cached, so a test that sets an environment variable after the
    first read never sees it. `ConfigProvider.layer(Effect.sync(() =>
    ConfigProvider.fromEnv()))` is the fix `apps/web/server/runtime.ts` uses.
  - Fork scheduling inverted: `forkUnsafe` goes through `setImmediate` and an
    async resume continues synchronously, so `fork(x)` followed by `release()`
    no longer runs `x`'s head first. `{ startImmediately: true }` is the
    remedy where the old ordering was the point.
- `packages/devtrace/src/trace-writer.ts` formats a trace line with a plain
  `traceLine(entry, now)` rather than a `Logger`: v4's `Logger.Options.fiber`
  is a live `Fiber` rather than the identifier and annotation maps the old
  synchronous formatter read. The bytes are unchanged and still pass through
  `sanitizedTraceEvent`.
- A bundle-budget baseline moves only for a deliberate library adoption, never
  for drift a deletion happened to leave behind (`apps/desktop/bundle-budget.json`,
  checked with 5% slack). The v4 adoption was such a move: the panel's bundle
  fell from 635,847 to 586,626 gzipped bytes and the voice window's from
  323,364 to 270,260, and holding the old baseline would have left the check
  tolerating a regression it exists to catch.

### The v4 modules this repository looked at and does not use

Each was read against the code that would have adopted it and declined for a
reason of its own, so that the next sweep reads this instead of repeating the
search.

- **`Newtype`** — `packages/runtime/src/identifiers.ts` is a hand-rolled
  newtype, but its `Identifier<Brand> = string & { … }` is *assignable to
  `string`*, and the repository leans on that everywhere: `SessionKey | string`
  parameters, `split`, `join`. Effect's `Newtype` is opaque and unwrapped
  through `Newtype.value`, so adopting it is a breaking change to every caller
  rather than an idiom.
- **`Latch`** — a latch is a gate that opens and closes again. Every
  non-test `Deferred` here is one-shot, or carries a value or an `Exit` (a
  latch carries neither and has no error channel), or belongs to a single
  operation. Nothing re-gates.
- **`Filter`** — the refinements here are single-step and `Schema`-backed.
  The one composable-looking site is the settings guards, and composition is
  precisely what would break them: `Filter.compose` types `Fail` as
  `FailL | FailR`, which would widen each guard's fallback default out of its
  own setting's type.
- **`UndefinedOr`** the module — `?.` and `??` already say `map` and
  `getOrElse` in less. `Schema.UndefinedOr` at a boundary is a different thing
  and is in use.
- **`Context.Reference`** for the host's seams — `packages/host/src/effect/kernel.ts`
  states the invariant deliberately: every seam is a requirement, so a
  composition that did not state one cannot build. A reference with a default
  trades that compile-time refusal for a silent fallback. `Environment` and
  `HostedEnvironment` must *especially* not become references: a reference's
  default is computed once and cached, which is the exact `process.env`
  snapshot bug `apps/web/server/runtime.ts` exists to avoid.

## TypeScript

- No stringly typed fixed value sets. Use `as const` SCREAMING_SNAKE_CASE objects,
  derive unions with `typeof VALUE_SET[keyof typeof VALUE_SET]`, and use the
  constants at call sites. Raw strings are only for freeform user-facing text.
- Never build a key by concatenating or interpolating identifiers. Use nested
  objects or nested `Map`s keyed by the original identifiers.
