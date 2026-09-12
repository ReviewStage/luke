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
type-level `unique symbol` with `admit()` its sole minter, never a
`Schema.brand`, because a brand a cast can spell is a brand anything can enter.
The JSON Schema a model reads is emitted by `@sidecar/wire`'s own emitter
(`packages/wire/src/effect/json-schema.ts`, which the `s.*` facade shows
through as well) rather than `JSONSchema.make`, because those bytes are
prompt-cache bytes and their goldens are compared as bytes. And every file ported from OpenClaw keeps
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
development ones, because the bridges under `packages/wire/src/effect/` are
product code: `scope.ts` carries a disposable into a `Scope` and back, and
`http.ts` offers an `HttpClient` over a `CloudFetch` and a `CloudFetch` over an
`HttpClient`. The spike test at `packages/wire/src/effect-spike.test.ts`, which
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
  layer it is made from is the whole launch (`services/compose-desktop.ts`):
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
  `voice/use-voice-session.ts`'s remote-audio retry, `voice/live-call.ts`'s
  own session-life fiber and its armed bounds, and
  `introduction/introduction-takeover.tsx`'s one `runCallEffect` helper,
  through which every verb it asks of its own `LiveCall` runs. A fiber built
  on a runtime constructed anywhere else in the bundle is the thing this rule
  forbids, not the pattern above.
- `apps/desktop/src/main/store-worker.ts`, the brain store's own worker
  thread, through `NodeRuntime.runMain(NodeWorkerRunner.launch(...))`. It is
  bundled apart from `main.ts` because a worker starts from its own file, so
  it is a runtime edge of its own rather than a second use of the app's.

`Effect.runPromise`, `Effect.runSync`, and `Effect.runFork` belong nowhere
else: a runtime built where the work lives is a second runtime, and two
runtimes are two copies of every service a `Context.Tag` was supposed to
identify. Everything between the edges returns an Effect and lets its caller
decide. The migration enforces this by review until the lint rule
`no-run-promise-outside-edges` lands, after which the edges above are its
allowlist.

The strangler shims in the table below are on that allowlist for as long as they live.
`cloudFetchFromHttpClient` in `packages/wire/src/effect/http.ts` answers a
promise, because that is what the `CloudFetch` seam its callers still hold
answers, so the bridge is where the effect is run until every one of them takes
a client instead. It is the migration's own scaffolding rather than a second
runtime for the product to live on, and it goes in P12-04 with the seam.

`timersFromRuntime` in `packages/runtime/src/effect/timers.ts` is on the
allowlist for the same reason and on the same terms: the `now`, `schedule`, and
`cancel` closures its callers hold answer a number and a handle rather than an
Effect, so the reading of now is run there and the delay is forked on the
runtime the bridge was handed, never on one it built. It goes in P12-03 with
the seam, the `FakeClock`, and `drainMicrotasks`.

`ObservationLoop`'s `start` and `stop` in
`packages/runtime/src/observation-loop.ts` are the third: the loop's cadence is
a `Schedule` forked into a `Scope` the loop owns, but the composers that arm it
are still promises calling two synchronous methods, so the scope is made and
closed there rather than built around them. `stop` closes the scope without
awaiting it, dropping it first so a pass the interruption has not reached yet
finds the loop disarmed. P7-10 finished the half of this that the drain's own
guarantee turns on: the loop is handed a `CadenceHome`
(`packages/runtime/src/effect/cadence.ts`) rather than a bare `Runtime`, so
each `start` forks its scope from the one its composer was built in and runs
its fiber on the host's own runtime, and the host's close ends the cadence
whatever became of the `stop` that should have. `openCadenceScope`,
`forkIntoCadence`, and `closeCadenceScope` are on the allowlist as that
module's own runs: they are the same runs the armings they were factored out
of already made, in one place rather than four, and each goes with the caller
that made it. What stays is the pair itself,
and it is not the host's lifetime wearing a promise face: what arms these
loops is the account gate opening and closing, so a sign-out has to disarm
them while the host still stands. They go once that gate is an effect.

`admit()` in `packages/actions/src/admit.ts` is the fourth: the gauntlet is
`admitEffect()`, an Effect failing with an `AdmitRefusal`, and `admit()` runs it
to the `Promise<ValidatedAction | Refusal>` its callers still hold, answering
the refusal as the `Refusal` the action journal records and rethrowing a roster
read's own failure. It goes in P12-02 with the `Settled` Promise signatures,
once P7's composers and the turn runner they compose call `admitEffect()` in
runs of their own.

`BrainTransport#send`'s internal `runCall` in `packages/brain/src/client.ts`
is the fifth: every caller of the brain's model transport still holds a
promise, not a fiber, so the request effect built over `@sidecar/hosted`'s
`accountCall` is run to a promise there, joining the caller's own
`AbortSignal` to the run exactly as `createAccountCall` does. It goes in
P12-04 with the rest of that family, because what keeps it is the
`ModelAdapter` interface's own promise: `compaction.ts` is a port of OpenClaw
`b7528507` that awaits `model.respond` and imports nothing from `effect`, so
no adapter above this transport can answer an effect while that port stands.

