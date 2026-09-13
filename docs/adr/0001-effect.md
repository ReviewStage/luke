# ADR 0001: Effect as the infrastructure library

Status: proposed, and adopted when the migration's last tightening PR says so.
This records the decision, the version line the compatibility spike settled,
the measurement it took, the rule about where an Effect may run, and every
strangler shim the migration introduces with the PR that deletes it.

## Decision

Effect is the repository's infrastructure library. The hand-rolled parts it
replaces were each written because there was nothing to reach for — a Schema
that parses and emits JSON Schema, `IDisposable`/`DisposableStore`,
`Emitter`/`Event`, eight independent backoff loops, eight `setInterval` loops,
a multi-lane semaphore, single-flight, bounded queues, an idempotency ledger, a
worker RPC over `MessagePort`, an injected `now`/`schedule` clock seam reaching
some 218 files, and a `FakeClock` beside it — and each is one more thing whose
bugs are Luke's own. They are replaced package by package, behind named shims,
and the idioms the replacements write to are the "Effect idioms" section of the
root `AGENTS.md`.

Three things are deliberately not Effect's. The `Admitted` brand stays a
type-level `unique symbol` with `admitEffect()` its sole minter, never a
`Schema.brand`, because a brand a cast can spell is a brand anything can enter.
The JSON Schema a model reads is emitted by `@sidecar/wire`'s own emitter
(`packages/wire/src/effect/json-schema.ts`) rather than `JSONSchema.make`,
because those bytes are prompt-cache bytes and their goldens are compared as
bytes. And every file ported from OpenClaw keeps
its internals faithful to the pinned source and imports nothing from `effect`;
the Effect wrap is a sibling module.

## Version line

`effect` is pinned at `3.22.2`, the newest 3.x release, through the pnpm
catalog in `pnpm-workspace.yaml` and nowhere else. Every workspace that reaches
it declares `"effect": "catalog:"`, so one version resolves across the
repository, which is what keeps a `Context.Tag` minted in one package the same
service in another; `repository-checks.sh` refuses a literal version in a
workspace's own manifest, which is the only manifest this repository writes —
an installed dependency naming `effect` as a peer states the range it was
published with. Each companion package joins the same catalog at the newest
release whose peer range accepts that `effect`: `@effect/platform` at `0.97.2`,
which peers `^3.22.2`, and `@effect/sql` and `@effect/sql-pg` at `0.52.1`, which
peer that platform. `@effect/sql` also peers `@effect/experimental`, at `0.61.1`
here, which `apps/web` declares for the same reason it declares the others —
a runtime requirement of a dependency the function bundles keep external.

`@sidecar/wire` reaches both and declares them as dependencies rather than
development ones, because the bridge under `packages/wire/src/effect/` is
product code: `http.ts` offers the web `Response` a client's answer carries,
for the callers whose own vocabulary is still `Response`'s. The spike test at
`packages/wire/src/effect-spike.test.ts`, which
exercises `Schema.Struct` decoding, `Effect.gen`, `Layer`, and `Context.Tag`
under the repository's own test runner, stands beside them. `@sidecar/runtime`
declares `effect` on the same terms, for the delay and the clock bridge under
`packages/runtime/src/effect/` behind `@sidecar/runtime/effect`.

The spike compiled under both TypeScript lines the repository carries:
`typescript@7.0.2` with `@types/node@26.2.0` (every package) and
`typescript@6.0.3` with `@types/node@22.20.1` (`apps/web`). The latter was
checked with a throwaway tsconfig extending `tsconfig.base.json` under
`apps/web`, naming the spike file alone, so `apps/web`'s own compiler and its
own `@types/node` resolved it.

## Effect 4

Effect 4 is not adopted. Its release line was a release candidate when this was
written, and the companion packages the migration depends on (`@effect/platform`,
`@effect/sql`, `@effect/rpc`) each ship a stable line against 3.x only. The
decision is re-evaluated when Effect 4 has a stable release and all three ship
4-compatible stable lines; until then every package pins the 3.x catalog entry.

## `exactOptionalPropertyTypes`

The flag was trialled in `tsconfig.base.json` against the whole workspace, with
each error counted once by the file it lives in, since every project compiles
its dependencies' sources and would otherwise report the same error from
several packages. The counts below justified enabling it: every workspace
fixed its own errors under a per-package override first, and `tsconfig.base.json`
now enables `exactOptionalPropertyTypes: true` directly, with the
per-workspace overrides removed.

| Workspace | Errors |
| --- | --- |
| packages/providers | 41 |
| apps/web | 35 |
| apps/desktop | 30 |
| packages/host | 26 |
| packages/brain | 15 |
| packages/voice | 15 |
| packages/credentials | 7 |
| packages/session | 5 |
| packages/hosted | 4 |
| packages/settings | 4 |
| packages/wire | 2 |
| packages/actions | 1 |
| packages/analytics | 1 |
| packages/calendar | 1 |
| packages/panel | 1 |
| **Total** | **188** |

The other 18 workspaces reported none of their own. By diagnostic: 104 are
`TS2379` (an argument carrying `undefined` into an optional property), 37 are
`TS2412` (an assignment of `undefined` to an optional property), 35 are
`TS2375` (an object literal carrying `undefined` into one), and the remaining
12 are `TS2345`, `TS2322`, `TS2420`, and `TS2769`. Two of the errors sit in
`packages/wire/src/schema.ts` and are re-reported by every package that
compiles it.

## Where an Effect may run

An Effect describes work; something has to run it, and the only places that may
are the process's own edges, one runtime each:

- `apps/desktop/src/main/main.ts`, one `ManagedRuntime` the quit disposes. The
  layer it is made from is the whole launch
  (`apps/desktop/src/main/services/compose-desktop.ts`):
  the host's assembly and standing layers and every desktop service's own
  start, in one order, in one scope. Building it is the standup, and the
  entry's `before-quit` is `runtime.disposeEffect` — forked as a daemon and
  waited on under the entry's own bound, so a close that outran its wait is
  left to the exit rather than holding the single-instance lock forever.
- each `apps/web/api/**` function module, through the module-scope memoized
  runtime `apps/web/server/runtime.ts` holds, so a warm instance reuses it and
  a cold start builds it once. The hosted voice service is one of these: it
  runs inside the two `api/voice` functions rather than as a process of its
  own, so it takes that edge and needs none.
- `apps/web/server/db/migrate.ts`, the migration command, through
  `NodeRuntime.runMain`. A command's whole life is one Effect, so the run is
  the edge and nothing of it outlives the process.
- `tools/trace-export/src/cli.ts`, on the same terms: reading the trace file
  and writing the document are both `FileSystem` effects, so the command runs
  them through `NodeRuntime.runMain` over the `NodeFileSystem` layer rather
  than awaiting `node:fs/promises` calls of its own.
- `apps/web/scripts/preview-probe.ts`, the deployed-shape probe, on the same
  terms: waiting on the deployment record, probing the preview over
  `FetchHttpClient`, and appending the step summary are effects of one
  command's life, run through
  `NodeRuntime.runMain` over the fetch client and `NodeContext`, so the run
  is the edge and nothing of it outlives the process.
- the two renderer roots, `apps/desktop/src/renderer/index.tsx` and
  `apps/desktop/src/renderer/voice/index.tsx`, one browser `ManagedRuntime`
  each — two roots because the panel is the one surface that records, and the
  voice window must not be able to reach it. The runtime each holds is the one
  `apps/desktop/src/renderer/renderer-runtime.ts` builds: the module is
  instantiated once per bundle, so the panel and the voice window each get
  their own registry and their own runtime under it, and an atom's work runs
  on the runtime of the window that mounted it. Within a bundle, a component
  or a hook reaches that same edge two ways and no other: an `Atom` on the
  registry the root provided (`act.ts`'s `actAtom`, `use-app-state.ts`'s
  `appStateAtom`), or `rendererRuntimeNow()` for work that is a fiber of its
  own rather than an atom's, run through `Runtime.runFork` or
  `Runtime.runPromise` on the value it answers. Every place that does the
  latter today is named rather than left for a grep to rediscover:
  `apps/desktop/src/renderer/voice/use-voice-session.ts`'s remote-audio
  retry, `apps/desktop/src/renderer/voice/live-call.ts`'s own session-life
  fiber and its armed bounds, and
  `apps/desktop/src/renderer/introduction/introduction-takeover.tsx`'s one
  `runCallEffect` helper,
  through which every verb it asks of its own `LiveCall` runs. A fiber built
  on a runtime constructed anywhere else in the bundle is the thing this rule
  forbids, not the pattern above.
- `apps/desktop/src/main/store-worker.ts`, the brain store's own worker
  thread, through `NodeRuntime.runMain(NodeWorkerRunner.launch(...))`. It is
  bundled apart from `main.ts` because a worker starts from its own file, so
  it is a runtime edge of its own rather than a second use of the app's.
- `packages/brain/src/store/worker-entry.ts`, the same launch for the store
  client's own suite, which spawns that file directly so the client is
  exercised against a real worker thread rather than the in-process transport.
  It carries no production export and nothing but that suite reaches it, and
  it is a runtime edge on the same terms as the file above: a worker starts
  from its own file. It stood outside the lint's reach until P12-10, because
  `no-run-promise-outside-edges` matched member calls on `Effect`, `Runtime`,
  and `ManagedRuntime` alone and never `NodeRuntime.runMain`.

`Effect.runPromise`, `Effect.runSync`, and `Effect.runFork` belong nowhere
else: a runtime built where the work lives is a second runtime, and two
runtimes are two copies of every service a `Context.Tag` was supposed to
identify. Everything between the edges returns an Effect and lets its caller
decide. The migration enforces this by review until the lint rule
`no-run-promise-outside-edges` lands, after which the edges above are its
allowlist.

What that rule reads is a call: a member call on `Effect`, `Runtime`,
`ManagedRuntime`, or `NodeRuntime`, or a call of whatever an imported
`runtimeExit` answered. P12-10 added the last two. A run reached through a
wrapper is still a run, and the three files that reached one — the store
worker's entry above, and `runCall` and `tracedModelAdapter` below, both of
which run through the brain's own `runtimeExit` dispatch rather than through
`Runtime.runPromiseExit` by name — were the whole of what the rule could not
see, so the allowlist was three entries short of the truth rather than three
files too permissive.

The strangler shims in the table below are on that allowlist for as long as they live.
`packages/wire/src/effect/http.ts` is on it no longer: P12-04e deleted
`cloudFetchFromHttpClient`, the one thing in that file that ran an effect, with
the `CloudFetch` seam its callers held, so the file runs nothing and is off the
allowlist rather than standing on it with nothing to answer for.