`createAccountCall` in `packages/hosted/src/account-call.ts` is the sixth: it
provides `layerFromCloudFetch` over the caller's own `fetch`, joins the
caller's `AbortSignal` to the run, and answers the `Promise` its callers still
hold. It goes in P12-04 with the `CloudFetch` seam. `HostedChangesClient`'s,
`HostedRosterClient`'s, and `HostedConversationClient`'s own `#run` in
`changes-client.ts`, `roster-client.ts`, and `conversation-client.ts` are the
seventh, on the same terms: each of these three holds `accountCall` directly
rather than `createAccountCall`, because none of their public methods takes a
caller's own `AbortSignal`, so each keeps its own `layerFromCloudFetch` layer
beside the call and runs the effect there to answer the `Promise` its own
public methods still keep. They go in P12-04 too, once a caller of these
clients runs the effect on its own runtime edge instead.

`ProductEventSender`'s `start`, `stop`, and `flush` in
`packages/analytics/src/sender.ts` are the eighth, on the same terms as
`ObservationLoop`: the flush cadence is a `Schedule` forked into a `Scope` the
sender owns, and the batch itself an effect over `accountCall`, but the
settings composer that constructs and arms this sender
(`packages/host/src/compose-settings.ts`) is still a promise calling
synchronous methods, so the runtime the sender was handed or built is what
runs them rather than the host's own. P7-03 deletes the runtime this class
holds once that composer is a `Layer` and can hand the sender an edge to fork
on instead.

`ServerBoundTransport#run` in `packages/gateway/src/transport.ts` is on the
same allowlist, and it is what is left of the `GatewayServer` class P6-02
introduced and P6-13 deleted. The server is its layers and there is no object
of it any more: `gatewayInProcessHost` builds the whole in-process host end
in the caller's own `Scope` — the assembly's, in `@sidecar/host`, and a test
harness's in the two suites that hold one — and answers the protocol's door,
the event log, the admissions door, and the runtime those layers were built
on. What still runs an effect is the boundary itself: `GatewayTransport`
answers its client a `Promise` and hands it events through a callback, so
`ServerBoundTransport` runs the door's `connect` and `carry` with
`Runtime.runPromise` on that runtime, and the log's `listen` delivers each
event on the tick it was emitted, which a stream read by a fiber of its own
could not. P6-04 had found that routing the request half through
`@effect/rpc`'s own `RpcClient` shifted the microtask timing enough to break
the transports' reconnection-race tests; carrying the same envelopes to the
protocol's door on the host's own runtime does not, and every one of those
tests passes with its exact in-flight assertions unchanged. P12-09 decides
the door: either `GatewayTransport` answers effects by then and its caller
runs them, or the edge rule records this boundary as one.
Two faces beside it run on the same runtime for the same reason and are on
the allowlist too: `createGatewayService`'s own `emit` and `closeAdmissions`
in `packages/host/src/service.ts`, because a change is reported to that
service from a composer's callback rather than from an effect and P12-05
deletes that face, and
`gatewayTestHost` (`packages/gateway/src/testing.ts`) with
`scopedGatewayService` (`packages/host/src/testing/gateway-service.ts`),
which are the test's own edge while those suites are plain `test` bodies
rather than `it.effect`. The socket binding
(`packages/gateway/src/websocket.ts`) never needed any of it: it provides
the `Protocol` a server is built over rather than attaching to one already
built, and composes `layerGatewayServer` over it itself, so what it needs of
a host is the server's own layer options, which `GatewayService` hands out as
`layerOptions` — `GatewayServerLayerOptions` now rather than the deleted
class's own, so it is the layer's own contract and no longer a shim.

`composeHost`'s `start()`/`stop()` in `packages/host/src/compose-host.ts` is
on the same allowlist. Nothing of the product operates it any more — P8-01
took `hostAssemblyLayer` and `hostStandingLayer` onto the desktop's own
runtime, so `compose-host.test.ts` is its one caller left — and the face it
answers is this: the host is `hostStandingLayer` over `hostAssemblyLayer`,
and the adaptor builds the assembly and a `Scope` of its own on a
`ManagedRuntime` it makes, so the server stands before the start as it always
has; `start` is `Layer.buildWithScope` of the standing layer into that scope,
forked as a fiber, and `stop` interrupts that fiber if it is still under way,
runs the drain under the caller's deadline, and then closes the scope,
bounded, forking the close as a daemon and reporting what did not close in
time rather than waiting on it. `hostLayerFromSeams(options)` beside
it is `hostKernelLayerFromSeams` one level up, and the desktop reaches that
shim still: `apps/desktop/src/main/services/host-layer.ts` builds the one
`HostSeams` object this process answers for, merges in `NodeFileSystem.layer`
for the `FileSystem.FileSystem` the settings composer now reaches through its
own tag, and provides both to the assembly; P12-05 deletes the adaptor with
`createHostKernel`. `settingsOverridesFromEnvironment`, the record face beside
the effect at the settings store's own door, is gone with its last caller:
`compose-settings.ts` is now the effect over the `Environment` seam directly,
and the store's own tests read the same `settingsOverrides` effect through a
`ConfigProvider` built from the environment record they still pass around.

`startConversationMaintenance` in `packages/host/src/conversation-operations.ts`
is on the same allowlist and for the same reason: the hourly pass is now
`Effect.repeat` on a fiber forked into a `Scope` the function makes at its own
call, rather than a `setInterval`, but the brain composer that starts and
stops it (`packages/host/src/compose-brain.ts`) is still a pair of plain
functions, so the scope is made and closed here instead of built around it.
`Effect.repeat` rather than `Effect.schedule`: nothing here awaits a first
pass separately, so the cadence's own first repetition is the launch's pass,
exactly as the interval it replaces ran its callback once before arming.
P7-10 closed the scope half: the call takes the brain composer's own
`CadenceHome` and forks its scope from the one that composer was built in, so
the hourly pass runs on the host's runtime and the host's close ends it. The
stop the brain's own `stop` still calls is what remains, and it goes with the
`Composer` interface's promises.

`UpdateService`'s `start`, `stop`, and `#armPublishingRetry` in
`apps/desktop/src/main/update-service.ts` are on the same allowlist, on the
same terms as `ObservationLoop`: the timed check and the publishing-window
retry are each a `Schedule` forked into a fiber of the service's own `Scope`,
but the composer that builds and arms it (`update-service-host.ts`, called
from `compose-desktop.ts`) still holds a promise-returning `start`/`stop`
pair, so the scope is made in the constructor and closed there rather than
built around the composer. The publishing retry steps `Schedule#step`
directly rather than driving it through a `ScheduleDriver`, because the
driver's own `next` sleeps out the delay it returns where this needs the
delay back, to arm a cancellable fiber a fresh check can still collapse
mid-wait. It goes once `update-service-host.ts`'s own composer is a `Layer`
of its own rather than a promise calling these two synchronous methods.

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

`deviceCadence`'s `start` and `stop` in `packages/host/src/compose-devices.ts`
are on the allowlist: the poll's cadence is a `Schedule` on a fiber these two
fork and interrupt, because the devices composer that calls them at the
account gate's own edges is still a pair of promises. The calendars composer's
`startObservation` and `stopObservation` in
`packages/host/src/compose-calendars.ts` are on the same allowlist, for the
same reason: the held-notice release and the Apple access poll are
`Schedule`s on fibers forked into one `Scope` `startObservation` makes, and
the meeting-boundary wake is a one-shot fiber the composer re-arms itself on
every observation pass into that same scope, but the composer that calls
`startObservation`/`stopObservation` — `compose-host.ts`'s own
`startAccountCapabilities`/`stopAccountCapabilities`, at the account gate's
edges — is still a pair of promises, so the arming and the disarming are these
two functions rather than a build around them. `stopObservation` closes the
scope, and interrupts the boundary wake's own fiber if one still stands,
without awaiting either: what it has to guarantee is that nothing more fires,
never that a fiber has already ended. P7-10 took the orphan out of both: each
arming forks its scope from the one its composer was built in, through the
shared `CadenceHome`, so the host's own close interrupts what a disarm missed
and an arming after that close forks from a scope already closed, which
interrupts what it forked at once. The pairs themselves stand while the gate
that calls them is a promise.

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

`retryAttachWhileDetached` in `packages/gateway/src/attachment.ts` is on the
allowlist too, and for its own reason rather than a caller's: nothing in this
build composes it yet — the client this policy is for is one that can
actually detach and reattach, which the desktop's own in-process operator
never does (it is composed and attached exactly once, for the process's whole
life; P8-04 confirmed this rather than assuming it) — so the door forks
`retryAttachWhileDetachedEffect`'s backoff loop on its own scope and answers a
release closure over `Fiber.interrupt` rather than one built by an edge that
holds it. `retryAttachWhileDetachedEffect` is itself the whole policy: the
pause doubles from `ATTACH_RETRY_DEFAULTS.INITIAL_DELAY_MS` to its cap on
every announced detachment, and the attempt is forked into the ambient
`Scope`, so interrupting it — closing the scope the door made, or the one an
edge builds instead — cancels a pause still being waited out rather than
merely gating the call it would have made. Both go once a caller that can
genuinely detach exists to hold that scope directly; no PR in this plan is
that caller yet.

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

`storeClient`'s Promise face in `packages/brain/src/store/store-client.ts`
is on the allowlist too: the host's store wiring still holds a `StoreClient`
of promises, so each ask — one request through the Rpc client over the
one-worker `NodeWorker` pool, admitted in order and raced against the
worker's own exit — is settled to a promise there and rejects with the
failure itself. What P7-08 changed is whose runtime that is: the face takes
an `ExecutionRuntime` and the brain composer hands it the host's own, so an
ask is a fiber of the one runtime the host holds rather than of a default one
built where the work lives. The face itself stands for as long as the three
interfaces it answers do — `BrainStateRepository`, `NotebookMemoryStore`, and
`ChildStore` are each declared as promises in packages below the store — and
no PR in this plan is the one that turns those into effects.