`timerSeamFromRuntime` answered the `now`/`schedule`/`cancel` seam a caller
still injected with those closures read from an Effect runtime's own
`Clock`, exactly as the deleted `timersFromRuntime` did, but as a
package-local function rather than a shared runtime export, since P12-03
found no caller left that could take a shared one instead of a seam of its
own. P12-03b deleted the two non-brain copies
(`packages/runtime/src/effect/timer-seam.ts`,
`packages/host/src/effect/timer-seam.ts`) outright rather than keeping them
as named, shared functions: `packages/runtime/src/children.effect.ts` and
`packages/runtime/src/queue.effect.ts` each now build the bridge inline, over the runtime their `Effect.acquireRelease`
was handed, never one either builds; neither names or imports the other's
copy, since a caller that still needs the bridge keeps its own beside the
code that uses it rather than sharing a module three packages once did.
`compose-live.ts` built a third such copy for `LiveSessionService`'s idle,
settle, and finalize timers until P12-18h3, which took the seam itself away:
the service keeps time on the `Clock` of the scope it is built in, so there is
nothing left there for a bridge to answer.
The brain's own copy, in its test harness, is gone with P12-20f, which is the
condition it was kept for: `BrainAgent.make` yields the `Clock` and the scope
of the fiber that builds it, so an agent built inside an `it.effect` stamps
every instant and sleeps every wait on that test's own `TestClock` without a
`now`/`schedule`/`cancel` triple to bridge, and the harness runs nothing. The
agent's waits — the wake window's coalescing and the ask ledger's timeout —
are `Effect.sleep` on that clock, forked through `detachOn` into the agent's
scope with `Runtime.RunForkOptions`' `scope`, so `stop()` closing the scope
ends a wait no collaborator disarmed. `packages/brain/src/agent.ts` left
`rawAsyncPrimitives` in the same PR: the `globalThis.setTimeout` fallback it
held for a caller that passed no seam went with the options. The closures
outlive the seam in one place: `PendingInputQueue` is an OpenClaw port that may
not import `effect`, so `AskLedger` hands it two closures over one of the
agent's own armed waits. `BrainGenerationClock` was the other until P12-20f2,
which took its `now`/`schedule`/`cancel` triple away and with it the last
bridge in `agent.test.ts`: the clock is handed a `Clock`, the detach door, and
a scope, so the instant it judges a generation by and the wait it arms for that
generation's expiry are one clock's, and a wait nobody disarmed ends when the
scope closes. `wireBrain` is what yields those two — it answers an
`Effect<BrainWiring, never, Scope>` rather than a wiring, and every
conversation's clock arms in the scope the composition built it in — and
`packages/brain/src/generation-clock.ts` left `rawAsyncPrimitives` in the same
PR, since the `globalThis.setTimeout(...).unref()` fallback it held for a
caller that passed no seam went with the options. The wait is referenced where
that timer was not: nothing of Effect's clock unrefs, so a store with automatic
reset enabled now holds its host's loop for as long as its generation stands.
The shipped policy arms nothing, and the only host that arms one is Electron's
main process, which its own event loop holds open regardless.
`forkOn` in `packages/brain/src/effect/fork.ts` was on the same list for one
release and P12-16g deleted the file: `anticipateAsk` answers an
`Effect<void>` now, so the slot's fiber is an `Effect.forkDaemon` inside the
effect the caller runs rather than a run of the prefetch's own, and what runs
it is the live brain adapter on the runtime it already answers the spoken ask
on. Nothing is awaited either way — the effect ends when the fiber is open,
and the value the turn later takes travels through the slot's own `Deferred`.
The `ScheduledTimer` type alias itself — the opaque handle a
`schedule`/`cancel` pair traffics in — still names a real constraint two
things forced back into a dedicated declaration file rather than an inline
`unknown`/`object`: `anti-slop/no-unknown-parameters` resolves a type alias
only when it is declared in the same file as the parameter that names it, so
a file that both declares the handle's shape and uses it as a `schedule`'s
return or a `cancel`'s parameter trips the rule the moment the alias is
local; and a Node fallback (`globalThis.setTimeout`) answers `NodeJS.Timeout`,
which TypeScript refuses to assign into an object type stated as an optional
phantom property (`{ readonly opaque?: never }`) even though it assigns
cleanly into a bare `object`. Both constraints are satisfied the same way
`scheduled-timer.ts` always was: one file per package that only declares the
alias and touches no function signature of its own, imported by every
sibling that needs the shape rather than redeclaring it. `packages/brain`'s own
copy went with P12-20f2, which left the generation clock as the package's last
reader of it; what still declares one is `packages/runtime/src/scheduled-timer.ts`
(kept, since `children.ts`/`queue.ts` are OpenClaw ports whose constructor
option this is, and `packages/host/src/brain/wiring-children.ts` imports the
same one from `@sidecar/runtime` to build a `ChildRunService`) and
`packages/voice/src/scheduled-timer.ts` (restored under the name
`TimerHandle`, and since P12-18h3 imported by `notice-strip.ts` alone, which
is the one voice seam left that traffics in a handle; the live session's own
door exports the name no longer). What P12-03b actually deletes is the
three-package *duplication* — `timerSeamFromRuntime` as a shared, exported
bridge function reused across packages — and the name `ScheduledTimer`
itself outside `packages/runtime` (voice's is `TimerHandle`); it does not
delete the one-file-per-package declaration shape, which the lint rule and
`NodeJS.Timeout`'s own assignability both require.

`ObservationLoop`'s `start` and `stop` are gone, and so is the arm-and-check
pair every cadence the account gate owns wore beside them. P7-13b made that
gate an effect: `cadenceGate` in
`packages/runtime/src/effect/cadence.ts` is a cadence's arm and disarm as two
effects over a child of the scope its owner was built in — the arm forks that
child and runs the arming in it, the disarm closes it, and the owner's own
close disarms whatever a disarm missed — serialized, so a sign-out arriving
while a sign-in's arming is still out waits for it and then undoes it, which
is the race the mid-way re-reads of `capabilitiesActive()` used to answer.
`ObservationLoop` answers `cadence`, the effect an arming stands up, and
`observationSupervisor` is one gate over all three loops' cadences; the
account composer's `startCapabilities`/`stopCapabilities` links are that
gate's `arm` and `disarm`, the devices cadence and the calendars composer's
observation each hold a gate of their own, and the hourly conversation
maintenance is armed by the brain composer's own lifetime, in the scope that
lifetime is. `openCadenceScope`, `forkIntoCadence`, `closeCadenceScope`, and
the `CadenceHome` they took a runtime from are gone, and
`packages/runtime/src/effect/cadence.ts` is off the allowlist with them:
P12-15a made `ObservationLoop`'s `run` and `refresh` effects, so the one
arming left that was not one — the calendars composer's meeting-boundary
wake, re-armed from inside an observation pass — is armed from inside an
effect now and forks into the observation's own `Scope` through
`Effect.provideService`, with the fiber it replaces dropped by a
`Effect.forkDaemon(Fiber.interrupt(...))` rather than a `Runtime.runFork`.
`cadenceGate` is the whole of that module.

`ObservationLoop`'s `run` is `Effect<void>` and so is `refresh`, so a
cadence's own pass and a caller's poke are the same work on the same runtime.
A pass may still be poked by a synchronous caller, and that is what the two
new `runOnHandedRuntime` entries below are; the loop itself runs nothing. The
one thing a pass does outside its own fiber is the follow-up a coalesced poke
earns: `refresh` answers as soon as the pass it waited on is done and forks
the queued pass behind it as a daemon, which is exactly what the detached
`void this.refresh()` it replaces did, and which is what
`compose-conversation.ts`'s `pollAfter` still waits out — through a
`Deferred` the pass settles rather than a promise it held.

`composeObservation` in `packages/host/src/compose-observation.ts` was on the
handed-runtime list for what the brain still awaited of it. `pokeRefresh` was
no longer one of those reasons: P12-15e made `SessionActionPerformer.perform`,
the row's own two writes, and `settleHostedWrite` effects, so the redraw a
landed write earns is a `yield*` of a poke that forks `loop.refresh` as a
daemon, on the fiber the write itself is carried on, and nothing runs it. What
was left was the brain's own promise-shaped reads: `workspaceDefaults`, which
the host's action performer wrapped in an `Effect.promise` for the `defaults`
read `ActionAdmissionReads` declares, and `broadcastWorkspaceProjects`, forked
onto the composer's own runtime from the one place it fired from a plain
callback, `sessionRegistry.subscribe`'s listener. P12-16f took both off: the
composer exposes `workspaceDefaults` as the `Effect.Effect<WorkspaceCreationDefaults>`
its action performer already yields rather than a `() => Promise` it ran, and
the loop's own pass yields `broadcastWorkspaceProjects` itself right after it
draws the roster, so the subscribe listener no longer needs to fire it at
all. `Effect.runtime<never>()` is gone from this composer's build, and
`packages/host/src/compose-observation.ts` is off `runOnHandedRuntime` with
it.

`compose-live.ts` is off this list since P12-20h, which took the last run
there. `requestOnboardingBeat` decides whether to speak from the roster a
fresh pass just drew, so it waits on `observation.loop.refresh`, and it waited
on `calendars.gateOfferable()` and `arrivalBeat` beside it; all three were run
to promises because the composer answered the beat as a plain async function.
The beat is an `Effect.Effect<void>` now, and what
the composer answers is the ask rather than the effect: `requestOnboardingBeat`
offers that effect to an unbounded `Queue` this composer opened in its own
scope and answers at once, and a fiber forked into that scope takes one beat
at a time. Every caller wanted exactly that — the account gate and the launch
discarded the promise, and the four calendars links are synchronous
`() => void` seams — so nothing waits on a pass it never waited on before, and
a beat that dies is logged rather than left to end the fiber every later beat
needs. A quit ends one in flight. What a `Runtime.runFork` would have given
here, the first step standing in the step that asked, the beat does not need:
every guard it makes is re-read when it runs, which is why the queue is the
right door and `detachOn`'s is not.

`LiveSessionService` in `packages/voice/src/live-session/live-session-service.ts`
was on the same list as of P12-18h, as the one run left on the live path: it
took the composition's runtime as a seam of its own and ran `LiveBrain`'s and
`LiveRecord`'s effects on it, an ask and a write awaited with
`Runtime.runPromise` where a promise was awaited before, a read made ahead and
a drop of one forked with `Runtime.runFork`. P12-18h2 takes it off. The
service is built by `LiveSessionService.make` in the `Scope` its composition
opened, and the verbs a caller waits on — `createSession`, `adoptSession`,
`endSession`, and `stop` — are effects it yields rather than promises it
awaits, so `compose-live.ts` and `hostedLiveExchange` yield what they used to
wrap in `Effect.promise`. What a socket event, a timer, or a brain listener
begins and nobody waits for — a delegation composed into an ask, an utterance
written when it settles, a read made ahead, the drop a session's end owes —
is offered to the service's own unbounded queue from wherever it was decided
and run as a fiber of a `FiberSet` the scope holds, which is how a
synchronous callback starts an effect with no runtime to start it on; it is
the same shape `apps/web/server/voice/live-exchange.ts` already reports each
record write through. The close is not that scope's: how long a quit may wait
on the peer is the composition's own decision, so `stop` stays a drain step of
`compose-host.ts` on the desktop and the socket scope's own finalizer in the
hosted exchange.

P12-18h3 took the `now`/`schedule`/`cancel` trio away with the promise-shaped
append channel beneath it. The service reads the `Clock` of the scope it was
built in — `unsafeCurrentTimeMillis` where a socket callback cannot wait for an
effect — and every delay it arms (the idle window, an utterance's settle, the
prefetch debounce, the roster debounce, an exchange's finalize) is an
`Effect.sleep` on a fiber of that scope, cancelled by settling a `Deferred`
the arming handed back, so a hand that gives up before the fiber reached its
sleep still stops the body from running and frees the fiber at once.
`AppendChannel` serializes its sends over an unbounded `Queue` drained by one
fiber of the same scope rather than a promise chain, each acknowledgment a
`Deferred` under `Effect.timeoutOption`, and `closeGracefully` answers an
`Effect` whose timeout is the ambient `Clock`'s, which is why both are off
`rawAsyncPrimitives`. A test drives all of it from a `TestClock` it already
stands on, and `packages/host/src/compose-live.ts` builds no timer bridge.
What is left for P12-18h4 is the standing session's socket and its listeners,
which are still stood up and torn down by hand rather than released by a child
scope's `acquireRelease`, and P12-20i2 found what that waits on. `#tearDown`
is a synchronous method whose side effects run where it is called and whose
returned effect is what the caller runs afterwards, and the three callers that
matter — a `session.closed` frame, a close on the sideband, and a failed peer
transport — are socket callbacks, which can only offer that effect to the
service's task queue. Releasing the sideband from a scope would put its close
in the deferred half while `ended` and `#standing` are cleared in the eager
one, so a `stop` arriving between the two would find no session standing and
leave the socket open. P12-20i2b took the socket's own frames onto a `Stream`
beneath the sideband, and those three callers are still callbacks all the
same, because what the service reads is `LiveSideband`'s `onEvent` and
`onClose`: the pump that reads the socket dispatches to them from a fiber, and
a fiber's dispatch into a callback is still a callback at the far end.
P12-20i2c is the sideband's own events and closes as a stream the service
consumes, and P12-18h4 follows it; until then the hand-written unwind is what
keeps the session over at the instant it is declared over.

What P12-20i2b did settle is which scope a session stands in. A sideband now
leaves a fiber reading its socket behind it, and the graceful close speaks to
the session and reads the final event back through that fiber, so a sideband
released with the scope the close is itself a finalizer of would be dead
before the close it is for. `LiveSessionService.make` forks a child scope (`#sessions`) for
what a session leaves standing — the reading, and the hosted source's
re-attaching tries — as the service is built, which is before any composition
registers whatever runs `stop`, so the reverse order that scope closes in puts
the reading after the close that needs it. `create` and `attach` are extended
over that child rather than over the service's own.

P12-20h took the service's two collaborators out of its options and into its
context. `LiveSessionService.make` yields `LiveBrainTag` and `LiveRecordTag`,
so what the session speaks through is stated by the composition that provides
them rather than handed down a constructor field: `compose-host.ts` builds the
plain `LiveBrain` and `LiveRecord` where the brain composer stands and
provides both to `compose-live.ts`, which now only names them in its own
requirement, and `apps/web`'s hosted exchange provides the pair it builds
beside the service on the spot. `liveBrainLayer` and `liveRecordLayer` stop
being strangler shims with that — they are how a caller that built a
collaborator imperatively hands it over — and the two source tags beside them,
`LiveSessionSourceTag` and `IntroductionSessionSourceTag`, are deleted
outright: they were scaffolding from P6-08 that no caller ever adopted, and
every source a composition holds is still a getter whose answer changes over the run, which a `Layer.succeed` cannot stand
in for. A tag nothing reads is a second door onto a value with no one behind
it.

`BrainTransport#send`'s internal `runCall` in `packages/brain/src/client.ts`
is on the allowlist too: every caller of the brain's model transport still
holds a promise, not a fiber, so the request effect built over
`@sidecar/hosted`'s `accountCall` is run to a promise there, joining the
caller's own `AbortSignal` to the run exactly as `createAccountCall` did
before P12-20b deleted it.
P12-04d moved what it runs on: `BrainTransport` takes an
`execution?: ExecutionRuntime` (the host's own, captured once in
`compose-account.ts` as `Effect.runtime<never>()` and threaded through
`VoiceCapabilityAssembler` to every adapter it builds) and `runCall` runs
through `@sidecar/brain`'s shared
`runtimeExit(execution)` — the same door `tracedModelAdapter` runs through —
rather than the ambient default runtime `Effect.runPromiseExit` read before.
It is permanent alongside `tracedModelAdapter`, because what keeps both is
the `ModelAdapter` interface's own promise: `compaction.ts` is a port of
OpenClaw `b7528507` that awaits `model.respond` and imports nothing from
`effect`, so no adapter above this transport can answer an effect while that
port stands.

`createAccountCall` in `packages/hosted/src/account-call.ts` was on it as
well, the promise door `accountCall` sat behind: it provided the caller's own
`httpClient` layer, or `FetchHttpClient.layer` for the ambient ones, joined
the caller's `AbortSignal` to the run, and answered the `Promise` its callers
held. P12-04 moved every caller inside that package onto `accountCall`
directly and deleted the `CloudFetch` seam the door took its layer from;
P12-20b deleted the door itself along with `AccountCall`,
`AccountFetchCallOptions`, and the `signal` only its promise read, and took
its three remaining callers outside the package onto `accountCall` — the
hosted PostHog batch in `apps/web/server/hosted/posthog.ts`, the voice session
mint in `apps/web/server/voice/openai.ts`, and `KeyedLiveSessionSource#create`
in `packages/voice/src/live-session-source.ts`. Each provides the client it
was built on, or the ambient fetch one, to the one request it makes rather
than taking it from a door shared by all of them; the mint and the batch ran
that request where the promise they answer begins and were on this allowlist
for it, until P12-20j deleted `postPosthogBatch` together with the
promise-shaped `events.ts` route it belonged to — the same PR
`createRateBrake` waited on — whose handler now yields the batch effect
beneath that door directly, and P12-20i3 took the keyed source's `create`
onto an effect its caller yields, which runs nothing at all.
`HostedChangesClient`'s, `HostedRosterClient`'s, and
`HostedConversationClient`'s own `#run` in `changes-client.ts`,
`roster-client.ts`, and `conversation-client.ts` were the seventh; P12-04b
deleted it, so `observe`, `projects`, `poll`, `messages`, `events`, `turns`,
`clear`, and `rate` now answer the effect over the ambient `HttpClient`
directly rather than a promise each class ran to itself. Their callers were
new entries on this same allowlist instead, and P12-15a deleted two of the
three: `ObservationLoop`'s `run` is a fiber now, so `drawSnapshotRoster` and
`drawSnapshotProjects` in `snapshot-roster.ts` answer
`Effect<..., never, HttpClient>` and `compose-conversation.ts`'s
`runClientEffect` is gone with the poll, the pager, and `readPage` that
awaited it — each provides `FetchHttpClient.layer` once, where the loop's
pass is built, rather than running the client's effect where the work is
needed. `compose-devices.ts` was the last of them, and P12-20a widened what
it ran rather than narrowing it — `HostedDeviceClient`'s `register` and
`forget` answer effects too now, so all three of the cadence's calls were run
to promises there — until P12-20d made the beat itself an effect: the
composer hands the cadence the three client effects as they stand, providing
`FetchHttpClient.layer` to the change-signal poll alone because it is the one
carrying no client of its own, and the beat yields each.

`ProductEventSender` in `packages/analytics/src/sender.ts` was the eighth and
is off the allowlist since P12-20c: `ProductEventSender.make` answers
`Effect<ProductEventSender, never, Scope>`, forks the flush cadence into the
scope the settings composer is already built in, and the class holds no
runtime at all. `flush` and `drop` are effects the composer and the quit's
drain yield, and the hold's one read is memoized where an effect is already
running rather than by an `Effect.runSync` of `Effect.cached`.

`createLiveUpstream` in `apps/web/server/voice/openai.ts` was on the same
allowlist for two runs, and P12-20k deleted both by rebuilding this file's
WebSocket plumbing over `@effect/platform`'s `Socket`, which is what the entry
said would take them. `create` answers `Effect<LiveCreateResult>` over the
client the upstream was built on rather than running that one session request
where its promise began, and `attach` answers
`Effect<WebSocket, SidebandNotAttached, Scope>`: the credential is yielded
where `Effect.runSync` stood, the handshake is an `Effect.async` under
`Effect.timeoutFail` where a `setTimeout` and a `new Promise` stood, and the
socket is acquired with `Effect.acquireRelease`, so the session's own scope is
what resumes and closes a sideband no pipe ever stood on. `relay.ts` left the
primitive allowlist in the same PR: the pipe is an effect over two
`VoiceSocket`s (`apps/web/server/voice/socket.ts`), each side's frames a
`Stream` read by a fiber of the session's scope, its finalization a `Deferred`,
and its two waits `Effect.sleep` forked into that scope. P12-20k2 gave that
reader the byte budget the route's retention had been missing: `voiceSocket`
counts what the peer sends from its first frame and closes the socket past the
budget, so the frames a session holds while it is being stood up are spent as
much as the ones the pipe carries.
`apps/web/server/voice/service.ts` left the primitive allowlist in P12-20k2,
which took the lifecycle P12-20k had left behind — `listen`, `close`, and the
promise per session that `close` waited on. `VoiceService.make(options)`
answers `Effect<VoiceService, never, Scope>`, and that scope owns the `ws`
server, the `FiberSet` each session's fiber joins, and the claim on the server
the function exported. There is no `close` beside it: a deployment is given no
shutdown hook, so the close is the scope's own finalizer rather than a verb a
caller chooses, and the finalizers run in the order a session's ending needs —
the claim given up and every desktop socket closed, then the drain
(`FiberSet.awaitEmpty`) that lets each relay finish its graceful close
upstream, then the `ws` server's own close. `listen` is an `Effect.async`
under `Effect.acquireRelease` that only a test acquires, since Vercel's bridge
listens on the server the function module exported. That module's export is
synchronous and the service behind it is an effect, so `voiceServer()` builds
the `http.Server` where the module is evaluated and `voice/function.ts` stands
the service on `runWeb` in a scope held open by `Effect.never`; until one
stands, and again once its scope closes, the server refuses every upgrade with
the 503 a deployment missing the project key answers with.

`Runtime.runFork` in `packages/gateway/src/client.ts` is on the handed-runtime
list, and it is all that is left of the door P6-13 named
`ServerBoundTransport#run`. P12-20e3 decided that door the way this ADR said
it had to be decided: `GatewayTransport#request` answers an
`Effect.Effect<GatewayResponse>`, so `ServerBoundTransport` composes the
protocol door's `connect` and `carry` rather than running them —
`gatewayInProcessHost` no longer answers a runtime at all, because nothing
bound to it runs anything — and the callers compose with it.
`gatewayClient(options)` builds the client in the caller's own `Scope`, its
`call`, `adoptHost`, and `reconnect` are effects, and the transport
subscription is that scope's finalizer, so a closed scope is a client that
reconnects nothing and `close()` is gone. `createGatewayOperator` in
`packages/host/src/operator.ts` answers effects with it, and the desktop's
`wiring.ts` and `operator-client.ts` are scoped effects `compose-desktop.ts`
yields inside the layer it already builds. What cannot be composed is the
gap: the transport finds one in its own synchronous event callback, and the
host has to be asked for the replay before that callback returns, which is
what `node-invocations.test.ts` asserts by counting in-flight answers on the
statement after a `publish`. `Effect.fork*` hands the work to the scheduler
and would move that; `Runtime.runFork` starts on the calling stack, the same
lesson `detachOn` recorded in P6-04's paragraph, so the client reads the
runtime of the fiber that built it and forks the reconnection there, in its
own scope, and every reconnection-race assertion reads exactly as before.
The two surfaces that answered the windows promises — `HostOperator` in
`apps/desktop/src/main/gateway/host-operator.ts` and the act row in
`ipc/brain.ts` — answer effects since P12-20e4. Each of `HostOperator`'s
verbs composes its one request and reads its answer without running it, an
`ActRow` answers a value, a promise, or an effect, and the act router runs
whichever it was handed once, on the runtime `compose-desktop.ts` already
hands the bridge. So `wiring.ts`, `host-operator.ts`, and `ipc/brain.ts` are
handed no `run` at all. Two faces keep one, because what they answer is still
a promise rather than an act: `operator-client.ts`, whose `DesktopService`
start and bootstrap read the composition awaits, and
`register-desktop-ipc.ts`, whose report handlers answer Electron. Neither is
an allowlist row, because neither runs a runtime of its own: the closure both
hold is the launch's one edge, handed down.
The two faces beside it that used to run on the same runtime for the same
reason — `createGatewayService`'s own `emit` and `closeAdmissions` in
`packages/host/src/service.ts` — are off the allowlist, and P12-15b took
them off from the two ends rather than by rewriting their callers. `emit`
is still called from a collaborator's own synchronous callback (the brain
wiring's `broadcastRequests` and conversation report, the live session's
`emit`, the node registry's `onChange`), and those callers are unchanged;
what changed is the log beneath them. `GatewayEventLog` holds its ring in a
`MutableRef` rather than a `Ref` and answers a synchronous `publish` beside
the `emit` a fiber uses, so the append a callback makes is a plain function
call: it numbers the event, offers it to the unbounded `PubSub`, and hands
it to every `listen` listener in the same statement the `Ref` version ran
under `Runtime.runSync`, which is why the 87 envelope goldens, the socket
exchange, and every reconnection-race assertion read exactly as before.
`closeAdmissions` is the admissions door's own `Effect` now, because the
step that runs it is one: `GatewayShutdownSteps`' four members are effects
the gateway's coordinator pipes, and `shutdownStepsFlushingEvents` and
`shutdownStepsClosingLiveSession` fold their own work in by forking it at
the step that begins it and joining it at the step that waits, so the
`AbortSignal` the settling step used to be handed is the deadline's own
interruption instead and `packages/gateway/src/shutdown.ts` is off the
raw-primitive allowlist with it. Beside it was
`scopedGatewayService` (`packages/host/src/testing/gateway-service.ts`),
the test's own edge while the host's own suites were plain `test` bodies
rather than `it.effect`. `gatewayTestHost` stood beside it and P12-20e
deleted it: the three gateway suites that held one build
`gatewayInProcessHost` in the scope `it.scopedLive` gives each test,
append an event with the synchronous `publish` the log answers beside
`emit`, and close the admissions door by yielding `admissions.close`, so
nothing in `packages/gateway/src/testing.ts` runs an effect any more and
the file is off the run allowlist; what is left in it is the text
transport alone. P12-20e2 settled `scopedGatewayService` itself: it is
`createGatewayService` under a test-facing name now, a plain
`Effect.Effect<GatewayService, never, Scope.Scope>` the caller's own
scope builds, with no run of its own left to allowlist.
`operatorOverBrain` and `brainHarness` beneath it, which used to run it
and hand a promise-shaped operator and harness to `service.test.ts`,
`brain/publication.test.ts`, `brain/conversation-deletion.test.ts`, and
`brain/host-lifecycle.test.ts`, are scoped effects in the same shape now,
and those four suites yield them under `it.scoped`. The socket binding
(`packages/gateway/src/websocket.ts`) never needed any of it: it provides
the `Protocol` a server is built over rather than attaching to one already
built, and composes `layerGatewayServer` over it itself, so what it needs of
a host is the server's own layer options, which `GatewayService` hands out as
`layerOptions` — `GatewayServerLayerOptions` now rather than the deleted
class's own, so it is the layer's own contract and no longer a shim.

`composeHost`'s `start()`/`stop()` in `packages/host/src/compose-host.ts`,
`hostLayerFromSeams(options)` beside it, `hostSeamLayers(options)` and
`hostKernelLayerFromSeams(options)` one level down in
`packages/host/src/effect/{seams,kernel}.ts`, `createHostKernel` beside them
in `host-kernel.ts`, and `mergeMethods`'s throwing fold over `foldMethods`
were the last of the host's own composition adaptors, and P12-05 deleted all
five once every caller held what they stood in for directly: P8-01 had
already taken `hostAssemblyLayer` and `hostStandingLayer` onto the desktop's
own runtime, so `composeHost`'s only caller left was `compose-host.test.ts`,
which now builds `hostLayer` over `@sidecar/host/testing`'s fixture seam
layers the same way a live launch does; and
`apps/desktop/src/main/services/host-layer.ts` now stands each seam up as its
own `Layer.succeed` — `StateRoot`, `RunMode`, `AppIdentity`, `Environment`,
`SecretCipher`, `StoreWorker`, `IdSource`, the reporter, the new
`MachinePresenceReader` and `ShutdownSignal` tags for the two seams that only
`kernel.options` and a bootstrap method read before — rather than building
one `HostSeams` object for an adaptor to take apart. `settingsOverridesFromEnvironment`,
the record face beside the effect at the settings store's own door, is gone
with its last caller: `compose-settings.ts` is now the effect over the
`Environment` seam directly, and the store's own tests read the same
`settingsOverrides` effect through a `ConfigProvider` built from the
environment record they still pass around.

`Composer`'s own `start()` and `stop()` promises were the last of that face,
and P7-14 deleted them: a composer answers one `lifetime`,
`Effect<void, never, Scope>`, whose running is the concern started and whose
finalizers are the whole of its stop, so `hostStandingLayer` is
`Layer.scopedDiscard` of each lifetime in `HOST_START_ORDER` and the promise
wrapper `composerLayer` put around a start and a stop is gone. `armed` went
with them, because a lifetime is already the same scope: the brain composer
yields its hourly maintenance after its own start, in the one effect. What
that wrapper guaranteed is now `startedAndStopped` in
`packages/host/src/effect/composer.ts`, which the two concerns holding
something (settings' product-event sender, the brain's store) write their
lifetimes as: the stop registered before the start runs rather than as the
release of a successful acquire, since a stop is written to give back what a
partial or failed start allocated, and the start uninterruptible so no stop
stands over a start still under way. The order proof in
`packages/host/src/effect/host.test.ts` is unchanged in what it asserts.

`conversationMaintenance` in `packages/host/src/conversation-operations.ts`
runs no effect at all any more: the hourly pass is `Effect.repeat` on a fiber
forked into the scope the effect is armed in, which is the brain composer's
own lifetime, so that scope closing is the whole of its stop.
`Effect.repeat` rather than `Effect.schedule`: nothing here awaits a first
pass separately, so the cadence's own first repetition is the launch's pass,
exactly as the interval it replaces ran its callback once before arming.

`UpdateService`'s `start`, `stop`, and `#armPublishingRetry` in
`apps/desktop/src/main/update-service.ts` moved to `runOnHandedRuntime` at
P12-20g, off `runShims`: the class no longer takes a `runtime` option that
falls back to `Runtime.defaultRuntime` when a caller omits it, and no longer
takes a `scope` option that it substitutes an owned scope for when one is
omitted either. `UpdateService.make(options)` is the only way to build one —
`Effect.Effect<UpdateService, never, Scope.Scope>`, an `Effect.gen` that reads
the ambient `Scope.Scope` (`Effect.scope`) and the ambient runtime
(`Effect.runtime<never>()`) once and hands both to a private constructor —
so the timed check, the first check, and a publishing retry always fork into
the scope `createUpdateServiceHost`'s own `Scope.Scope` requirement already
stands in, composed into `compose-desktop.ts`'s assembly, and `start()`,
`check()`, and `#armPublishingRetry` always step or fork on the runtime that
same assembly captured, never a second one built where the work lives.
`stop()` always interrupts the two tracked fibers and the pending retry by
hand; there is no owned scope left to close instead, since the scope was
never this class's to close in the first place. Construction is not what
starts it, though: the version mark `start()` spends must not survive a
standup that failed or was quit before reaching the operator, so
`createUpdateServiceHost`'s own `start()` is still called from a step of
`launchSteps`'s `throughWindows` in the same position the old
`serviceLayer(updates, report)` held — after the operator's, before the
windows' — rather than from the assembly that built it. `update-service.test.ts`
owns a `Scope.make()` of its own per service and hands it to `make` through
`Effect.provideService`, and never closes it: every assertion on `start`/
`stop` timing already ran off `stop()`'s own fiber interruption, not the
scope's closing, so nothing about them changed. The publishing retry still
steps `Schedule#step` directly rather than driving it through a
`ScheduleDriver`, for the same reason as before: the driver's own `next`
sleeps out the delay it returns where this needs the delay back, to arm a
cancellable fiber a fresh check can still collapse mid-wait.

`AppStateStore`'s `snapshot`, `update`, and `touch` in
`apps/desktop/src/main/app-state.ts` are not on this allowlist, and P8-07 is
why: the document they read and write is a `SubscriptionRef`, whose own
`changes` Stream is what `compose-desktop.ts`'s one production subscriber
forks over, but every other caller in main — the ipc handlers, the window,
gateway, and update-service wiring — still holds a synchronous object, and the
ordering those callers and this file's own tests depend on (a listener's own
patch is not lost, a re-announce lands before the caller's next statement) is
exactly what turning them into effects a caller awaits would give up. Each of
the three still runs its Ref operation through `Runtime.runSync`, which never
suspends here because nothing behind a `SubscriptionRef` read or write is
asynchronous, but on the launch's own runtime — captured once at construction
and handed in by `compose-desktop.ts`, the same `Runtime.Runtime<never>`
`DesktopServices.run` answers promises on — rather than the default runtime
`Effect.runSync` would otherwise reach for. That is what removes them from the
allowlist rather than a further conversion: nothing here is a second runtime
any more, and P8-07 deleted `subscribe`, the Set-backed callback face beside
them, once its one production caller turned out to be `compose-desktop.ts`'s
own fork over `changes` and its every other caller turned out to be this
file's own tests, which now watch `changes` itself instead.

`packages/host/src/compose-devices.ts` is off this allowlist entirely since
P12-20d. `deviceCadence`'s `start` and `stop` left it first: each is an effect
over a `cadenceGate` the cadence holds, so the registration's own beat and the
poll after it are one fiber that gate's scope interrupts. The interruption is
forked rather than awaited (`Fiber.interruptFork`), for the same reason
cancelling a timer never was: what a disarm has to guarantee is that no
further beat starts, never that a call already on the wire has answered, since
it may be waiting on a token refresh that is itself signing out — and the beat
reads the generation the disarm bumped, so one the interruption has not
reached yet sends nothing. What P12-20d then took is the beat's own body,
which was a plain async callback the fiber ran to a promise: the three client
calls and the presence report are effects it yields, so the only runs left in
the file were the composer's, and those are gone with them.

Making the beat an effect made the fiber's interrupt status load-bearing for
the first time, and P12-20d found it wrong. `Effect.acquireRelease` runs its
acquire uninterruptibly and a forked fiber inherits the interrupt status of
whoever forked it, so the cadence fiber the arming's acquire forked was
uninterruptible: `Fiber.interruptFork` had nothing to land on, and a disarmed
cadence went on sleeping and waking for the rest of the run, doing nothing
only because each beat re-read the bumped generation. The fork is marked
`Effect.interruptible` now, so the disarm ends the fiber it names, and the
three guarantees the promise chain gave are stated rather than inherited. The
beat is wrapped in `Effect.uninterruptible`, so a disarm still leaves a call
already on the wire to land rather than aborting it, which is what makes a
registration out at sign-out land before the next account's. The promise
`inFlight` chain that ordered them is a `Ref<Effect<void>>` holding the wait
for the call under way, each beat swapping in a fresh `Deferred`; a beat that
reached its work completes that deferred from an `Effect.onExit` however the
work ended, and a beat interrupted while still waiting for the call before it
completes it *with* that wait instead (`Deferred.completeWith`), so the slot is
handed on rather than opened and a hung registration keeps its place in the
order however many sign-outs arrive while it is out. A sign-out's `forget` is a
daemon fiber the stop joins and the ref waits on beside the standing call,
because a stop must not wait for that call while the next start must. The
calendars composer's `startObservation` and `stopObservation` in
`packages/host/src/compose-calendars.ts` became `armObservation` and
`disarmObservation` over a gate of the same shape, so the held-notice release
and the Apple access poll are fibers in the scope an arming runs in and what
the disarm gives back is a finalizer registered before them. That file stays
on the allowlist for what the gate does not reach, which P12-14e and P12-15a
each changed the shape of: the Google consent trip is yielded inside its own
handler, and the meeting-boundary wake — the one thing that used to be forked
and interrupted from inside an observation pass run as a promise — is armed
from inside an effect since the loop's pass became one, so what is left run
here is the two effects the composer's own promise-shaped edges start: the
announcement hold refreshed from the arming's finalizer, and the onboarding
settle decided from a Gateway handler's synchronous body, each forked onto
the runtime the layer was built on rather than an ambient default one.

`compose-devices.ts` gained one such run in P12-14e, on the runtime it already
held: the calendars composer's `announcementsQuietNow`, `gateOfferable`, and
`meetingQuietUntil` are effects since that PR, and the device row's own
presence report read one until it answered effects itself, which it did in
P12-20d — the report is an `Effect<DevicePresenceReport>` the beat yields, and
`meetingQuietUntil` is yielded inside it, so that file holds no run at all any
more. `compose-live.ts` read them too, and none of those readings is a run
either: `quietNow` and `releaseHeldBriefings` are `LiveSessionService` options
that answer effects the service yields on its own fiber, and `gateOfferable`
and `arrivalBeat` are yielded by the onboarding beat's own effect.

P12-20p took P12-20d's finding as a shape rather than as one file's bug and
swept every fork the repository reaches from inside an uninterruptible region.
A fiber inherits the interrupt status of whoever forked it, so a fork made
under `Effect.acquireRelease`'s acquire, under `Effect.uninterruptible`, or
inside a finalizer is a fiber nothing can end: a `Fiber.interruptFork` finds
nothing to land on, and a `Scope.close` that waits on `Fiber.interrupt`
waits forever. Three fixes came out of it. `scheduleOnce` and `scheduleRepeat`
in `packages/runtime/src/effect/timers.ts` fork an `Effect.interruptible` body,
which makes true of every caller what their own contract already said — a
fiber the scope interrupts — including the observation loop's cadence, the
analytics sender, and the update service's repeating check. The calendars
composer's three observation-driven fibers — the held-notice release, the
Apple access poll, and the meeting-boundary wake — are forked the same way,
so `disarmObservation` ends the fibers the arming stood up whatever status the
gate was opened under. And `claimedUnlessAborted` in
`packages/brain/src/effect/settled.ts`, which exists for waits held under an
uninterruptible region, forked both its signal listener and its daemon with
the caller's status: run under `Effect.uninterruptible` it never answered at
all, because its own `Effect.scoped` close could not interrupt a listener
waiting on a signal that never fires. Both forks are `Effect.interruptible`
now, for the reason `joinedOnce` in `effect/once.ts` already gave. Nothing on
the `runShims` allowlist moved: no run was added or deleted, and every
remaining fork in `packages/` and `apps/` is either a `Runtime.runFork`, which
begins a root fiber with the runtime's own flags rather than a caller's, or a
fork the caller reaches interruptibly.

`composeObservation`'s entry above was widened in P12-14f and narrowed again
in P12-15e: every one of its nine `awaitedSettingsStore` reads moved onto
`settings.store`, and `readWorkspaceDefaults`, `pruneWorkspaceProjectDefaults`,
`rememberWorkspaceDefaults`, and `broadcastWorkspaceProjects` became effects,
but the session action performer held two of them as promises — one field read
(`Pick<AwaitedSettingsStore, "get">`) and `rememberWorkspaceDefaults` — which
were run to promises where they were handed to
`createSessionActionPerformer`. Both runs are gone: that performer takes
`Pick<SettingsStore, "get">` and the remembering effect itself, and yields each
on its own fiber. P12-16f closed the entry: `workspaceDefaults` is now the
`Effect.Effect<WorkspaceCreationDefaults>` the action performer yields
directly, and `broadcastWorkspaceProjects` is yielded from the loop's own
pass right after it draws the roster rather than forked from
`sessionRegistry.subscribe`'s listener, so `compose-observation.ts` is off
this list.

`compose-settings.ts` never joins this list: the observation composer's
`broadcastWorkspaceProjects` is an effect since P12-14f, and its one caller
inside this file, `applyAccountPreferenceSideEffects`, is an effect itself
since P12-14h's queue-drained account-preferences chain, so it is a plain
`yield*` rather than a run.

`compose-account.ts` was off the handed-runtime list from P12-14b to P12-14e:
the three `Runtime.runPromise` calls that ran the account gate's links for a
session manager awaiting promises were gone, because `AccountSessionManager`
answers effects itself. `startCapabilities` and `stopCapabilities` are the
links' own effects behind an `Effect.suspend`, which is what keeps a link read
no earlier than the call that needs it, and `onSignOut` is `releaseDevice`
directly. The three account reads and writes it lifted at that seam are
lifted no longer: P12-14c took the store itself onto effects, so each is the
store's own, with `Effect.orDie` where the rejected promise behind it was
already a defect.

P12-14f puts it back on the list: `sessionReplayState` is now the store's own
`readAccount` effect, and `emitSessionReplay` wraps it, but the one caller
that decides when a sign-in or sign-out fires it — `AccountSessionManager`'s
`onChange` — is still a plain callback, not a fiber, so `emitSessionReplay` is
forked onto the runtime this composer already captures (the same one P12-04d
threads through `VoiceCapabilityAssembler` to `BrainTransport` and
`tracedModelAdapter` under their own permanent row above) rather than awaited:
what a sign-in or sign-out has to guarantee is that the replay state reaches
the client eventually, never that it has landed before `onChange` returns,
which is what the fire-and-forget `void emitSessionReplay()` this replaces
already meant. The `ACCOUNT_DELETE` handler forks the same effect from inside
its own `Effect.gen` (`Effect.forkDaemon`, not a plain `Effect.fork`: the
handler's own fiber ends the instant it returns, and a supervised fork would
be interrupted with it, exactly the drop `settleHostedWrite`'s daemon forks
above already avoid), needing no runtime at all. This half of the row goes
once `AccountSessionManager`'s `onChange` is itself an effect a subscriber
yields rather than a callback a composer runs.

P12-14g added a second reason the file stayed on the list, gone in P12-14i:
`VoiceCapabilityAssembler#apply` answered an effect, so `applyVoiceCredential`
ran `transitionVoiceSource`'s effect on the captured runtime for its
still-`Promise<void>` callers. P12-14i made `applyVoiceCredential` itself a
plain `Effect.Effect<void>` field — `Effect.orDie` over
`Effect.asVoid(transitionVoiceSource(...))`, the same defect-on-failure
reading the promise gave — and every caller (the settings side effects'
`VOICE_SOURCE` case and the three account-gate sites in `compose-host.ts`)
yields it directly now, so this reason for the row is gone.

P12-14h adds a third: the session manager's `onChange` is the same
synchronous callback with no fiber to yield on, and `settings.emitSettings()`
is an effect since that PR's queue-drained account-preferences chain, so the
settings change it asks for is a `Runtime.runFork` onto the same captured
runtime beside `emitSessionReplay`'s own. That one goes when `onChange` itself
answers an effect.

P12-16d takes the file off the list for both reasons at once, this time for
good: `AccountSessionManager` owns a `PubSub` of every snapshot it settles on
and publishes to it everywhere `onChange` used to be called, exposing it as
`changes: Effect.Effect<Stream.Stream<AccountSnapshot>, never, Scope.Scope>`
over `Stream.fromPubSub(pubsub, { scoped: true })` — the subscribe is the
scoped read itself. `compose-account.ts`'s `lifetime` is the subscriber: it
forks `Stream.runForEach(changes, onAccountChange)` into its own scope with
`Effect.forkScoped` rather than running anything on a captured runtime, and
`onAccountChange` is what `onChange`'s body still is — the cache-forgetting,
the first-sign-in hook, the `ACCOUNT_CHANGED` event, `settings.emitSettings()`,
`emitSessionReplay`, and the arrival hook, in the same order, `yield*`ed
rather than forked. Every reader in the file that used to mirror the account
in a closure (`capabilitiesActive`, `signedIn`, `snapshot`,
`voiceCapabilities`'s `accountSignedIn`, `sessionReplayState`) reads
`session.snapshot` directly instead, which the manager already updates
synchronously ahead of the publish, so nothing that gates on the current
account waits on the subscriber's own fiber to catch up; only the transition
comparison — was the account signed in a moment ago, under which key — still
needs a previous value, and that lives in the subscriber's own closure now
rather than the composer's. What this makes explicit is the trade the two
forks already lived with: the cache invalidation, the first-sign-in hook, the
`ACCOUNT_CHANGED` event, and the product event are now eventual relative to
the fiber that changed the account, on the same terms `emitSessionReplay` and
`settings.emitSettings()` already were.

P7-13 finished the boundary those pairs sit behind: a `GatewayMethodTable`
entry is an `Effect<WireValue | undefined, GatewayRefusal>` rather than a
promise of an outcome record, so the server runs each handler as the
request's own fiber and `gatewayMethodEffects`, the bridge that wrapped every
promise handler in an `Effect.tryPromise` and mapped its outcome, is deleted
rather than deprecated. `gatewayOk`/`gatewayError` go with it: a handler
succeeds with the value the wire carries and fails with one of the refusal
family `Schema.TaggedError` already declares, and `invalid(message)` is that
failure for the one refusal every reader spells. A handler that throws rather
than failing is still the request's own `internal` refusal, caught as a defect
where the promise bridge caught a rejection, so the 87 envelope goldens hold
byte for byte. What the composers still hold inside those effects are the
promise faces below them, each already on the allowlist below; P7-13b takes
each composer onto the Effect face its package already exports and deletes the
rows that named this boundary as what they were waiting for.

`shutdownGateway`, the promise door in `packages/gateway/src/shutdown.ts`, is
gone: P7-10 composes the host's quit as an effect directly. The coordinator's
fixed quit order — admissions closed, the cancellation and the settling raced
against one shared deadline, whatever a cut step already produced kept in a
`Ref`, and the unresolved count always persisted after — is
`shutdownGatewayEffect` and nothing else, which `hostDrain`
(`packages/host/src/effect/host.ts`) pipes directly, reading a step that threw
out of the defect channel as its own `HostDrainError` exactly as the door's
squash-and-rethrow used to. It therefore runs on the clock of whoever asked
for it rather than on a default runtime the door built, which is what the
drain's own suite now measures on the live clock, since what those two tests
state is the deadline itself.

`retryAttachWhileDetached` was on the allowlist for a reason of its own
rather than a caller's: nothing in this build ever composed it, or the
`retryAttachWhileDetachedEffect` beneath it, because the client that policy
is for is one that can genuinely detach and reattach, which the desktop's own
in-process operator never does (it is composed and attached exactly once, for
the process's whole life; P8-04 confirmed this rather than assuming it).
P12-20e deleted that module and its suite rather than keep a backoff policy
no caller holds against a caller no PR in this plan writes; the socket client
that can detach is what would state the policy again, against the
reconnection the protocol already names.

`StoreDatabase#run` in `packages/brain/src/store/database.ts` is on the
allowlist as the two OpenClaw ports' reach into the store. The store's worker
is an Rpc server: `store-operations.ts` declares every operation once as an
`RpcGroup`, `worker-host.ts` answers each on the worker's own runtime edge
(`apps/desktop/src/main/store-worker.ts`'s `NodeRuntime.runMain` over
`NodeWorkerRunner.launch`, and the same launch spawned directly by the
store-client test), one request at a time, and the handlers run the table
effects over the one client the database built at its open, so no operation
runs an effect of its own any more and the hand-rolled envelope, `wire.ts`, is gone with
`migrateStoreSchemaSync`, whose migration the open now runs on the runtime
that opens it. What still runs synchronously is `archives.ts` and
`maintenance-run.ts`: each is a port of OpenClaw `b7528507` that imports
nothing from `effect` and holds a `StoreDatabase` handle, so the tables it
reads — the conversation, directory, transcript, envelope, and archive
registry doors, `listTranscript`, `standingGeneration`, `conversationRecord`,
`archivePayload`, and the rest — are each `run` wearing the door's old
signature, a `runSyncExit` over that same client; the children, notebook, and
memory index tables, which no port reads, export no door any more. Every
statement underneath is a synchronous call into `node:sqlite`, so the run
waits on nothing and holds nothing, and it runs inside the worker's own
handler, on the edge, never on the main thread. `close()` is the same
handle's synchronous release, for the worker's `acquireRelease` and the
suites that open a database by hand. Both go when those two ports are handed
a synchronous accessor of their own instead of the handle; the plan schedules
no such PR, and this row is where that is recorded.

`openDatabase` in `packages/brain/src/store/testing.ts` is the same handle
opened for a suite that holds it itself, and it is the store's fixtures'
own edge rather than the product's: `Effect.runSyncExit(StoreDatabase.open(location))`,
with the refusal the open failed with squashed and thrown so a test asserts
the one it names. It goes with the synchronous handle above, when the suites
that hold one hold a client instead. Until P12-10 this file had no paragraph
of its own and passed the allowlist cross-check on
`packages/gateway/src/testing.ts`'s, because that check matched an entry by
its basename alone and two files named `testing.ts` were one file to it.

`storeClient`'s Promise face in `packages/brain/src/store/store-client.ts`
is on the allowlist too: the host's store wiring still holds a `StoreClient`
of promises, so each ask — one request through the Rpc client over the
one-worker `NodeWorker` pool, admitted in order and raced against the
worker's own exit — is settled to a promise there and rejects with the
failure itself. What P7-08 changed is whose runtime that is: the face takes
an `ExecutionRuntime` and the brain composer hands it the host's own, so an
ask is a fiber of the one runtime the host holds rather than of a default one
built where the work lives. The face itself stands for as long as the three
interfaces it answers do, and P12-13 measured that rather than scheduling it:
two of the three are the ports' reach. `BrainStateRepository` is read by
`packages/brain/src/state-store.ts` and `ChildStore` by
`packages/runtime/src/children.ts`, both of them ports of OpenClaw
`b7528507` that `scripts/repository-checks.sh` forbids an `effect` import in,
so neither interface can be stated as effects while its port stands —
`StoreDatabase#run` above is the same reach from the other side, the ports
holding a handle where everything else holds a client. The third,
`NotebookMemoryStore`, has no port behind it and could move on its own, which
would delete no promise from this face. So this row is permanent in the sense
the two wire rows are: not unfinished work, but a shape another rule fixes.
What would end it is a decision about the ports themselves — a `*.effect.ts`
sibling that owns each port's store reach, or a later port of upstream that
retires them — and that is a product decision about how faithfully this
repository tracks `b7528507`, not an implementation detail of this
migration.

`AgentTraceWriter` in `packages/devtrace/src/trace-writer.ts` was on this
allowlist because each tapped line was run on a `ManagedRuntime` the class
made itself, and is off it since P12-20c. Its `record*` methods are still
the plain synchronous taps their callers hold, but they offer onto an
unbounded `Queue` rather than running anything: `AgentTraceWriter.make` answers
`Effect<AgentTraceWriter, never, Scope | FileSystem>` and forks one fiber into
the account composer's own scope to take the lines and write them, so the
class holds no `ManagedRuntime` and `@effect/platform-node` is no longer a
dependency of `@sidecar/devtrace` at all — the `FileSystem` it writes through
is the one the host's layer already provides.

`SettingsStore` in `packages/host/src/settings-store.ts` is off the allowlist
since P12-14c: its own methods are effects, `#readPersisted` and `#write`
provide the `FileSystem` service the composer hands the class rather than
running on a runtime it was handed, and the class holds no runtime at all.
Its serialization moved with them and is Effect's own: the write gate and the
read gate are two `Effect.unsafeMakeSemaphore(1)` permits in place of the two
promise chains that stood there, so a second reader still waits for the first
read rather than making its own, and a read that failed still leaves nothing
held for the next one to inherit. The parse failure beside them,
`parsePersistedSettingsEither`, answers an `Either` rather than a throw and
never was on this allowlist, since it runs no effect. The cipher is sourced
through the `SecretCipher` tag at the composer and handed to the class as the
same plain field it always was: decrypting a stored key or grant is still
synchronous and throws on its own terms, so widening the tag past the
composer would gain the class nothing.

`awaitedSettingsStore`, once in `packages/host/src/settings-store-awaited.ts`,
is gone: P12-14i deleted it once its last caller yielded the store directly.
It was the store's own methods as the promises their unmigrated callers still
held, run on the runtime the host is composed on, and one by one those callers
moved off the face onto `settings.store` directly — the observation and live
composers in P12-14f, `session-action-performer.ts`'s one field read and its
`rememberWorkspaceDefaults` call in P12-15e, `@sidecar/voice`'s `VoiceSettings`
in P12-14g, the settings composer's own account-preferences and
provider-key-vault chains in P12-14h — until only `compose-calendars.ts`'s two
readers were left, each still taking the one setting it reads as a promise
option (`GoogleCalendarReader`'s `readAccounts` and `AppleCalendarReader`'s
`readConnection`). A `@sidecar/calendar` change unscheduled by this plan closed
that last gap: `GoogleCalendarReader` and `AppleCalendarReader` now answer
effects themselves — `observe`, `listCalendars`, `status`, `requestAccess`, and
`obtainAccess` are each an `Effect` a caller yields rather than a `Promise` it
awaits — so `compose-calendars.ts` hands both readers `readAccounts`/
`readConnection` options that are themselves `Effect.orDie(settingsStore...)`
calls, run on the calling fiber directly rather than to a promise on a handed
runtime. `applyVoiceCredential` answers an Effect since the earlier PR that
deleted the row below for it too. `compose-calendars.ts` stays on the
allowlist regardless — its `refreshAnnouncementHold` and
`settleCalendarOnboardingIfConnected` runs from synchronous callbacks (a
finalizer, the composer's own `lifetime`) are a separate, still-standing
reason.

`tracedModelAdapter` in `packages/devtrace/src/brain-trace.ts` is on the same
terms as `runCall`, permanently: the traced `respond` still answers the
`ModelAdapter` interface's promise, so the `Effect.withSpan` wrapping the
wrapped adapter's call is run to that promise here, through the same
`runtimeExit(execution)` door `runCall` runs through, on the `execution` its
own caller (`compose-account.ts`) hands it — P12-04d's one shared adaptor for
both, in place of the two separate `Effect.runPromiseExit` calls each ran to
the ambient default runtime before. It stands beside `BrainTransport#send`'s
`runCall` for the same reason: it can stop answering a promise only when the
`ModelAdapter` it wraps does, which is never while `compaction.ts` stands.

`packages/credentials/src/account/client.ts` runs nothing any more and is off
the allowlist. P12-20a took `timedRequest` onto the failure channel: it
answers `Effect<Response, Error>` with the client's own layer provided to it,
so `AccountClient`'s `exchangeCode`, `refresh`, `revoke`, and `userInfo` and
the free `deleteHostedAccount` each answer an `Effect<A, Error>` that
`AccountSessionManager` yields where it used to wrap a promise in
`Effect.tryPromise({ catch: asError })`. What a caller reads is unchanged: a
failure and a defect each land on that channel exactly as the promise rejected
with them, so an `AccountClientError` still carries the status and the OAuth
code `accountFailureAction` and `accessTokenNeedsRefresh` branch on, and a
deadline is still the `TimeoutError` name `AbortSignal.timeout` gave it. An
interruption is the one cause that is not worded as a failure, because the
request now runs on the asking fiber rather than on a runtime of its own: a
quit or a withdrawn sign-in cuts it, and `reportingFailure`'s
`Cause.isInterruptedOnly` and the sign-in's own withdrawal must keep reading
that as the caller ending rather than the service refusing. The
`httpClient` option stays a `Layer` a test hands over in place of
`FetchHttpClient.layer`, since P12-04 deleted the `CloudFetch` seam it used to
build that layer from. `LinearIssueTracker#post` is gone from the tree
entirely, with the Linear integration it served.

`LoopbackConsent`'s `signIn` in
`packages/credentials/src/loopback-consent.ts` runs nothing any more, and is
off the allowlist: the trip is `signInEffect()` alone, whose `Scope` binds the
listening loopback server and closes it on a grant, on the deadline, and on an
interruption alike. Its last caller moved in P7-13c —
`AccountSessionManager.beginSignIn` in
`packages/credentials/src/account/session-manager.ts` is an effect that forks
the trip as a fiber every concurrent ask joins, so the held promise that used
to be the de-duplication is a `Fiber` and the scope is the asking run's rather
than a door's own — and the trip's own `exchange` option answers an effect
since P12-14b, so the manager's exchange stores the tokens and opens the
capability gate inside the trip's fiber rather than through a run of its own
(the calendar's exchange, still a promise below, is lifted at that seam) — and
the calendars composer had already moved in P7-06,
calling `signInEffect()` through `Runtime.runPromise` on the runtime its own
layer runs on. `timedRequest` in `packages/credentials/src/linear/oauth.ts`
stood here on exactly the terms its namesake in `account/client.ts` does; the
Linear integration and its files are gone from the tree, so the entry names a
file this repository no longer holds.

`packages/credentials/src/single-flight.ts` is on the allowlist for two runs
and no longer for a promise door over them: P7-13c deleted `singleFlight`, so
`singleFlightEffect` is the whole of the module and
`AccountSessionManager.refreshOnce` is the Effect it answers, joined by the
hosted clients through `AccountToken.refreshAccount` and `CallCredential.renew`
— both effects now, which is what deleted `account-call.ts`'s own
`Effect.tryPromise` around the renewal. What the runs are still for is narrow
and deliberate: the check-and-create of the one `Deferred` every concurrent
caller joins happens the instant the returned closure is called, before the
Effect it hands back is ever run, so the decision (`Effect.runSync`) and the
flight it decided on (`Effect.runFork`, since P12-14b, where the flight
became an Effect the manager hands in rather than a promise it started) stay
one uninterruptible step however late — or whether — a caller runs the await.
The flight is a daemon of the default runtime rather than a fiber of whoever
asked first, because a caller that gives up on its await must not take the
rotation the others are waiting on with it. The refresh token rotates when
spent, so two flights racing would have the loser spend an already-rotated
token and read the endpoint's `invalid_grant` as a revocation.

`packages/calendar/src/oauth.ts` is off the allowlist since P12-20d.
`exchangeGoogleCode` answered a promise because `googleCalendarSignIn`'s
`exchange` callback did, so the exchange effect was run to one on the runtime
the caller handed in; that callback's own contract
(`LoopbackConsent`'s `exchange`) had been an effect since P4-04, and the trip
yields it inside the scope it already owns, so the exchange is that effect
with its `HttpClient` layer provided and no door of its own — and the
`runtime` option `googleCalendarSignIn` took for the run alone is gone with
it, which is one argument fewer from `compose-calendars.ts`.
`GoogleCalendarReader`'s own `#run`, once on this same row, is gone too: `GoogleCalendarReader` and
`AppleCalendarReader` (`packages/host/src/apple-calendar.ts`) answer effects
themselves now, a `@sidecar/calendar` change this document never scheduled, so
neither reader takes a runtime at all any more — `compose-calendars.ts` yields
`observe()`, `listCalendars()`, `status()`, `requestAccess()`, and
`obtainAccess()` directly inside its own `Effect.gen`, and
`packages/calendar/src/reader.ts` is off the allowlist.

`LiveVoiceOrchestrator` in
`packages/voice/src/orchestrator/live-voice-orchestrator.ts` runs nothing of a
caller's any more, and is on the handed-runtime list rather than the shim
list: P12-13d took `beginTalk`, `endTalk`, `stopSpeaking`, `stop`,
`requestMicrophoneAccess`, `adoptStanding`, and `obeySessionChange` onto
Effects of the asking fiber, took `LiveVoiceBridge`'s three asks of the host
onto Effects with them, and deleted both the `runtime` option and the `#run`
door that settled each verb to a promise; the renderer's
`use-voice-session.ts` — the one caller, never a host composer — starts each
on the renderer's own runtime through a `drive` helper beside the
remote-audio retry it already ran there. What is left is one
`Runtime.runFork` over the runtime the asking fiber is already on, read
inside the effect with `Effect.runtime<never>()` rather than handed in at
construction: the standing call's whole life is one fiber above the ambient
scope, since the call outlives the press that opened it, and a forked child
would begin on the next scheduler task, which would leave the press's own
open — and the connecting status it reports — a task behind the view the
verb has already touched. It goes when a fork can be both detached and
started at once. There is no tag for the bridge either: `reportView` is
called from a microtask of the orchestrator's own rather than from a fiber,
so the bridge is a field it holds and cannot be a service it reads, and
`liveVoiceBridgeLayer` was deleted rather than adopted.

`packages/voice/src/live-session-source.ts` stood on this allowlist beside it
until P12-20i3 and stands on it no longer. Three runs lived in that file:
`ReattachingSocket`'s recovery fork, the one session request
`KeyedLiveSessionSource#create` made with its `#attach` behind it, and
`ServiceLiveSessionSource#createSession`, the promise door
`HostedLiveSessionSource#create` and `IntroductionLiveSessionSource#create`
answered their callers through. P12-20i3 took that door and both `create`s
onto effects: a `LiveSessionSource#create` answers
`Effect<LiveSessionOpened | undefined, never, Scope>`, and an opened session's
`attach` answers `Effect<LiveSideband, SidebandAttachFailed, Scope>` — a
tagged error where the promise rejected with an `Error`, keeping that error's
own words as its `message`, which is the sentence the live session service
still reports. The introduction's source asks for no scope, since nothing of
its session stands on a fiber on this side. What the scope is for is the
re-attaching socket: its recovery was a fiber of a `FiberSet` the hosted
`create` made in the scope it was yielded in, forked from the socket's close
callback through that set's own runtime — the fork a callback still needed,
owned by a scope rather than by a runtime the source was handed — and
P12-20i2b took the set away with the callback it was for. Closing that scope
interrupts what is left the same way, so a composition that has gone leaves
nothing trying. The callers yield
where they awaited: `live-session-service.ts` extends a child of the scope it
was built in over both the create and the attach, because the session is what
that child stands for, so its own verbs still ask for no scope of their
caller; the desktop's `IntroductionSession#open` answers an effect, run by the
act row on the desktop's runtime through the `run` every other act uses rather
than at a door of its own; and the hosted voice service's exchange maps over
the two seams where it awaited them.

P12-20i2b took the frames themselves off callbacks. A `LiveSocket` hands up
one `Stream` of arrivals — every frame the far side sent and then the close
that ended it — which one consumer runs in its own scope, and
`sidebandOverSocket` answers `Effect<LiveSideband, never, Scope>`: it forks
the fiber that reads that stream into the scope `attach` was yielded in, so
closing the scope ends the reading. The hold is what makes a stream safe
there. `holdSocket` no longer wraps a socket; it is what a transport makes one
from, taking the two verbs it answers for and handing back the socket and the
one hand — `hear` — the transport calls from inside its own handler, where no
fiber runs. That keeps the guarantee `ws` forces: the bytes that followed the
handshake response flush on the next tick, ahead of any fiber a consumer could
fork, so the hand that hears them stands in the same turn the socket is
constructed in (`socket-over-ws.ts`), and what arrived before a consumer came
is replayed to the first one to run the stream rather than emitted to nobody.
`takeFirst` is unchanged in kind: it takes the arrival at the head of the hold
without releasing it, and interrupting the wait withdraws it. The re-attaching
socket is a function rather than a class with a fork seam: one fiber of the
session's scope reads each connection to its end, and because a connection's
close is the arrival that ends its stream, standing the next one up is the
next step of that same fiber rather than something a callback forks. A hang-up
is a `Deferred` the recovery races, so the attempt in flight is interrupted
and closes what it opened. What is still a callback is what the sideband
itself hands out, which P12-20i2c is for.

`fiberStoreRunner` in `apps/web/server/hosted/fiber-runner.ts` was on this
allowlist from P10-16, the PR that deleted `HostedStoreRun` and
`BrainHostSeams.run`, the type and field it replaced: since that PR the
hosted store, the store writer, the voice writer, the speech module, the ask
record, the device seams, the brain host, and every route handler under
`apps/web/server` answer `Effect<A, SqlError | ParseError, SqlClient>` end to
end, and a handler composes its whole request into the one effect `runWeb`
answers. It read `Effect.runtime` inside the effect and handed back that
runtime's `Runtime.runPromise`, as the fiber's own face rather than a runtime
of its own, so the connection everything below it read on was the request's
own and a test needed no seam for it.

P12-18b decided each of the four contracts that took that promise face, and
two of the four no longer do. The turn event stream's polling body used to run
inside a hand-built `ReadableStream` its handler had already answered with,
outliving that handler's fiber, so it read the runner before it answered; it
is now a `Stream.unfoldChunkEffect` over the same poll, and
`Stream.toReadableStreamEffect` hands the reader a fiber forked on the runtime
the request itself runs on, which the stream's cancel interrupts. The request's
own abort is read at the top of each step, where the old loop's `gone()` check
stood, and the poll interval is the seam's effect rather than
`node:timers/promises`; the frame bytes and the response's status and headers
are untouched. The voice service's five socket-driven compositions —
`hostedLiveExchange`, `hostedLiveBrain`, `hostedBriefings`,
`hostedLiveRecord`, `voiceSessionRecord` — never read a fiber at all: the
runner reaches them through `voice/function.ts`, which composes them, and a
test hands that runner over its own test database. They now name that runner
`WebStoreRun` in `server/runtime.ts`, the edge's own runner as a composition
below it is handed one, rather than the fiber-reading type they are not.

P12-18d took three of the five onto that shape, and the socket is what owns
the scope. `exchangeAttachment` opens a `Scope` when the service offers it a
session and closes it when the service detaches, and everything between is one
effect run in that scope on the edge's runner: the account's standing main,
`hostedLiveExchange` itself, the adoption of the sideband, and the briefing
look. `hostedLiveExchange` answers `Effect<HostedLiveExchange, never, Scope>`
rather than an object with a `stop` of its own — the four endings that `stop`
ran are finalizers added in the order that makes their reverse the order it
ran them, and the fiber that reports what the record made of each live event
is `Effect.forkScoped` between the wait on the record's writes and the rest,
so the interrupt lands before the drain. That fiber carries the reporting
only: the record is still handed each event where the event arrives, because a
delta's place in the record's own sequence is its arrival, and deferring the
`observe` call itself would let an ask written under a delegation jump ahead
of deltas that reached the socket before it. `voiceSessionRecord` holds no
runner at all now; its five methods answer
`Effect<A, SqlError | ParseError, SqlClient>` like every other row module
under `server/`. `PromisedVoiceSessionRecord` beside them was the promise face
`voice/function.ts` built over `runWeb` for `VoiceService`, and P12-20k deleted
it: the service is a composition of fibers now, so its one session effect
yields those five where it awaited their promises, and the suites that read the
row read it through `it.effect` over `testSqlClient` rather than through the
door.

P12-18d2 took the other two of the five, and the device read with them, so no
composition below `exchangeAttachment` is handed a runner. `hostedBriefings`
holds none at all: its `deviceId` seam is an effect rather than a promise,
one look is an effect its caller composes, and its `start` forks the schedule
into the socket's scope with `Effect.forkIn`, so that scope's close is the
stop it no longer declares. `hostedLiveBrain` forks each accepted ask's
follow into that same scope, which is what ends a follow and what replaced
the `Deferred` its old `stop` completed; an interrupted follow emits nothing,
where a failure or the follow bound still tells the service a failed end.
`hostedLiveRecord` makes every write on one fiber of that scope, taking them
from a queue each arrival puts one on with `Queue.unsafeOffer`, and hands
each caller the write's own `Deferred`: an `Effect.Semaphore` was tried first
and is not enough, because releasing it wakes every waiter that fits in the
free permits at once — `taken` is not updated until each woken fiber
resumes — so the winner is the scheduler's, which let an ask written under a
delegation land ahead of a delta that reached the socket before it. Where an
event lands in the sequence has to be decided where it arrives, and a queue
is what decides it there; the `observe` call itself stays synchronous at
arrival for the same reason, and only its reporting rides the exchange's
scoped fiber. What those two modules held for the doors above them
was a promise face: `LiveRecord`'s two utterance writes and `LiveBrain`'s
submission were promises `@sidecar/voice` declared, so each read `SqlClient`
once where it was built and ran those two over `runOverClient`, rather than a
runner threaded down from the edge. P12-18g left them its only callers and
P12-18h took both, below. `WebStoreRun` stays for `exchangeAttachment`, which opens the
socket's scope on it rather than running in one, and for `VoiceService`, which
is handed it as `VoiceServiceOptions.run` and runs one session's whole effect
on it per upgrade.

What took the fiber's promise face was the brain host, for two reasons that
were neither of them eve's authorship. `runTool`'s seams took it because the
brain's tool contracts carry no requirement: `BrainWorkspaceAccess` answers
`Effect<A, never, never>` since P12-16b and `read-tools.ts`'s `readTranscript`
always did, so a seam reading a row on the request's connection has nowhere in
those types to say `SqlClient`, and `hostedWorkspaceAccess`,
`hostedFactsWriter`, and `hostedTranscriptReads` each ran their own read
through the runner. That was a requirement, not a promise, and the runner was
not the only way to meet one: P12-18e reads `SqlClient` off the request once
in `runTool` and `Effect.provideService`-s it to each seam, with
`Effect.orDie` where the brain's contract admits no error, over `WebStoreRun`
from `server/runtime.ts` rather than a runner of `fiber-runner.ts`'s own —
which is what deleted `fiberStoreRunner`/`FiberStoreRunner` outright, and what
takes `fiber-runner.ts` off `runOnHandedRuntime`: nothing left in it reads a
runtime. `relay`'s seams no longer take a promise face at all: P12-18c took
`StreamRelay` and `carryStop`, `apps/web`'s own 700 lines of async class
beneath a `relay` that already answered an effect, onto effects themselves, so
the relay is composed into that effect and every seam it reaches — the
writer's three writes, the two ask bindings, the briefing offer, and eve's
cancel with the row's stamp behind it — is the store's own effect on the fiber
the event arrived on. eve's cancel is a request over the network and still
answers a promise, so `carryStop` awaits it with `Effect.promise` inside the
effect rather than running anything beside it. That left no module under
`apps/web/server` holding a promise-shaped seam, so the `Promised` mapped type
is gone from `fiber-runner.ts`; what is left of it is a copy in
`apps/web/tests/support/promised-store.ts`, test support for the suites that
predate `it.effect`, and it goes with the last of them.

P12-18g took `runTool`'s own three the same way, once the contracts behind
them answered effects rather than promises: `HostedFactsWriter`'s three
methods, `HostedTranscriptReads`'s `whole` and `since`, and the roster reader
`runTool` builds. Those contracts are `apps/web`'s own — the plan named them
the brain's, and on contact the brain declares none of them: `read-tools.ts`
takes its roster as rendered text and its `readTranscript` already answered an
effect — so the move is the same `Effect.provideService` over the request's
`SqlClient` that `hostedWorkspaceAccess` takes, with `Effect.orDie` where a
contract admits no error. `since` is the one that keeps a typed error, because
the opener reports a transcript it could not read and carries the turn without
a delta rather than failing the visit; it catches the read's defects as well
as its failures, so a provider plugin that dies where its effect declares no
error is still a read not made, as it was when the rejection came back through
a promise. Neither catch reaches an interruption, which is deliberate: a
cancelled tick is the tick ending rather than a transcript that could not be
read, the same distinction `offered` in that file draws. `hostedFactsWriter`'s per-account write chain — every mutation
reads the list again before it writes, so two calls remembering at once cannot
each replace the list from a stale reading — is now an `Effect.Semaphore` of
one permit per account rather than a promise chained onto the last; a write
that fails or is interrupted releases it, where the promise chain continued
onto the next either way. P12-18h took the pair P12-18d2 gave
`runOverClient`, `hostedLiveRecord` and `hostedLiveBrain`, by taking
`@sidecar/voice`'s `LiveRecord` and `LiveBrain` onto effects: the record's
faces are the wait on a write the scoped fiber makes under the socket's own
client, so nothing there provides or runs anything, and the brain's
submission is `Effect.provideService` of the request's `SqlClient` with
`Effect.orDie`, the same move `runTool` makes. That left `runOverClient`
without a caller, so `fiber-runner.ts`, its `runShims` row, and this lane's
last shim are gone.

`HostedStoreContext.db`/`HostedStoreDatabase` (the Drizzle handle `hosted/store/database.ts`
carried), `BrainHostSeams.db`, and `HostedStoreTestDatabase.db` (the store
test harness's own Drizzle handle in `apps/web/tests/support/hosted-store-database.ts`)
are gone as of P10-14d rather than deferred to P10-15 as an earlier slice of
this lane recorded: P10-14c3/c4/c5 found three `BrainHostSeams`/`HostedStoreContext`
wiring sites (`hosted-brain-host-ownership.test.ts`, `hosted-brain-host-prompt.test.ts`,
`voice-live-exchange.test.ts`) that still constructed a production seams
object under test naming the field, and reasoned the field would stay until
P10-15 deleted it together with `HostedStore`'s promise-to-Effect move. But
`hostedStore()` and the harness's PGlite migration path had already stopped
reading `db` by then (`store/index.ts` destructures only `{ keys, run }`),
so once P10-14d deletes `drizzle-orm` itself the field's type has nothing left
to be — `HostedStoreDatabase` was `PgDatabase<PgQueryResultHKT, HostedSchema>`,
a type that cannot exist without the package. Deleting the unused field now,
ahead of P10-15's own promise-to-Effect move, is the smaller and more honest
change, and the three wiring sites and the harness lost only the field they
never read.

`drizzle-orm` and `@better-auth/drizzle-adapter` are back in `apps/web` as of
the fix after P10-14d, as Better Auth's own adapter dependency and nothing of
Luke's: P10-14d moved Better Auth onto its Kysely adapter, and on Postgres
that adapter stores a `string[]` field as a JSON string where the Drizzle
adapter stores a native array, which is how Better Auth's CLI generated the
auth schema's `text[]` columns. The token exchange that completes every
sign-in is the first such write, and production refused it. Better Auth is
not Effect code and this migration never depended on which adapter it ran,
so `server/auth-database.ts` holds the Drizzle adapter over the restored
`server/db/auth-schema.ts` (the one Drizzle file that returns), and a test
over PGlite writes an access token through Better Auth's own adapter so the
adapter and the schema cannot part again unnoticed. Letting the two packages
go is a schema change first — those columns to JSON text, existing rows
rewritten, the seeder writing JSON — and only then the adapter swap.

`packages/brain/src/effect/carry.ts` holds the brain's door onto the host's
`ExecutionRuntime`. P12-16m settled that there were two of them rather than
one, on opposite schedules: `detachOn`, permanent and named as the detach door
below, and `carryOn`, the shim, whose last caller inside the brain P12-16m took
off it. P12-16n took the last one above it and deleted `carryOn` and the
`Carry` type with it. `runtimeExit`, the dispatch between a
`ManagedRuntime` and a plain `Runtime` the door is built over, is exported
beside it since P12-04d for the two narrower callers that need their
own exit-handling rather than a throw-on-failure shape:
`BrainTransport#send`'s `runCall` and `tracedModelAdapter`'s traced
`respond`, in `@sidecar/brain`'s own `client.ts` and `@sidecar/devtrace`'s
`brain-trace.ts`. A turn is a
fiber end to end from `TurnRunner` inward: the opening words, the deltas, the
recall, and the tool loop all run in one fiber the turn's `AbortSignal`
interrupts — the developer's cancel, the deadline, the agent stopping, the
generation being replaced — and the settlement that follows the fiber's own
exit, out where no interruption reaches it, is what rolls the context back,
writes the final checkpoint, hands the briefings over, and traces. The
execution seam itself is `AgentRuntimeEffect` and nothing else:
`capabilities`, `compact`, and `openContext` are effects, `resume` is one
failing with a `RuntimeResumeRefused`, and a run is `RuntimeRunEffect`, whose
`done` is the run rather than a handle on one already going — the loop
between the model and its tools, forked by whoever runs it, with a cancel, a
deadline, and the host's own revocation all reaching it as that fiber's
interruption, and the batch of calls the model emitted uninterruptible as one
so no dispatched effect is ever cut off from the result the host checkpoints
for it. `promiseAgentRuntime` and the `AgentRuntime` shape over that seam are
gone with the turn runner that held them, so `packages/runtime/src/execution.ts`
runs nothing at all. The turn's execution deadline is a `Effect.sleep` forked
into the scope the turn closes rather than a scheduled callback;
`Maintenance`'s flush-marker write is an effect inside the housekeeping turn,
its late success recorded by the daemon that carries it rather than by a
promise nobody holds; and the `Settled` Promise signatures in
`packages/brain/src/settled.ts` are deleted with the file. What stands in
`packages/brain/src/effect/settled.ts` is two Effect combinators with no run
in either, for the two waits a fiber's interruption cannot state: one held
under an uninterruptible region, where only the signal can end it, and one
whose value must be owned by exactly one party.

What kept `carryOn` was what the brain was still asked for in promises, and
since P12-16m that was nothing inside the brain at all: the ask face left it
with the queue beneath it in P12-16g, so an ask, a wait, a cancel, a mark, a
context snapshot, a stop, the four child verbs, and a run-event subscription
are each an `Effect` its caller runs, and `AgentSeam#detach` — the last thing
in the agent that held a promise nobody read — is on the detach door instead.
The one caller left was the host above the agent, and P12-16n took it:
`wireBrain`'s `rebuild`, `retire`, `openConversation`, and
`closeConversation` in `packages/host/src/brain/wiring.ts` are effects the
composers above them run — `compose-brain`'s lifetime, `compose-host`'s
`rebuildBrain` and `retireBrain` links, the voice source transition, and the
child service's archive seam — so nothing asks the brain for a promise any
more and `carryOn` and the `Carry` type are deleted. What stands in
`carry.ts` is the detach door and the `runtimeExit` dispatch beneath it. The child
service's executor seams left this door in P12-16k.
`packages/host/src/brain/wiring-children.ts` writes all six of them — the
spawn's start, the adoption a relaunch resumes, the cancel a cascade reaches,
the archive, the child's own lines, and the completion's delivery — as effects
of the runtime its conversations are fibers of, and `childSeamsOnRuntime` in
`packages/runtime/src/children.effect.ts` is what runs them, beside the
`now`/`schedule`/`cancel` bridge already there and on the same
`runOnHandedRuntime` terms: the port beneath is OpenClaw's and awaits promises,
so one place carries every seam to it rather than each seam carrying its own,
and a defect is squashed back to the error that caused it so the port's own
error handling reads what was thrown. A `start` answers its end as an effect,
and running that effect is what the port's `done` promise is.
The live brain adapter's spoken ask and its subscription left this door in
P12-16l, named above: the adapter is built as an effect on the composition's
own runtime, so following an agent and asking it are `yield*`s inside one
effect it runs there itself.
The wake face left that surface in P12-16c, named below. The
`MemoryProvider` seam left that list in P12-16a:
`recall`, `capture`, and a memory tool's `execute` are each an `Effect` the
turn's own fiber runs, so the flush before a compaction is one effect inside
another and the host's memory maintenance builds the housekeeping turn's
effect rather than carrying it. The
`ToolExecutor` seam left the list in P12-15c and the read tool's
whole-transcript read went with it into the tool loop's own fiber. The read
prefetch left this door in P12-16h, which gave a slot the fiber it had been
missing: the policy it resolves, the planner's call, the reads it named, the
summary, and the whole-transcript read the agent builds for it all run in that
fiber, forked inside `anticipate`'s own effect, and a supersession, a take past its
wait, and a drop each end the slot as that fiber's interruption rather than as
a signal raced against a carried promise. A memoized read keeps the shape
P12-16b gave it — one answer however many times it is asked for — as the join
of a daemon fiber rather than an `Effect.cached` effect, because the words
that supersede a slot must leave a read already out to finish into the memo
for the plan that follows. A defect is squashed back to the error that
caused it, so a store, a listener, or an engine that threw reaches the caller
as the error it threw rather than as the fiber failure that carried it.
The generation's context open and the host's reset left this door in P12-16i.
`Generation.opened` is an `Effect<OpenedContext>` rather than a promise the
agent carried into it: `generationFrom` still builds the generation in one
synchronous statement, because the fence a replacement raises must stand
before any disk is waited on, and what that statement now holds is the open
itself, begun on the first fiber that asks the generation for its context and
joined by every fiber after (`joinedOnce` in
`packages/brain/src/effect/once.ts`, which the agent's own restore is
memoized by too). The fiber is a daemon, so a turn interrupted while it waits
leaves the open standing for the turn behind it, and it is `interruptible`
whatever the fiber that forked it was, because a fork inherits its parent's
runtime flags and an open begun inside the wake capture's uninterruptible
region would otherwise wait forever on a race of its own it could not end.
The context the open installs is retired by a scope forked from the
generation's before the signal's finalizer, so one close still fires the
signal first and lets go of the context behind it, and an open that settles
after that close adds its finalizer to a scope already closed, which runs it
there and then. `resetConversation` answers an `Effect<boolean>`, which is
what its capture and its context snapshot already were. P12-16j took `BrainHost`'s build and
stop and `followBrainRequests`' marks off it: a transition is an effect
its caller runs, serialized by one `Effect.unsafeMakeSemaphore(1)` permit held
for the whole of it rather than by a promise chain, and a follower is a queue
the brain's listener writes to and one fiber marks from, so the reports a
retirement drains are awaited as that fiber's own barrier.

`detachOn`, exported from the same file and built over the same
`ExecutionRuntime` dispatch, is the door that stands, and P12-16m settled that
it is permanent. Three callers hold it. `BrainHost`'s retirement, which P12-16j put
there: it begins a stop's drain on a fiber of its own before it returns, so
the revocation stands in the step that asked for it, and answers that fiber,
so the next transition awaits how the drain ended rather than a promise nobody
is holding. And `AgentSeam#detach`, which P12-16m put there in place of the
`carryOn` it held: every turn nobody waits for is begun through it — the ask
ledger's drain, the wake window's flush and its roster look, the housekeeping
a settled turn leaves behind, and a hold's release. What only a run gives
either of them is the start. `Runtime.runFork` evaluates the effect on the
calling stack up to its first suspension (`FiberRuntime#start`), so
`BrainAgent#enqueue`'s own `acquireUseRelease` acquisition — the step that
puts the turn in the conversation's queue and counts it busy — has already
happened when the call returns. `Effect.fork`, `Effect.forkIn`, and
`Effect.forkDaemon` all go through `FiberRuntime#resume`, which only tells the
child fiber to run and leaves the scheduler to do it in a later task, so a
stop or a host reading `busy()` in between would find a conversation idle with
a turn owed. P12-16m weighed the alternative the plan tabled — `detach`
answering an `Effect` the composer forks into its own scope with
`Effect.forkIn`, behind an uninterruptible registration step — and did not
take it: the registration is the queue's own `acquireUseRelease`, and prising
a second registration out in front of it would give the conversation two
places that count a turn rather than one, for a fiber the composer's scope
would drain no better than the queue already does. What that leaves is a door
named permanent rather than a shim owed a deletion, and it is the only place
the brain runs anything: `packages/brain/src/effect/carry.test.ts` pins the
synchronous start against `Effect.forkDaemon`'s scheduled one, and
`agent.test.ts` pins the conversation reading busy in the step that released a
hold. The third caller is the brain wiring, which P12-16n put there for the
two seams it keeps in maps: a conversation's close and its open are each begun
through `detachOn` and shared under their key as the settling of that fiber,
so the retirement a close opens with stands in the step that asked for it, a
roster look that lets a departed session go begins the stand-down without
holding its drain, and two opens of one key landing in the same tick join one
fiber rather than building two stores on one envelope.
`brainAgentLiveBrain`'s ask and subscription left it in P12-16l, named above:
the adapter runs the agent's own effects on the composition's runtime it was
built on rather than carrying them; `wireChildren`'s four executor seams left
it in P12-16k, named above as well. The turn runner's `runAsk` and `turn` and
`Maintenance`'s housekeeping turn came off it in P12-16g with the queue they
rode: `BrainAgent#enqueue`, `#queueTurn`, and the host's `BrainLane` each take
an `Effect` now — the lane is `@sidecar/runtime/effect`'s `withLane` over the
same `LaneScheduler` — and the conversation's serialization is one
`Effect.unsafeMakeSemaphore(1)` permit taken for the whole of a turn where a
promise chain stood, so the turns of a conversation are handed the permit in
the order they asked for it, a stop drains the queue by taking that permit,
and `busy()` counts a turn from the moment its fiber asks until it has given
the permit back. Nothing of the host's is promise-shaped over the brain any
longer.

What the door does not carry is the other two seams. `ModelAdapter` and
`ContextEngine` stay as the host hands them in, because each is owned above
the runtime by identity rather than by shape: the host marks, rolls back, and
checkpoints the very engine `openContext` answered and compares it by
reference, and it folds the context through the same adapter inside
`compaction.ts`, which is an OpenClaw port and so imports nothing from
`effect`. An Effect-shaped counterpart for either would therefore need a
promise view built back out of it inside the brain, which is the same run in
another file rather than one less — so `ModelAdapter` stays Promise-shaped
permanently, like `ContextEngine`, and the two shims that stand on it —
`BrainTransport#send`'s `runCall` and `tracedModelAdapter`'s traced `respond`
— are permanent rows for the same reason, named below.

`ToolExecutor` was on that list until P12-15c and is not owned that way: the
brain builds the executor a turn hands its runtime, and no port consumes one,
so `execute` answers an `Effect<ToolResult>` and the loop dispatches a call
on its own fiber rather than across `Effect.tryPromise`. Every tool of the
brain answers an effect with it — the action modules, the reads, the
briefing, delegation, the workspace writes — so the journal that records a
call before it runs and settles it after is one effect around another, and
the batch the runtime already held uninterruptible is still what keeps a
dispatched effect from being parted from its result. Nothing the executor is handed is
a promise any more. The memory provider's tools left that list in P12-16a and
the last four left it in P12-16b: `ToolExecutorDependencies`'s `readWhole` and
`checkpoint` and the `BrainChildAccess` and `BrainWorkspaceAccess` contracts
each answer an `Effect` the turn's own fiber runs, so the whole-transcript
read is one effect inside the journal's rather than a promise carried onto
the host's runtime. That read's race against the run's signal
(`readWholeTranscript`) is `Effect.interruptible` for the reason
`guardedRead` is: the race ends by interrupting whichever arm lost, and the
batch it now runs inside is uninterruptible, so a wait on a signal that never
fires could otherwise never be interrupted at all. What is still a promise stands one layer out, where the
host builds each of them and is wrapped there rather than where a call is
dispatched: the ledger's own save (`checkpoint`), the child service and the
conversation directory (`packages/host/src/brain/wiring-children.ts`), the
OpenClaw workspace and skills ports (`wiring.ts`), the provider's transcript
read, and, for the memory provider, the notebook index's own `search` and
`get` over the store client's port face and the recent daily notes the same
workspace port answers (`packages/memory/src/provider.ts`).

The rest of this package's Promise faces turned out to stand on
`BrainAgent`'s own public surface rather than on the vocabulary's: a wake, an
ask, a run event's subscriber, and the generation a replacement installs were
each answered to a host that held a promise and not a fiber, and P12-16c took
the wake out. Three of those
four needed no fiber at all, and P7-08b took the runs out rather than moving
them: the wakes waiting for a turn (`packages/brain/src/wake-queue.ts`), the
pending-submission map (`AskLedger`), and which generation stands
(`GenerationHolder`) are each read and written in one uninterrupted step of
the calling turn, with nothing to wait on, so each holds its state in a
`MutableRef` — a cell whose get and set are statements — instead of in a
`Ref`, a `Queue`, or a `SynchronizedRef` reached through `Effect.runSync`.
What they guarantee is unchanged and is still what their own suites assert:
the same observation delivered twice is one wake, past the capacity the
oldest goes, a requeue prepends unbounded, an in-flight duplicate submission
joins the first rather than opening a second run, and a successor generation
stands before the caller's next statement so a result of the generation it
replaced installs nothing. A `SynchronizedRef` would still be wrong for the
ask ledger for the reason it always was — its permit is one turn later, which
let a housekeeping turn the decision means to outrank slip in ahead of it —
and an effect here could only ever be run. The fourth, the run event
subscriber, is on the allowlist for the reason below rather than exempt from
one.

`packages/brain/src/agent.ts` is off this allowlist since P12-16g, and the
three runs it was on it for went together. Its run events are the `Stream`
itself since P12-20h: `BrainAgent#runEvents` is
`Stream.fromPubSub(pubsub, { scoped: true })`, an
`Effect<Stream<BrainRunEvent>, never, Scope>` a subscriber extends into a
scope of its own, which takes the subscription on that subscriber's own fiber
— everything published after it is heard, in order — and then reads however it
likes. `packages/host/src/voice/live-brain-adapter.ts` is the subscriber the
condition named: it extends the stream into the adapter's own scope and forks
`Stream.runForEach` into the same scope, so closing that scope is the whole of
the unsubscribe and the per-subscription fiber the agent used to build for
every listener is gone with the `onRunEvent` face that built it. What a
listener that throws costs is the reader's own decision now — the adapter
catches the defect, logs it, and carries on, which is what `Emitter#fire`
guaranteed and what the agent used to guarantee on the reader's behalf — since
a fan-out the agent cannot see is not a failure the agent can rule on. Every
other rule a listener could observe under the old `Emitter` still holds,
subscription order and a listener subscribed mid-round hearing only what
follows, because the pump is the same `Stream.runForEach` it always was.
`#fireRunEvent` publishes with the pubsub's
own `unsafeOffer` rather than `Effect.runSync(PubSub.publish(...))`, which is
the same statement without a fiber around it: a publish into a shut-down
pubsub answers false there as it did here. And the pubsub itself is made
inside `BrainAgent.make(options): Effect<BrainAgent>`, the Effect-shaped
constructor every builder now yields — the host's wiring, the two test
harnesses, and the suites that stand an agent up by hand — so the one
`Effect.runSync(PubSub.unbounded())` the class was written around is gone with
the `new BrainAgent(` that made it necessary. `stop()` yields
`PubSub.shutdown` on its own fiber for the same reason. The bridge all this
replaced — `eventFromStream` and the scope built at construction to hold it —
is deleted with `packages/wire/src/effect/event.ts` itself.

`AccountSessionManager` in `packages/credentials/src/account/session-manager.ts`
is off the allowlist: `AccountSessionManager.make` is the effect that builds
the `PubSub` and hands back the instance, so `compose-account.ts`'s `lifetime`
yields it rather than reaching for `new` outside a run, the same seam that let
`compose-account.ts` itself come off this same list below.

The coalescing timer the wake queue arms is untouched by that, since it is
still the injected `schedule`/`cancel` seam a real elapsed-time wait stands
behind rather than anything the queue runs.

`BrainAgent`'s wake face needed no allowlist entry at all. `wake`,
`rosterLook`, and `releaseHeld` are `Effect.Effect<void>` since P12-16c, and
what runs them is the composer that always asked for them:
`compose-observation.ts` yields the look from the observation loop's own pass,
through an `afterRun` hook that is an effect rather than a `void` callback, and
`compose-live.ts` hands the release straight to
`LiveSessionService`'s `releaseHeldBriefings` option, which has answered an
effect the service yields on its own fiber since P12-18h2. Each stays fire-and-forget where it always was: the host's wiring
forks one fiber per conversation with `Effect.forkDaemon`, exactly as it
detached one promise per conversation before, so a provider slow to answer one
session's transcript holds neither the next pass nor the other sessions'
looks. What that moved off `carryOn` is the capture's own transcript delta:
`WakeCapture` reads it on the caller's fiber now, with the whole capture
`Effect.uninterruptible` because the promise it replaces was unstoppable —
between a cursor moving past what was read and the save that writes both there
is no point where a capture may be cut without losing a transcript nothing
will read again — and the signal race inside it `Effect.interruptible` for the
reason `readWholeTranscript`'s is. The captures still run one at a time, on an
`Effect.unsafeMakeSemaphore(1)` where a promise chain stood, so two reads of
one session never race each other's cursor.

`cloudPass` in `packages/providers/src/shared/cloud-pass.ts` no longer needs an
allowlist entry: its reads and its one write are effects over the ambient
`HttpClient` — `FetchHttpClient.layer`, or a test's own `httpClient` layer,
since P12-04c deleted the `CloudFetch` seam this pass used to build one from
— the 429 cadence is a `Schedule` stepped on the fiber's clock, and `run`,
`write`, and `credentialBoundRead` are
themselves effects now that Conductor — the one adapter that rides it — is on
them too, and so is `readApiKey`, which a caller yields on its own fiber.

`openReadOnlyDatabase` in the same package's `local-sqlite.ts` needed no
allowlist entry either, once P6-11c moved Superset's own host-state reader
onto `scopedReadOnlyDatabase`: Codex's state reader, Conductor's two local
SQLite reads (`applications.ts`'s session index, `local-workspaces.ts`'s
repository index), and Superset's (`reader.ts`'s host-state read) all ask
inside a scope of their own that closes the handle, so nothing in this
package still closes one itself in a `finally`. The hook spool has no such
face at all: `observationSpoolEvents` is a `Stream`, and nothing in this
build runs it — the hook wiring P6-12 would have run it under is gone, so the
window it groups on is settled on the stream's own terms in
`packages/providers/AGENTS.md` — which leaves nothing in that package forking
a fiber of its own.

`retireGeneration` in `packages/brain/src/generation.ts` is on the allowlist,
and the holder beside it is not any more. Which generation stands is a
`MutableRef` now, read and written as statements, so the fence a replacement
raises is up before the caller's next statement with no run anywhere in it —
which is what the storage rule means by a synchronous fence: the successor is
announced and the dead generation stands nowhere before any disk is waited
on. What a generation owns is a `Scope` of its own, and that stays a `Scope`,
because reverse order and closing once are exactly what it guarantees: the
abort signal every wait of the generation settles on, and the context the
runtime opened behind it, are its two finalizers, and both run synchronously,
so the close is a `runSync` rather than a stop or a replacement waiting on a
dispose. That synchronous shape is exactly what the storage rule requires, so
this row is re-pointed at P12-15 with no expectation it becomes an
`Effect.runPromise*` shim at all — deleting it would mean giving the fence
back the latency it exists to avoid. `state-store.ts` keeps its own compare-and-set against the envelope
it last observed standing, because it is ported from OpenClaw `b7528507` and
imports nothing from `effect`; its Effect surface stays in
`state-store.effect.ts`. What P12-02 took out of this file is the open: the
context the runtime answers is an effect, and since P12-16i it is the effect
the generation holds rather than a promise the agent's door carried it to, so
nothing of the open is run here either. The close
stays, because the fence has to: the store announces a replacement in a
synchronous callback, and the dead generation must stand nowhere before the
caller's next statement. P12-16c settled that this is where it ends rather
than a deletion still owed. Holding the close in a `MutableRef` — the other
shape considered, a release function stored beside the generation and called
as a statement — would move the `runSync` into whoever filled the cell and
buy nothing: the two finalizers are synchronous either way, and a `Scope` is
what already states reverse order and closing exactly once. So the row is
permanent, and what it costs is one `Effect.runSync` of two synchronous
finalizers on a path that must not wait.

`packages/providers` runs no Effect at all any more. P12-17b deleted
`promise-face.ts` and the `runAdapterRead` face in it: every member of the
plugin seam a host holds is an Effect now, so there is nothing left in the
package to run one on. `SessionProviderPlugin.observe()` answers
`Effect<readonly ProviderSessionObservation[]>` — Conductor's is `pass.run()`
handed over unwrapped — and all three `ReadHandlers` members answer Effects
too: the conversation read the P12-17 row named, and the two transcript reads
beside it, which had to move with it because the three share one
`credentialBoundRead` walk over Conductor's documented messages endpoint and a
promise face over that walk would have been the same run under another name.
An `AdapterFailure` a read tolerates is caught in the error channel where the
old face's `Cause.squash` used to be rethrown, so each read still answers its
own refusal with the `ADAPTER_FAILURE` code its caller branches on; anything
else stays a defect the caller reads as it always did. Where a caller is still
a promise, the run is its own edge's rather than the package's: the web's
transcript reads yield `dispatchRead` through the `run` seam they already hold
(`runWeb`), the conversation endpoint's `execute` seam runs
`executeConversationRead` at `runWeb`, and a suite still on `node:assert` uses
`runTest`. `CloudPass.readApiKey` and `ConductorPluginOptions.readApiKey`
answer Effects on the same terms, so the credential a pass or an action reads
afresh is read on the caller's fiber; `cloudPass` still treats a credential
read that fails as no credential at all, now by catching the cause rather than
the rejection.

The four hosted clients this document had not named until the lint rules made
the list machine-readable — `HostedActionClient`'s `#run` in
`packages/hosted/src/action-client.ts`, `DeviceClient`'s `#ask` in
`device-client.ts`, `SessionMessagesClient`'s `#run` in
`session-messages-client.ts`, and `VaultClient`'s `#run` in `vault-client.ts` —
are all four gone, and none of those files is on the allowlist any longer.
P12-20a took them where P12-04b took `changes-client.ts`,
`roster-client.ts`, and `conversation-client.ts`: every public method answers
the request effect rather than a promise run from inside the class. They part
from those three on one point, and it is the `httpClient` option each of the
four takes and none of those three does. A layer a test hands over is the
client's own, so it is provided at construction and the methods answer
`Effect<A>` with nothing left in their requirements, where the other three
leave `HttpClient` there for a caller to provide once. That is what keeps the
requirement out of `SessionActionPerformer#perform` and every `Effect` the
Gateway and the brain hold above it; the run that stood here is simply gone
rather than moved up. The feedback delivery's own courier one package over was
the same shape and is gone too: P12-20b took
`feedbackDeliveryFromEnvironment` onto an effect per submission with its
`HttpClient` already provided, and the desktop's telemetry service runs it on
the launch's own edge — the `run` `compose-desktop.ts` reads out of the fiber
building it — rather than on a runtime the package built for itself.

`readPage` in `packages/host/src/brain/hosted-transcripts.ts` was the price of
that requirement being gone rather than a second door onto the network, and
P12-20m paid it off: the brain's `readTranscript` and `readTranscriptSince`
answer `Effect<A, never, never>` where the agent's own options declared
promises, so `hostedTranscriptReads` yields the messages client's effect on
the turn's fiber rather than running it beside one, and the page's rendering,
its refusals, and its cursors are the same code they always were. The seams
declare no error because no implementer has one — the messages client's read
answers `undefined` where the service refused, and the providers' own
conversation reads already answered effects — so `transcript-reads.ts` catches
the reads' defects instead of their failures: a read that dies is the rejected,
empty delta and the `READ_FAILED` refusal a read that failed always was, the
same shape `read-prefetch.ts` and `apps/web`'s `since` already hold.

`runTest` in `packages/wire/src/testing/effect.ts` is the test harness's own
door on the same terms: a suite still written on `node:assert` outside
`it.effect` holds a `Promise`, so the effect is run to one here, over the layer
the caller supplied or none. `temporaryScope` stood beside it as the second run in
that file, the same door one step further: a promise-shaped suite that had to
build something scoped and then read it across several `await`s could not use
`Effect.scoped`, which would close the scope the moment the build answered, so
it ran `Scope.make` to a promise and registered the close on the test's own
teardown. P12-10 deleted it with its two callers' promise shape:
`packages/host/src/brain/wiring-routing.test.ts` and
`packages/host/src/brain/wiring-children.test.ts` are `it.scoped` and
`it.scopedLive` bodies now, each building its `wireBrain` in the scope the test
itself was given, so the generation clocks arm their waits there and the runner
closes it. `runTest` stays, and with it the file's row: roughly two hundred and
fifty call sites across `packages/providers`, `packages/session`, and
`apps/web` still hold a promise where an effect was described.

Some entries are a suite's edge or a command's rather than the product's.
`openMigratedPglite` in `apps/web/tests/support/sql-client.ts` builds a
`ManagedRuntime` over a PGlite for the length of one migration and disposes it,
which is what lets the store's suites run the web's own migrations against a
database that did not exist before the test. `apps/web/eve/evals/brain-host.eval.ts`
does the same for one eval's Postgres pool and hands the runner it makes to the
fixtures that read through it. `runWithoutDatabase` in
`apps/web/tests/support/no-database.ts` is the same edge with no database
behind it at all: since P10-15 the hosted store answers effects, so the handler
suites that stand a memory fake in its place still need a runner to hand the
modules that take one, and this runs those effects over a `SqlClient` that
refuses every statement — a test that reached a connection it never opened
fails there rather than reading nothing. Each is the edge of the run it is in,
and each stands while that suite does.

The list above is also data. `tools/oxlint/anti-slop/effect-edges.json` is its
machine-readable twin: the same paths under `runtimeEdges`, `runShims`, and
`runOnHandedRuntime`, beside a fourth list, `rawAsyncPrimitives`, naming every
file a raw timer, promise, abort controller, or `fs.watch` still lives in.
`packages/brain/src/read-prefetch.ts` is the one row added there after the
list was drawn: the slot itself is a fiber since P12-16h and is ended by
interrupting it, but the collaborators it calls still read an `AbortSignal`
rather than a fiber — `ModelAdapter#respond`, a tool module's
`ToolExecutionContext`, the turn's own signal — so it holds a controller per
slot and one for the reads, fired where the interruption is raised, on the
same terms as `turn.ts` and `runtime.ts` beside it, and goes with them in
P12-02 when those seams become a fiber's own interruption.
`anti-slop/no-run-promise-outside-edges` and `anti-slop/no-raw-async-primitives`
read it, so both rules are the linter's rather than review's, and the two
directions are enforced in two places: a file that starts running an Effect
without a row fails the lint, and a row that outlived the code it was written
for, or that this section never names, fails `scripts/repository-checks.sh`. A
test body is exempt by extension rather than by a row of its own, because a
test is its own edge and a never-settling `new Promise` is how several suites
here stand in for a service that never answers. `anti-slop/no-node-test` is the
third rule of that set and needs no list at all: every TypeScript test in the
repository runs on vitest, and the `.mjs` harness under `test:harness` is
exempt by extension, which is what it replaced a `scripts/repository-checks.sh`
grep to say.

## Strangler shims and their deletions

Old and new coexist behind a named shim rather than in a long-lived branch, so
main stays green and each package migrates on its own schedule. Every shim is
introduced by one PR and deleted by another, and a shim with no deletion is a
design decision stated as such:

| Shim | Introduced | Deleted |
| --- | --- | --- |
| `s.*` facade over Effect Schema | P1-02 | P12-08 |
| TaggedErrors carry legacy `code` strings on wire | P3-04 onward | never — the wire is the compatibility surface |
| `cloudFetchFromHttpClient` | P1-07 | P12-04e |
| `timersFromRuntime` | P2-01 | P12-03 |
| `BrainTransport#send`'s internal `runCall`, over `runtimeExit(execution)` since P12-04d | P5-05 | never — permanent alongside `tracedModelAdapter`, `compaction.ts`'s `ModelAdapter` stays a promise |
| `postPosthogBatch`, the promise door over the hosted PostHog batch effect (it replaced `createAccountCall`'s, which P12-20b deleted with `AccountCall` and the `AbortSignal` only that door read) | P12-20b | P12-20j — deleted with the promise-shaped `events.ts` route it belonged to; `handleEvents` now yields the batch effect beneath that door directly |
| `HostedChangesClient`/`HostedRosterClient`/`HostedConversationClient`'s `#run` | P3-06c | P12-04b |
| `@sidecar/host`'s `compose-devices.ts`, over the change-signal client above and, since P12-20a, over the device client's `register` and `forget` too (`snapshot-roster.ts` and `compose-conversation.ts`'s `runClientEffect` were on this row and P12-15a deleted both) | P12-04b | P12-20d — deleted; `deviceCadence`'s beat is an effect, so the three client calls and the presence report are yielded |
| `providerRegistrations` record door over `providersLayer` | P6-09 | P7-05 |
| `GatewayClient`'s `Runtime.runFork` of the reconnection a gap opens, on the runtime its scoped `make` was built on | P12-20e3 | pending — once a transport hands its events as a stream without moving the tick a gap is found on |
| `createGatewayService`'s `emit`/`closeAdmissions` on the host's runtime | P6-13 | pending — P7-14 established that the blocker is the synchronous collaborator callbacks that report a change and the promise steps of `GatewayShutdownSteps`, not the `Composer` face it deleted |
| `shutdownGateway`, the promise door over `shutdownGatewayEffect` | P6-04 | P7-10 |
| `retryAttachWhileDetached`, the promise door over `retryAttachWhileDetachedEffect` | P6-04 | P12-20e — deleted with the effect beneath it and its suite, since no caller ever composed either |
| `tracedModelAdapter`'s traced `respond`, over the same `runtimeExit(execution)` since P12-04d | P6-05 | never — permanent alongside `BrainTransport#send`'s `runCall`, for the same reason |
| `timedRequest` (`credentials/account/client.ts`) | P4-03 | P12-20a — deleted; it answers `Effect<Response, Error>` and `AccountClient`'s verbs and `deleteHostedAccount` answer effects with it |
| `HostedActionClient`/`HostedDeviceClient`/`HostedSessionMessagesClient`/`HostedVaultClient`'s `#run`/`#ask` | P3-06c | P12-20a — deleted; each provides its own `httpClient` layer and answers the effect |
| `AccountSessionManager`'s `Effect.runSync(PubSub.unbounded())` field construction | P12-16d | once the class is itself built by an effect its owner runs |
| `LinearIssueTracker#post` | P4-03 | gone with the Linear integration itself |
| `timedRequest` (`credentials/linear/oauth.ts`) | P4-04 | gone with the Linear integration itself |
| `exchangeGoogleCode`'s internal run, over a handed-in `Runtime` (`GoogleCalendarReader#run` was on this row too, deleted once the reader answered effects itself, a `@sidecar/calendar` change unscheduled by this plan) | P4-05 | P12-20d — deleted; `exchangeGoogleCode` answers the effect and the consent trip yields it |
| `ReattachingSocket`'s recovery fiber over its own runtime, a `FiberSet`'s since P12-20i3 | P6-07 | P12-20i2b — deleted; the socket's arrivals are a `Stream`, so the recovery is the next step of the one fiber reading it rather than a fork a close callback makes |
| `detachOn`, the brain's synchronous-start door onto the same runtime | P12-16j | never — P12-16m named it permanent as the detach door: only a run begins the effect on the calling stack, and `AgentSeam#detach`'s queue registration, `BrainHost`'s retirement revocation, and the brain wiring's close and open (P12-16n) must each stand in the step that asked for them |
| `StoreDatabase`'s synchronous `prepare`/`exec`/`transaction` beside its `sql` layer | P5-08 | with `StoreDatabase#run` |
| `StoreDatabase#run` and `#close`, the OpenClaw ports' handle over the store's own `SqlClient` | P5-10a | a synchronous accessor for `archives.ts` and `maintenance-run.ts`; unscheduled |
| The conversation, directory, transcript, envelope, and archive registry tables' synchronous doors the ports call | P5-10a..d | with `StoreDatabase#run` |
| `storeClient`'s Promise face over the store's Rpc client, on the runtime the host hands it | P5-11 | never — the ports' reach: `BrainStateRepository` and `ChildStore` are read by OpenClaw ports that may not import `effect` |
| `FiberStoreRunner`/`fiberStoreRunner`, the promise face `brainHost`'s `runTool` and `relay` hand their seams (it replaced `HostedStoreRun` and `BrainHostSeams.run`, which P10-16 deleted) | P10-16 | P12-18e — deleted; `runTool`'s seams now `Effect.provideService` the request's `SqlClient` over `WebStoreRun`, and P12-18c took `relay`'s onto effects; P12-18b took the turn event stream and the voice compositions off it |
| `Promised<Methods>`, the mapped type the promise-era suites' `promisedWriter`/`promisedAsks` answer in `apps/web/tests/support/promised-store.ts`; P12-18c took `StreamRelay` and `carryStop` onto effects and moved the type out of `server/hosted/fiber-runner.ts` | P10-16 | with each suite as it moves onto `it.effect` |
| `createRateBrake`, the hosted rate brake's promise door over `RateBrake.check` | P10-12 | P12-20j — deleted; `conversation-read.ts` and `events.ts` now answer `Effect.Effect<Response>` run at their edge's `runWeb`, and `devices-vault-app.ts`'s `devicesEffect` yields `RateBrake.check` directly, the last three promise-shaped hosted routes it stood for |
| `retireGeneration`'s `Scope.close` over `Effect.runSync` | P5-04 | never — P12-16c settled it: the fence must stay synchronous, so the row is bookkeeping rather than a deletion owed |
| `compose-account.ts`'s runs of the account gate's links on the host's own runtime | P7-13b | P12-14b (see also below, put back in P12-14f and P12-14h, both deleted in P12-16d) |
| `awaitedSettingsStore`, the settings store's own methods as the promises their unmigrated callers hold | P12-14c | deleted by P12-14i |
| `AppStateStore`'s `subscribe`, the Set-backed callback face beside `snapshot`/`update`/`touch` | P8-02 | P8-07 |
| `LinearCredentials`'s renewal, running `singleFlightEffect` over a handed-in `Runtime` | P7-06 | once `LinearCredentials` answers an Effect itself |
| `AgentSeamTag` / `agentSeamLayer(seam)` over the plain `AgentSeam` object | P5-07 | P7-08b |
| Legacy gateway envelope via a custom `RpcSerialization` | P6-01 | never — the protocol is the contract |

The permanent entries in the table above are not unfinished work. A `GATEWAY_ERROR` code
and the envelope shape in `packages/gateway/src/protocol.ts` are what a client
speaks, and a client is not upgraded by this repository's merge queue; the
goldens in `packages/gateway/fixtures/protocol` are what keeps both
byte-stable. Another is `storeClient`'s face, above: the promises it answers
are the shape the OpenClaw ports beneath it read, and a port imports nothing
from `effect` by a rule of this repository's own. A permanent row stays on
`effect-edges.json`'s `runShims` list like any other, because the lint reads
that list for what a file may do rather than for what is still owed; it is
this table that says which rows are owed.

## What Effect costs the renderer bundles

Effect's `Schema`, `SchemaAST`, and `ParseResult` and the core modules beneath
them are one fixed cost each renderer bundle pays the first time any module it
reaches resolves them, and nothing after that adds another copy. The session
vocabulary's guards (P3-01) are where that first reach happened, ahead of the
renderer's own adoption in P9-01 and P9-03: `renderer.js` went from 455,802 to
555,670 gzipped bytes and `voice.js` from 137,943 to 236,810, both recorded as
the new baselines in `apps/desktop/bundle-budget.json`.

P9-01's `@effect-atom/atom-react` is the second fixed cost, and the last one
this lane budgets for: `renderer.js` went from 555,670 to 645,185 gzipped
bytes and `voice.js` from 236,810 to 321,864, again recorded as the new
baselines. The two bundles grew by 89,515 and 85,054 bytes, which is the same
library in each rather than anything either surface reached for on its own:
`@effect-atom/atom`'s `Atom` module pulls `effect/Stream`, `effect/Channel`,
`effect/Subscribable`, `effect/SubscriptionRef`, and
`@effect/experimental/Reactivity` whatever an atom is built over, so the cost
is paid by importing the library at all. What the measurement also confirms is
the two things the budget exists to refuse: the panel bundle resolves exactly
one copy of `effect`, and neither bundle reaches `@effect/platform-node` or
`@effect/sql` — `@effect/platform`'s `KeyValueStore`, the one companion module
`Atom` names, is tree-shaken out entirely. Paying it there rather
than at P9-01 changes when, not whether, since Effect in the renderer is a
decision this ADR already records. The budget exists to catch growth nobody
chose, so a deliberate adoption re-records it and says so; what it still
refuses is a second copy of `effect`, which is the catalog's guarantee, and a
Node-reaching companion such as `@effect/platform` arriving behind a barrel.
P12-12's tightening of the budget's slack to five percent measures from these
post-Effect numbers.

P9-03's fiber for the voice call is the first renderer adoption that adds no
library at all: naming `Deferred`, `Scope`, `Clock`, and `Duration` where a
timer seam stood cost `renderer.js` 2,914 gzipped bytes and `voice.js` 2,940,
the same modules in each, and both bundles stay under the baselines above, so
the budget is left as P9-01 recorded it.

P9-05's atoms for `use-voice-session.ts`'s local and remote streams reach for
nothing `voice.js` had not already paid for — `Atom` and the Hooks door's
`useAtomValue` are the same modules `use-app-state.ts` already put there — so
the whole of its cost is `effect/Schedule`, named for the first time on this
bundle by the retry that replaced a `window.setTimeout` loop for a refused
remote-audio play: `voice.js` measured 318,521 gzipped bytes on this branch
before the change and 324,967 after, a 6,446-byte cost for the one module.
`renderer.js` does not import this hook at all and measured 642,985 gzipped
bytes identically before and after, so the gap between that number and the
645,185 `bundle-budget.json` still records is drift the panel bundle
accumulated since P9-03's baseline, unrelated to this PR. Both bundles stay
under their recorded ceilings, so the budget is left as P9-01 recorded it.

P9-08 deletes `runAct`'s `Effect.runPromiseExit` and `LiveCall`'s `#run`
(`Runtime.runPromise`) and `#now` (`Runtime.runSync`), turning `LiveCall`'s
four verbs into the Effects `LiveVoiceCall` now declares, and gives
`introduction-takeover.tsx` the one `runCallEffect` helper named above,
through which its own direct use of `LiveCall` reaches the renderer's
runtime, in place of a run at each of its six call sites. No module and no
combinator new to either bundle is named by the change — `renderer.js` moved
from 645,185 to 639,579 gzipped bytes, a 5,606-byte shrink from the deleted
code, and the new baseline is recorded. `voice.js` moved from 321,864 to
324,789, a 2,925-byte growth despite the deletions: the four verbs now return
their Effects directly rather than through a Promise-returning wrapper, which
changes which branches of `Deferred`, `Effect.race`, and `Effect.gen` esbuild
keeps live rather than naming anything new. The growth is 0.9%, well inside
the budget's 15% slack, so the baseline is left as P9-01 recorded it: a
baseline moves only for a deliberate library adoption, not for drift a
deletion happened to leave behind.