`AgentTraceWriter` in `packages/devtrace/src/trace-writer.ts` is on the same
terms: its callers are the host's composers, which still hold a plain object
with `record*` methods rather than a fiber, so each tapped line — the entry an
Effect `Logger` formats and the `FileSystem` write that carries it to disk —
is run on the writer's own `ManagedRuntime` here. It is deleted once the host
composer that holds it is a `Layer` able to hold that runtime itself, in
Phase 7's devtrace composer conversion.

`SettingsStore`'s `#readPersisted` and `#write` in
`packages/host/src/settings-store.ts` are on the allowlist too, though not on
`AgentTraceWriter`'s terms any more: `compose-settings.ts` is now an `Effect`
over the `HostKernelTag`, `Environment`, `SecretCipher`, and
`FileSystem.FileSystem` tags, so the class no longer builds its own
`ManagedRuntime` over `NodeFileSystem.layer` — the composer captures the
`Runtime.Runtime<FileSystem.FileSystem>` it is already running under, with
`Effect.runtime`, and hands that in, so `readSettingsFileText` and
`writeSettingsFileAtomic` run on the one `FileSystem` the host's assembly
layer resolves rather than a second layer of the class's own. What keeps this
on the allowlist is narrower now: the class still answers `get`/`set`/
`snapshot`/... as Promises rather than Effects, so those two reads and writes
still have to reach a promise somewhere, and this is where. The parse failure
beside them, `parsePersistedSettingsEither`, answers an `Either` rather than a
throw and is not on this allowlist, since it runs no effect: it wraps the
store's own `parsePersistedSettingsThrowing` in `Either.try`, kept private to
that wrapping rather than a second parse a caller could reach directly, and
every caller today still folds a refusal into `defaultPersistedSettings()`
exactly as the throwing form's catch already did. The cipher is sourced
through the `SecretCipher` tag at the composer and handed to the class as the
same plain field it always was: decrypting a stored key or grant is still
synchronous and throws on its own terms, so widening the tag past the
composer would gain the class nothing. The plan schedules no PR that states
this class's own methods as Effects, and this row is where that is recorded.

`tracedModelAdapter` in `packages/devtrace/src/brain-trace.ts` is on the same
terms as `runCall`: the traced `respond` still answers the `ModelAdapter`
interface's promise, so the `Effect.withSpan` wrapping the wrapped adapter's
call is run to that promise here. It goes together with
`BrainTransport#send`'s `runCall` in P12-04, and for the same reason: it can
stop answering a promise only when the `ModelAdapter` it wraps does.

`timedRequest` in `packages/credentials/src/account/client.ts` and
`LinearIssueTracker#post` in `packages/credentials/src/linear/tracker.ts` are
on the same allowlist: both build a request over the ambient `HttpClient`
from a `CloudFetch`-shaped `fetch` option, exactly as `createAccountCall`
does, and both still answer their callers — `AccountClient`,
`deleteHostedAccount`, and `LinearIssueTracker`'s `observe`/`execute` — a
Promise rather than a fiber, so each runs its request to a promise in place.
Both go with `CloudFetch` and `layerFromCloudFetch` in P12-04.

`LoopbackConsent`'s `signIn` in
`packages/credentials/src/loopback-consent.ts` is another, and the only one
whose scope holds a listening socket: the trip itself is `signInEffect()`,
whose `Scope` binds the loopback server and closes it on a grant, on the
deadline, and on an interruption alike. Two of its three callers moved off it
in P7-06: the calendars and issues composers, both built as effects now, call
`signInEffect()` directly through `Runtime.runPromise` on the runtime their
own layer runs on and `Effect.scoped` in place of the door's own scope. The
one caller left is `AccountSessionManager`'s own sign-in, in
`packages/credentials/src/account/session-manager.ts` — P7-04's account
composer, already merged and deliberately kept promise-based, since what it
holds late is a `Deferred`-backed `link`, not `refreshOnce` — so the scope
still opens and closes here for that one trip. `signIn` goes once that caller
is an effect too. `timedRequest` in
`packages/credentials/src/linear/oauth.ts` is beside its namesake in
`account/client.ts` and on exactly the same terms: Linear's three OAuth
calls — the code exchange, the refresh, and the revocation — each build a
request over the ambient `HttpClient` from a `CloudFetch`-shaped `fetch`
option and each still answer their callers a Promise, so the request is run
to one in place. It goes with `CloudFetch` and `layerFromCloudFetch` in
P12-04.

`singleFlight`'s returned closure in `packages/credentials/src/single-flight.ts`
is on the allowlist too, and the only one not shaped by `CloudFetch`; P7-06
moved its one caller that could move. `LinearCredentials`'s renewal in
`packages/credentials/src/linear/credentials.ts` now holds the join itself as
`singleFlightEffect` — the same check-and-create over the internal
`Semaphore` and `Deferred`, answered as an Effect rather than run to a promise
inside the function — and runs it on the issues composer's own runtime
through a `runtime` option, exactly as `DeviceRegistration`'s reads.
`singleFlight` itself stays, as the promise-returning wrapper over
`singleFlightEffect`, for `AccountSessionManager.refresh`'s own renewal: what
holds `refreshOnce` there is the `AccountToken` a hosted client is handed and
the account composer's own `link`, both of which answer promises, so that
caller runs the join as an Effect only once `AccountSessionManager.refresh`
is one itself.

`GoogleCalendarReader`'s `#run` in `packages/calendar/src/reader.ts` and
`exchangeGoogleCode` in `packages/calendar/src/oauth.ts` are on the allowlist
too, reworked in P7-06 rather than deleted outright as this document once
planned: `packages/host/src/compose-calendars.ts` is built as an effect now
and hands both a `Runtime.Runtime<never>` — its own, obtained inside the
`Effect.gen` as `Effect.runtime<never>()` — through a `runtime` option each
reads exactly as `DeviceRegistration`'s does, so each runs its request effect
there instead of on the ambient default runtime. Full deletion did not follow,
because the premise this document stated for it was wrong on contact:
`compose-calendars.ts`'s own `GatewayMethodTable` handlers stay promises
regardless of how the composer itself is built — the Gateway is not
Rpc-shaped until Phase 6's server work reaches this host — so a bridge from a
promise-returning method to the reader's own request effect is still
necessary, just onto a real runtime instead of a default one. Both go once
the calendars composer's own methods answer effects rather than promises.

`LiveVoiceOrchestrator`'s `beginTalk`, `endTalk`, and `stopSpeaking` in
`packages/voice/src/orchestrator/live-voice-orchestrator.ts` are on the
allowlist: the standing call's whole life is one fiber the orchestrator forks
on the runtime it was handed, opening the call as an `Effect.acquireRelease`
acquire and closing it as the release, and `LiveVoiceCall`'s four verbs answer
Effects run on that same runtime, but `beginTalk`, `endTalk`, and
`stopSpeaking` above them still answer promises of their own, run to one on
the orchestrator's runtime rather than a caller's fiber. The orchestrator's
one caller is the renderer's `use-voice-session.ts`, never a host composer, so
P9-03 (the renderer's own voice lane, not P7-07) deletes the seam once that
caller runs on its own fiber rather than awaiting these promises. Beside it,
`ReattachingSocket`'s recovery in `packages/voice/src/live-session-source.ts`
is on the allowlist too, and for its own reason rather than a caller's: the
socket it wraps is a plain, synchronous `LiveSocket`, so the tries themselves
are a fiber this class forks and interrupts on its own, with no promise
anywhere above it waiting to be freed of one. P9-03 deletes it together with
the orchestrator's, for the same reason: both are reached only from the
renderer's voice call machinery, never from `packages/host`.

`HostedStoreRun` in `apps/web/server/hosted/store/database.ts` is on the
allowlist as the door rather than as a runtime: a module of the hosted store
moved onto `@effect/sql` answers an `Effect<A, SqlError | ParseError,
SqlClient>`, while the `HostedStore` methods above it answer the promises the
routes still hold, so the store is handed the runner of whichever edge composed
it — `runWeb` in a web function, the store tests' own runtime over the same
connection — and builds nothing itself. The store writer,
the voice writer, the speech module, and the brain host's own seams take the
same runner directly rather than through the store's context, because a route
composes each of them apart from the store: it is the one door either way, and the transaction a write runs
under is the client's own. Every module beneath it is already an effect as of
P10-14a, and P10-14d has deleted the Drizzle handle this door never
depended on; P10-15 deletes this door itself, once `HostedStore`'s own
public interface moves from promises to Effects across every brain-host and
route caller.

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

`createRateBrake` in `apps/web/server/hosted/rate-brake.ts` is on the allowlist
for the same reason `HostedStoreRun` is: `RateBrake.check` is an
`Effect.Effect<boolean>` a per-user window reads through the ambient `Clock`,
but every route that braked a request still holds a plain boolean it awaits,
so `createRateBrake` runs that check to a promise here rather than on a fiber
of its own. Effect's own `RateLimiter` was tried first and dropped: its only
way to ask whether a permit is free without waiting for one is racing its
blocking `take` against a zero-duration timeout, and that race lost to a busy
event loop in this repository's own test suite, refusing a request nothing had
actually rate-limited. P10-05..10 deletes the door once the routes that call it
run their own Effects under `HttpApi` and reach `RateBrake.check` directly.

`Maintenance`'s `#writeFlushMarker` in `packages/brain/src/maintenance.ts` is on
the allowlist too: its own caller still holds a `Promise<Settled<...>>` for
the flush marker's write outcome, so `writeFlushMarkerEffect` — an
`Effect.retry` over `@sidecar/memory/effect`'s `markerWriteSchedule`, the same
bound `MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS` states — is run to that
promise here rather than on a fiber of its own. It goes in P12-02, with the
turn runner: this write is made inside the housekeeping turn, so it reaches a
fiber of its own exactly when that turn does.

`settledUnlessAborted` and `claimedUnlessAborted` in
`packages/brain/src/settled.ts` are on the allowlist on the same terms: the
interruption bridge is `packages/brain/src/effect/settled.ts`, where a run's
`AbortSignal` is an effect a race settles against and a value that must be
owned by exactly one party is a `Deferred` both arms reach for, and the
Promise door runs it to the `Promise<Settled<T>>` its callers still hold. The
door is also where a hot promise's outcome is observed, since the bridge may
answer a signal that had already fired without ever starting the work, and a
rejection nobody waits on must still have its handler. P12-02 deletes the door
once the turn runner, the generation, and maintenance each wait in a fiber of
their own.

`promiseAgentRuntime` in `packages/runtime/src/execution.ts` is on the
allowlist for the shape of the contract above it rather than its own. The
execution seam itself is `AgentRuntimeEffect`, which answers effects
throughout: `capabilities`, `compact`, and `openContext` are effects, `resume`
is one failing with a `RuntimeResumeRefused`, and a run is `RuntimeRunEffect`,
whose `done` is the run rather than a handle on one already going — the loop
between the model and its tools, forked by whoever runs it, with a cancel, a
deadline, and the host's own revocation all reaching it as that fiber's
interruption, and the batch of calls the model emitted uninterruptible as one
so no dispatched effect is ever cut off from the result the host checkpoints
for it. `ToolLoopAgentRuntime` implements that seam and runs nothing: it
builds no runtime, forks no fiber, and holds no promise of its own.
`AgentRuntime`, the shape every host in this repository still reads, is the
same seam with those five answers as promises, and this door is what builds
one from the other — on the runtime it is handed and never one built here,
with `Cause.squash` rethrowing the error a listener or an engine actually
threw rather than the fiber failure that carried it, and a run's `done`
carried the instant `start` answers, so a host that steers or cancels before
it awaits reaches a run already going. P7-08 is what began handing it a
runtime rather than letting it take the default: `toolLoopRuntimeOver` takes
an execution, and the host's brain composer passes the runtime its own layer
is being built on, so every run of the tool loop is a fiber of the host's
runtime. P12-02 deletes the door and the `AgentRuntime` shape with it, with
the turn runner that holds it: a run stops being a promise exactly when the
turn that carries it is a fiber.

What the door does not carry is the other three seams. `ModelAdapter`,
`ContextEngine`, and `ToolExecutor` stay as the host hands them in, because
each is owned above the runtime by identity rather than by shape: the host
marks, rolls back, and checkpoints the very engine `openContext` answered and
compares it by reference, and it folds the context through the same adapter
inside `compaction.ts`, which is an OpenClaw port and so imports nothing from
`effect`. An Effect-shaped counterpart for any of the three would therefore
need a promise view built back out of it inside the brain, which is the same
run in another file rather than one less. They move in P12-04, and the two shims that stand on them — `BrainTransport#send`'s
`runCall` and `tracedModelAdapter`'s traced `respond` — name P12-04 below for
that reason. The `Settled` waits in the turn runner's own `#recall` stand for
the same reason and go with the door itself in P12-02.

The rest of this package's Promise faces turned out to stand on
`BrainAgent`'s own public surface rather than on the vocabulary's: a wake, an
ask, a run event's subscriber, and the generation a replacement installs are
each answered to a host that holds a promise and not a fiber. Three of those
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
and an effect here could only ever be run. The agent's own `eventFromStream`
bridge is the one of the four that stays, and it names P12-06 below.

`BrainAgent`'s own construction in `packages/brain/src/agent.ts` is on the
allowlist too: `onRunEvent` still answers the `Event<BrainRunEvent>` its
subscribers hold, now bridged from a `PubSub` by `eventFromStream`, and
building that bridge takes a `Scope` the agent owns rather than one an edge
handed it, so the scope is made and the bridge built with a `runSync` at
construction. Closing that scope in `stop()` runs to a promise instead,
since interrupting the bridge's own daemon pump — parked waiting on the
pubsub whenever nothing has fired since the last event — is not guaranteed
to settle synchronously. P12-06 deletes both runs, with `eventFromStream`
itself: the bridge cannot outlive the `Event` its subscribers hold, and it
cannot go before it.

The coalescing timer the wake queue arms is untouched by that, since it is
still the injected `schedule`/`cancel` seam a real elapsed-time wait stands
behind rather than anything the queue runs.

`cloudPass` in `packages/providers/src/shared/cloud-pass.ts` no longer needs an
allowlist entry: its reads and its one write are effects over an `HttpClient`
built from the caller's own `CloudFetch`, the 429 cadence is a `Schedule`
stepped on the fiber's clock, and `run`, `write`, and `credentialBoundRead` are
themselves effects now that Conductor — the one adapter that rides it — is on
them too. `Cause.squash` is still what `runAdapterRead` rethrows at the door
where `SessionProviderPlugin` still holds a promise, so the `AdapterFailure` a
caller already branches on is the failure it reads rather than the fiber's
wrapping of it, but that is `promise-face.ts`'s allowlist entry, not a second
one of `cloudPass`'s own.

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
dispose. `state-store.ts` keeps its own compare-and-set against the envelope
it last observed standing, because it is ported from OpenClaw `b7528507` and
imports nothing from `effect`; its Effect surface stays in
`state-store.effect.ts`. P12-02 deletes this run with the turn runner, once a
generation is retired inside the fiber that replaced it.

`runAdapterRead` in the same package's `promise-face.ts` is the one face every
adapter answers a `SessionProviderPlugin` from. Claude Code's and Codex's reads
are effects — the observation pass over a `Ref`-held parse cache, the JSONL
transcript reader and its path cache, and Codex's state database inside a
scope — while the plugin seam the host holds is still `observe(): Promise<...>`
and two promise-returning reads, so the run happens in this one place rather
than in each adapter: `ObservationPass#runPromise`, `promiseTranscriptReads`,
and Codex's own `observe` all call it, and OMP's plugin is the same shape over
the same two shared faces. Conductor's cloud pass joins it the same way: its
own `observe`, its actions' one write, and its conversation reads' one
credential-bound read are each effects now that `cloudPass` is, so its plugin
calls the same face rather than a second one of its own, and its two local
SQLite reads (`applications.ts`, `local-workspaces.ts`) call it too, each over
`Effect.scoped(scopedReadOnlyDatabase(...))`. Superset's own host-state read
(`reader.ts`'s `supersetHostState`) is the same shape once more: one
`Effect.scoped(scopedReadOnlyDatabase(...))` per organization's database,
folded into one snapshot, reached through this same face rather than a
promise face of its own. These reads tolerate everything an absent or
unreadable provider directory, or an unauthorized or unreachable credential,
answers, so the face rethrows `Cause.squash` and a caller reads the failure or
the defect it always did. P7-05 turned out not to be its deletion: the host's
observation composer never called a plugin's `observe()` or a transcript read
directly — its roster is the hosted service's own `HostedRosterClient`
snapshot, drawn in `snapshot-roster.ts`, and the local registrations it built
were read only for their `plugin.provider` identity, to reset the local roster
at a stop. Converting that composer to `providersLayer` (P7-05) therefore
touches none of `runAdapterRead`'s actual callers, which are every one named
above and stay inside `packages/providers` itself; the door goes only once
each of those adapters' own plugins holds a fiber of its own to run its
effects on rather than answering a `Promise` through this face, which is not
yet scheduled on any row above.

## Strangler shims and their deletions

Old and new coexist behind a named shim rather than in a long-lived branch, so
main stays green and each package migrates on its own schedule. Every shim is
introduced by one PR and deleted by another, and a shim with no deletion is a
design decision stated as such:

| Shim | Introduced | Deleted |
| --- | --- | --- |
| `s.*` facade over Effect Schema | P1-02 | P12-08 |
| TaggedErrors carry legacy `code` strings on wire | P3-04 onward | never — the wire is the compatibility surface |
| `disposableFromScope`/`addDisposable` | P1-05 | P12-06 |
| `streamFromEvent`/`eventFromStream` | P1-06 | P12-06 |
| `cloudFetchFromHttpClient` | P1-07 | P12-04 |
| `timersFromRuntime` | P2-01 | P12-03 |
| `ObservationLoop`'s `start`/`stop`, the arming the account gate calls | P2-04 | with the gate's own promises; P7-10 made the scope the host's |
| `admit()` Promise door over `admitEffect()` | P4-01 | P12-02 |
| `BrainTransport#send`'s internal `runCall` | P5-05 | P12-04 |
| `createAccountCall` Promise door over `accountCall` | P3-06 | P12-04 |
| `HostedChangesClient`/`HostedRosterClient`/`HostedConversationClient`'s `#run` | P3-06c | P12-04 |
| `ProductEventSender`'s `start`/`stop`/`flush` over its own runtime | P4-08 | P7-03 |
| `providerRegistrations` record door over `providersLayer` | P6-09 | P7-05 |
| `ServerBoundTransport#run`, the in-process transports' runs on the host's runtime | P6-13 | P12-09 |
| `createGatewayService`'s `emit`/`closeAdmissions` on the host's runtime | P6-13 | P12-05 |
| `gatewayTestHost`/`scopedGatewayService`, the suites' own scoped builds | P6-13 | P12-09 |
| `shutdownGateway`, the promise door over `shutdownGatewayEffect` | P6-04 | P7-10 |
| `retryAttachWhileDetached`, the promise door over `retryAttachWhileDetachedEffect` | P6-04 | none yet — no caller can genuinely detach |
| `runAdapterRead`, every adapter's Promise face over its read effects | P6-11a | not yet — every caller stays inside `packages/providers`; P7-05 confirmed the host never called one directly |
| `AgentTraceWriter`'s own `ManagedRuntime` | P6-05 | Phase 7 devtrace composer |
| `tracedModelAdapter`'s traced `respond` | P6-05 | P12-04 |
| `timedRequest` (`credentials/account/client.ts`) | P4-03 | P12-04 |
| `LinearIssueTracker#post` | P4-03 | P12-04 |
| `singleFlight`'s Promise-returning closure, over `singleFlightEffect` | P4-03 | the account's caller once `AccountSessionManager.refresh` answers an Effect |
| `LoopbackConsent`'s `signIn` Promise door over `signInEffect` | P4-04 | once `AccountSessionManager`'s sign-in is an effect |
| `timedRequest` (`credentials/linear/oauth.ts`) | P4-04 | P12-04 |
| `GoogleCalendarReader#run` / `exchangeGoogleCode`'s internal run, now over a handed-in `Runtime` | P4-05 | once the calendars composer's methods answer effects |
| `LiveVoiceOrchestrator`'s `beginTalk`/`endTalk`/`stopSpeaking` over its own runtime | P6-07 | P9-03 — its one caller is the renderer's `use-voice-session.ts`, never a `packages/host` composer |
| `ReattachingSocket`'s recovery fiber over its own runtime | P6-07 | P9-03, for the same reason |
| `LiveSessionSourceTag`/`IntroductionSessionSourceTag` over their plain source objects | P6-08 | pending — every caller today (`compose-live.ts`'s `account.voiceCapabilities.liveSessions`, the renderer's orchestrator, the desktop main's introduction flow) reads its source as a getter whose answer changes over the run; a static `Layer.succeed` cannot stand in for that, so nothing adopts the tag yet |
| `LiveVoiceBridgeTag` / `liveVoiceBridgeLayer(bridge)` over the plain `LiveVoiceBridge` object | P6-08 | P9-03 — its one caller is the renderer's orchestrator |
| `LiveBrainTag`/`LiveRecordTag` over their plain collaborator objects | P6-08 | pending — P7-07 is the first real caller (`compose-host.ts` builds the plain `LiveBrain`/`LiveRecord` and hands them to `compose-live.ts` through these tags), but `LiveSessionService`'s own constructor still takes them as plain fields, so the adaptor stands until that class reads the tags itself, a `packages/voice` change beyond a host composer |
| `Settled` Promise signatures | P5-01 | P12-02 |
| `promiseAgentRuntime`, the `Promise` door over `AgentRuntimeEffect` | P5-14b | P12-02 |
| `BrainAgent`'s own `eventFromStream` bridge over its run events | P5-06 | P12-06 |
| `StoreDatabase`'s synchronous `prepare`/`exec`/`transaction` beside its `sql` layer | P5-08 | with `StoreDatabase#run` |
| `Maintenance`'s `#writeFlushMarker` over its own `Effect.runPromise` | P5-13 | P12-02 |
| `StoreDatabase#run` and `#close`, the OpenClaw ports' handle over the store's own `SqlClient` | P5-10a | a synchronous accessor for `archives.ts` and `maintenance-run.ts`; unscheduled |
| The conversation, directory, transcript, envelope, and archive registry tables' synchronous doors the ports call | P5-10a..d | with `StoreDatabase#run` |
| `storeClient`'s Promise face over the store's Rpc client, on the runtime the host hands it | P5-11 | with `BrainStateRepository`, `NotebookMemoryStore`, and `ChildStore`; unscheduled |
| `HostedStoreRun`, the hosted store's promise door over its `@effect/sql` modules | P10-11a | P10-15 |
| `createRateBrake`, the hosted rate brake's promise door over `RateBrake.check` | P10-12 | P10-05..10 |
| `retireGeneration`'s `Scope.close` over `Effect.runSync` | P5-04 | P12-02 |
| `hostSeamLayers(options)`/`hostKernelLayerFromSeams(options)`, the host seams stood up from one object, and `createHostKernel` beside them | P7-01 | P12-05 |
| `composeHost`'s `start()`/`stop()` adaptor over `hostLayer`, and `hostLayerFromSeams(options)` beside it | P7-02 | P12-05 |
| `UpdateService`'s `start`/`stop`/`#armPublishingRetry` over its own `Scope` | P8-03 | once `update-service-host.ts`'s composer is a `Layer` of its own |
| `mergeMethods`, the throwing fold over `foldMethods` | P7-02 | P12-05 |
| `startConversationMaintenance`'s stop, over a scope the host now owns | P7-05 | with the brain composer's own promises; P7-10 made the scope the host's |
| `AppStateStore`'s `subscribe`, the Set-backed callback face beside `snapshot`/`update`/`touch` | P8-02 | P8-07 |
| `deviceCadence`'s `start`/`stop`, the arming the account gate calls | P7-09 | with the gate's own promises; P7-10 made the scope the host's |
| `LinearCredentials`'s renewal, running `singleFlightEffect` over a handed-in `Runtime` | P7-06 | once `LinearCredentials` answers an Effect itself |
| The calendars composer's `startObservation`/`stopObservation`, the arming the account gate calls | P7-06 | with the gate's own promises; P7-10 made the scope the host's |
| `AgentSeamTag` / `agentSeamLayer(seam)` over the plain `AgentSeam` object | P5-07 | P7-08b |
| Legacy gateway envelope via a custom `RpcSerialization` | P6-01 | never — the protocol is the contract |

The two permanent entries are not unfinished work. A `GATEWAY_ERROR` code and
the envelope shape in `packages/gateway/src/protocol.ts` are what a client
speaks, and a client is not upgraded by this repository's merge queue; the
goldens in `packages/gateway/fixtures/protocol` are what keeps both byte-stable.

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
