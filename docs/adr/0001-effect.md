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
- `apps/web/scripts/preview-probe.ts`, the deployed-shape probe, on the same
  terms: probing a deployment over `FetchHttpClient` and appending the step
  summary are effects of one command's life, run through
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
as named, shared functions: `children.effect.ts` and `queue.effect.ts` each
now build the bridge inline, over the runtime their `Effect.acquireRelease`
was handed, never one either builds, and so does `compose-live.ts` for
`LiveSessionService`'s idle, settle, and finalize timers, over the runtime
the live composition runs on; none of the three names or imports the others'
copy, since a caller that still needs the bridge keeps its own beside the
code that uses it rather than sharing a module three packages once did.
`packages/brain/src/effect/harness.ts`'s own copy stays for now, answering
the brain's test harness alone, so its `BrainAgent` reads the ambient
`TestClock` an `it.effect` test already stands on rather than a `FakeClock` of
its own; it is still `runOnHandedRuntime` on the same terms the others were:
it starts the work on the runtime it was handed rather than building a
second one, so this is that runtime's own edge for as long as the seam it
answers still takes closures instead of an effect. It goes once `BrainAgent`
answers `Clock` and `Scope` directly instead.
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
sibling that needs the shape rather than redeclaring it — `packages/runtime/src/scheduled-timer.ts`
(kept, since `children.ts`/`queue.ts` are OpenClaw ports whose constructor
option this is, and `packages/host/src/brain/wiring-children.ts` imports the
same one from `@sidecar/runtime` to build a `ChildRunService`) and
`packages/voice/src/scheduled-timer.ts` (restored under the name
`TimerHandle`, imported by `append-channel.ts` and `notice-strip.ts` and
re-exported through `@sidecar/voice/live-session` for `compose-live.ts` and
the hosted voice service's own tests). What P12-03b actually deletes is the
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
lifetime is. `openCadenceScope`, `forkIntoCadence`,
and `closeCadenceScope` stay on the allowlist for the one arming left that is
not an effect: the calendars composer's meeting-boundary wake, re-armed from
inside an observation pass the loop runs as a promise, so the fork and the
interruption are runs there until that pass is an effect too.

`admit()` in `packages/actions/src/admit.ts` is the fourth: the gauntlet is
`admitEffect()`, an Effect failing with an `AdmitRefusal`, and `admit()` runs it
to the `Promise<ValidatedAction | Refusal>` its callers still hold, answering
the refusal as the `Refusal` the action journal records and rethrowing a roster
read's own failure. Its callers reach it across the `ToolExecutor` seam and
the web's action endpoint, neither of which answers an effect yet — a turn is
a fiber from P12-02 on, but the tool call it dispatches still crosses a
promise. P12-04 turned out to be the CloudFetch/HttpClient family alone; this
door waits on the `ToolExecutor` seam in `@sidecar/runtime/vocabulary`
answering an effect, a change to the tool-dispatch shape rather than a
transport, so it is re-pointed at P12-15 instead.

`BrainTransport#send`'s internal `runCall` in `packages/brain/src/client.ts`
is the fifth: every caller of the brain's model transport still holds a
promise, not a fiber, so the request effect built over `@sidecar/hosted`'s
`accountCall` is run to a promise there, joining the caller's own
`AbortSignal` to the run exactly as `createAccountCall` does. P12-04d moved
what it runs on: `BrainTransport` takes an `execution?: ExecutionRuntime`
(the host's own, captured once in `compose-account.ts` as
`Effect.runtime<never>()` and threaded through `VoiceCapabilityAssembler` to
every adapter it builds) and `runCall` runs through `@sidecar/brain`'s shared
`runtimeExit(execution)` — the same door `tracedModelAdapter` runs through —
rather than the ambient default runtime `Effect.runPromiseExit` read before.
It is permanent alongside `tracedModelAdapter`, because what keeps both is
the `ModelAdapter` interface's own promise: `compaction.ts` is a port of
OpenClaw `b7528507` that awaits `model.respond` and imports nothing from
`effect`, so no adapter above this transport can answer an effect while that
port stands.

`createAccountCall` in `packages/hosted/src/account-call.ts` is the sixth: it
provides the caller's own `httpClient` layer, or `FetchHttpClient.layer` for
the ambient ones, joins the caller's `AbortSignal` to the run, and answers
the `Promise` its callers still hold. P12-04 moved every caller inside this
package onto `accountCall` directly and deleted the `CloudFetch` seam this
door used to take its layer from; what is left is the promise door itself,
kept for its two remaining callers outside this package — the web app's
hosted PostHog batch and its voice session mint — and deleted once both take
`accountCall` instead. `HostedChangesClient`'s, `HostedRosterClient`'s, and
`HostedConversationClient`'s own `#run` in `changes-client.ts`,
`roster-client.ts`, and `conversation-client.ts` were the seventh; P12-04b
deleted it, so `observe`, `projects`, `poll`, `messages`, `events`, `turns`,
`clear`, and `rate` now answer the effect over the ambient `HttpClient`
directly rather than a promise each class ran to itself. Their callers —
`@sidecar/host`'s `snapshot-roster.ts`, `compose-devices.ts`, and
`compose-conversation.ts` — are new entries on this same allowlist instead:
`ObservationLoop`'s `run` callback, `deviceCadence`'s beat, and the
Conversation poll's pager are each still a promise or a plain async callback
rather than a fiber of their own, so `drawSnapshotRoster`, `drawSnapshotProjects`,
the device poll, and `compose-conversation.ts`'s `runClientEffect` each run
the client's effect to a promise over `FetchHttpClient.layer` right where the
work is needed, and are deleted once their own callback is a fiber instead.

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

`createLiveUpstream#attach` in `apps/web/server/voice/openai.ts` is on the
same allowlist: the hosted voice function's OpenAI upstream is plain callback code over `ws`'s
`WebSocket`, never an `Effect` composition, and P12-14 made `CallCredential`'s
`authorization` an Effect so `accountCall` never bridges a caller's own
`Promise` internally. The one credential this upstream ever holds is
`fixedBearer`'s, which answers `Effect.succeed` and nothing else, so
`Effect.runSync` here runs no asynchronous work and defers nothing past the
call that reads it; `Effect.runSync` stands in for the `await` this file held
before the credential became an Effect. It goes if this file's WebSocket
plumbing is ever rebuilt over `@effect/platform`'s `Socket`, which no PR in
this plan schedules.

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
service from a callback rather than from an effect. P7-14 found the reason
this document gave for that pending — the `Composer` promise face — was not
the one holding it up: `Composer` answers one scoped `lifetime` effect now,
and the `emit` callers are unchanged, because every one of them is a
synchronous callback a collaborator outside this host calls (the brain
wiring's `broadcastRequests` and conversation report, the live session's
`emit`, the node registry's `onChange`), and `closeAdmissions` is a step of
`GatewayShutdownSteps`, whose four members are promises the gateway's own
coordinator reads. Both go when those collaborators answer effects, which is
a change to `packages/brain`, `packages/voice`, and the shutdown contract
rather than to a composer. Beside them are
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
`apps/desktop/src/main/update-service.ts` are not on this allowlist any more,
and P8-08 is why: `update-service-host.ts`'s `createUpdateServiceHost` is now
an Effect built inside its own `Scope.Scope` requirement, composed into
`compose-desktop.ts`'s assembly (`Layer.scoped(DesktopTag, ...)` rather than
`Layer.effect`), so the timed check, the first check, and a publishing retry
each fork into the launch's own scope directly — `UpdateService`'s constructor
takes that scope as `options.scope` instead of making one of its own, and
`stop()` interrupts the two tracked fibers and the pending retry by hand
rather than closing anything, since the scope is not this class's to close.
Construction is not what starts it, though: the version mark `start()` spends
must not survive a standup that failed or was quit before reaching the
operator, exactly as before, so `createUpdateServiceHost`'s own `start()` is
called from a step of `launchSteps`'s `throughWindows` in the same position
the old `serviceLayer(updates, report)` held — after the operator's, before
the windows' — rather than from the assembly that built it. `update-service.test.ts`
still constructs the class with no scope, which is the one case it keeps
owning and closing one of its own, so every one of its assertions on
`start`/`stop` timing stands unchanged. The publishing retry still steps
`Schedule#step` directly rather than driving it through a `ScheduleDriver`,
for the same reason as before: the driver's own `next` sleeps out the delay
it returns where this needs the delay back, to arm a cancellable fiber a
fresh check can still collapse mid-wait.

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
are not on this allowlist any more: each is an effect over a `cadenceGate` the
cadence holds, so the registration's own beat and the poll after it are one
fiber that gate's scope interrupts. The interruption is forked rather than
awaited (`Fiber.interruptFork`), for the same reason cancelling a timer never
was: what a disarm has to guarantee is that no further beat starts, never that
a call already on the wire has answered, since it may be waiting on a token
refresh that is itself signing out — and the beat reads the generation the
disarm bumped, so one the interruption has not reached yet sends nothing. The
calendars composer's `startObservation` and `stopObservation` in
`packages/host/src/compose-calendars.ts` became `armObservation` and
`disarmObservation` over a gate of the same shape, so the held-notice release
and the Apple access poll are fibers in the scope an arming runs in and what
the disarm gives back is a finalizer registered before them. That file stays
on the allowlist for the two runs the gate does not reach: the
meeting-boundary wake, forked and interrupted from inside an observation pass
the loop still runs as a promise, and the Google consent trip its own method
handler runs on the runtime the layer was built on.

`compose-account.ts` is off the handed-runtime list since P12-14b: the three
`Runtime.runPromise` calls that ran the account gate's links for a session
manager awaiting promises are gone, because `AccountSessionManager` answers
effects itself now. The composer still captures `Effect.runtime<never>()`,
because P12-04d threads that runtime through `VoiceCapabilityAssembler` to
`BrainTransport` and `tracedModelAdapter`, each of which runs on it under its
own permanent row above; what this file no longer holds is a run of its own.
`startCapabilities` and `stopCapabilities` are the links' own effects behind
an `Effect.suspend`, which is what keeps a link read no earlier than the call
that needs it, and `onSignOut` is `releaseDevice` directly. The three account reads and
writes it lifted at that seam are lifted no longer: P12-14c took the store
itself onto effects, so each is the store's own, with `Effect.orDie` where the
rejected promise behind it was already a defect.

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

`AgentTraceWriter` in `packages/devtrace/src/trace-writer.ts` is on the same
terms: its callers are the host's composers, which still hold a plain object
with `record*` methods rather than a fiber, so each tapped line — the entry an
Effect `Logger` formats and the `FileSystem` write that carries it to disk —
is run on the writer's own `ManagedRuntime` here. It is deleted once the host
composer that holds it is a `Layer` able to hold that runtime itself, in
Phase 7's devtrace composer conversion.

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

`awaitedSettingsStore` in `packages/host/src/settings-store-awaited.ts` is
what took the store's place on the allowlist, and it is the store's own
methods as the promises their unmigrated callers still hold, run on the
runtime the host is composed on. The callers are the reason it exists rather
than the store: the calendars, observation, and live composers reach the
store from promise-shaped bodies of their own — the calendars composer's five
write handlers moved in P12-14d with `settingsWrite` and read it through
`Effect.promise` at each seam until P12-14e takes the rest of that file — the
settings composer's account-preferences and provider-key-vault chains are
promise queues,
`session-action-performer.ts` reads one field inside a promise, and
`@sidecar/voice`'s `VoiceSettings` is a promise-shaped interface the
capability assembler awaits — each its own conversion, and each one's landing
takes rows out of this face. It is deleted by P12-14d..g, when the last of
them yields the store directly.

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

`timedRequest` in `packages/credentials/src/account/client.ts` and
`LinearIssueTracker#post` in `packages/credentials/src/linear/tracker.ts` are
on the same allowlist: both build a request over the ambient `HttpClient` and
both still answer their callers — `AccountClient`, `deleteHostedAccount`, and
`LinearIssueTracker`'s `observe`/`execute` — a Promise rather than a fiber, so
each runs its request to a promise in place. `AccountClient`'s and
`deleteHostedAccount`'s own `httpClient` option is a `Layer` a test hands over
in place of `FetchHttpClient.layer` since P12-04 deleted the `CloudFetch`
seam it used to build that layer from. `timedRequest` goes in P12-04b, once it
answers a fiber instead of a promise; `LinearIssueTracker` is gone from the
tree entirely, with the Linear integration it served.

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

`GoogleCalendarReader`'s `#run` in `packages/calendar/src/reader.ts` and
`exchangeGoogleCode` in `packages/calendar/src/oauth.ts` are on the allowlist
too, reworked in P7-06 rather than deleted outright as this document once
planned: `packages/host/src/compose-calendars.ts` is built as an effect now
and hands both a `Runtime.Runtime<never>` — its own, obtained inside the
`Effect.gen` as `Effect.runtime<never>()` — through a `runtime` option each
reads exactly as `DeviceRegistration`'s does, so each runs its request effect
there instead of on the ambient default runtime. Full deletion did not follow,
because the premise this document stated for it was wrong on contact:
`compose-calendars.ts`'s own `GatewayMethodTable` handlers stayed promises
regardless of how the composer itself was built — the Gateway was not
Rpc-shaped until Phase 6's server work reached this host — so a bridge from a
promise-returning method to the reader's own request effect was still
necessary, just onto a real runtime instead of a default one. Those methods
answer effects since P7-13, and both doors go in P7-13b, which takes each
handler onto the reader's own request effect.

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
`liveVoiceBridgeLayer` was deleted rather than adopted. Beside it,
`ReattachingSocket`'s recovery in `packages/voice/src/live-session-source.ts`
is on the allowlist too, and for its own reason rather than a caller's: the
socket it wraps is a plain, synchronous `LiveSocket`, so the tries themselves
are a fiber this class forks and interrupts on its own, with no promise
anywhere above it waiting to be freed of one. It goes when the socket it
wraps answers effects itself; the orchestrator's conversion above did not
reach it, since the two share only a package.

`fiberStoreRunner` in `apps/web/server/hosted/fiber-runner.ts` is the one
place `apps/web` turns an effect into a promise anywhere but at `runWeb`, and
it is on the allowlist as the fiber's own face rather than as a runtime: it
reads `Effect.runtime` inside the effect and hands back that runtime's
`Runtime.runPromise`, so the connection everything below it reads on is the
request's own and a test needs no seam for it. P10-16 deleted `HostedStoreRun`
and `BrainHostSeams.run`, the type and field this replaced: since that PR the
hosted store, the store writer, the voice writer, the speech module, the ask
record, the device seams, the brain host, and every route handler under
`apps/web/server` answer `Effect<A, SqlError | ParseError, SqlClient>` end to
end, and a handler composes its whole request into the one effect `runWeb`
answers.

What still takes a promise face are four contracts this package does not own.
eve's tool contracts — `BrainWorkspaceAccess`, `HostedFactsWriter`,
`HostedTranscriptReads` — are promises because a tool execution is one, so
`brainHost`'s `runTool` reads the runner from its own fiber and builds the
three readers over it. eve's stream handler, and the `StreamRelay` and
`carryStop` beneath it, answer eve a promise, so `brainHost`'s `relay` builds
them over the same runner through the `Promised` mapped type beside it. The
turn event stream's polling body runs inside the `ReadableStream` its handler
has already answered with, so it outlives that handler's fiber and reads the
runner before it answers. And the voice service drives
`hostedLiveExchange`, `hostedLiveBrain`, `hostedBriefings`,
`hostedLiveRecord`, and `voiceSessionRecord` from socket callbacks rather than
from a request, so those five are handed `runWeb` by the function that
composes them rather than reading a fiber they have none of. The type goes
when those four contracts answer effects themselves; no PR in this plan is
that one yet.

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

`createRateBrake` in `apps/web/server/hosted/rate-brake.ts` is on the allowlist
for the same reason `fiberStoreRunner` is: `RateBrake.check` is an
`Effect.Effect<boolean>` a per-user window reads through the ambient `Clock`,
but a route that still holds a plain boolean it awaits cannot compose one, so
`createRateBrake` runs that check to a promise here rather than on a fiber of
its own. Effect's own `RateLimiter` was tried first and dropped: its only
way to ask whether a permit is free without waiting for one is racing its
blocking `take` against a zero-duration timeout, and that race lost to a busy
event loop in this repository's own test suite, refusing a request nothing had
actually rate-limited. P10-16 moved every route it converted onto
`RateBrake.check` directly; the door goes with the last hosted route that still
answers a promise (`conversation-read.ts`, `events.ts`, `devices-vault-app.ts`).

`carryOn` in `packages/brain/src/effect/carry.ts` is the brain's one door onto
the host's `ExecutionRuntime`, and P12-02 made it the only one for
`BrainAgent`'s own surface. `runtimeExit`, the dispatch between a
`ManagedRuntime` and a plain `Runtime` `carryOn` is built over, is exported
beside it since P12-04d for the two narrower callers that still need their
own exit-handling on top of it rather than `Carry`'s own throw-on-failure
shape: `BrainTransport#send`'s `runCall` and `tracedModelAdapter`'s traced
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

What keeps this one door is what the brain is still asked for in promises:
`BrainAgent`'s own public surface — an ask, a wake, a child's task, a stop —
and the `ToolExecutor` seam the tool loop dispatches through, which is why
the read tool's whole-transcript read and the housekeeping turn the memory
provider's `capture` seam asks for are carried here too. A defect is squashed
back to the error that caused it, so a store, a listener, or an engine that
threw reaches the caller as the error it threw rather than as the fiber
failure that carried it. P12-04 deletes it with those seams.

What the door does not carry is the other three seams. `ModelAdapter`,
`ContextEngine`, and `ToolExecutor` stay as the host hands them in, because
each is owned above the runtime by identity rather than by shape: the host
marks, rolls back, and checkpoints the very engine `openContext` answered and
compares it by reference, and it folds the context through the same adapter
inside `compaction.ts`, which is an OpenClaw port and so imports nothing from
`effect`. An Effect-shaped counterpart for any of the three would therefore
need a promise view built back out of it inside the brain, which is the same
run in another file rather than one less — so `ModelAdapter` stays
Promise-shaped permanently, like the other two, and the two shims that stand
on it — `BrainTransport#send`'s `runCall` and `tracedModelAdapter`'s traced
`respond` — are permanent rows for the same reason, named below.

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
and an effect here could only ever be run. The fourth, the run event
subscriber, is on the allowlist for the reason below rather than exempt from
one.

`BrainAgent#onRunEvent` in `packages/brain/src/agent.ts` is on the allowlist:
its callers still hold a plain callback and an unsubscribe function rather
than a `Stream`, so each subscription forks its own fiber pumping
`Stream.fromPubSub` at `Effect.runFork` and answers an unsubscribe that
interrupts it at another. Every rule a listener could observe under the old
`Emitter` still holds — subscription order, a listener subscribed mid-round
hearing only what follows, a thrower stopping none of the rest — because the
pump is the same `Stream.runForEach` either way; what changed is that the
fiber belongs to the subscription rather than to a scope the agent owned, so
`stop()` closes no scope of its own for this any more. The bridge this
replaced — `eventFromStream` and the scope built at construction to hold it —
is deleted with `packages/wire/src/effect/event.ts` itself, and this entry
stands until a subscriber reads the stream directly.

The coalescing timer the wake queue arms is untouched by that, since it is
still the injected `schedule`/`cancel` seam a real elapsed-time wait stands
behind rather than anything the queue runs.

`cloudPass` in `packages/providers/src/shared/cloud-pass.ts` no longer needs an
allowlist entry: its reads and its one write are effects over the ambient
`HttpClient` — `FetchHttpClient.layer`, or a test's own `httpClient` layer,
since P12-04c deleted the `CloudFetch` seam this pass used to build one from
— the 429 cadence is a `Schedule` stepped on the fiber's clock, and `run`,
`write`, and `credentialBoundRead` are
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
dispose. That synchronous shape is exactly what the storage rule requires, so
this row is re-pointed at P12-15 with no expectation it becomes an
`Effect.runPromise*` shim at all — deleting it would mean giving the fence
back the latency it exists to avoid. `state-store.ts` keeps its own compare-and-set against the envelope
it last observed standing, because it is ported from OpenClaw `b7528507` and
imports nothing from `effect`; its Effect surface stays in
`state-store.effect.ts`. What P12-02 took out of this file is the open: the
context the runtime answers is an effect now, carried to the promise the
generation holds by the agent's own door rather than run here. The close
stays, because the fence has to: the store announces a replacement in a
synchronous callback, and the dead generation must stand nowhere before the
caller's next statement. It goes in P12-04, with the surface that makes that
callback a promise one.

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

The four hosted clients this document had not named until the lint rules made
the list machine-readable — `HostedActionClient`'s `#run` in
`packages/hosted/src/action-client.ts`, `DeviceClient`'s `#ask` in
`device-client.ts`, `SessionMessagesClient`'s `#run` in
`session-messages-client.ts`, and `VaultClient`'s `#run` in `vault-client.ts` —
stand on exactly the terms `changes-client.ts`, `roster-client.ts`, and
`conversation-client.ts` do: each holds `accountCall` directly, none of its
public methods takes a caller's own `AbortSignal`, and each runs its request
effect over its own `httpClient` layer (a test's fake, or
`FetchHttpClient.layer` for the ambient one — P12-04 deleted the `CloudFetch`
seam these four used to build that layer from) to the Promise those methods
answer. They go in P12-04b with the seam. `feedbackCourier` in
`packages/feedback/src/delivery.ts` is the same shape one package over: the
courier its callers hold answers a Promise, so the delivery effect is run over
the caller's own `httpClient` layer or `FetchHttpClient.layer` right there —
P12-04 deleted the `CloudFetch` seam this door used to build that layer from
too — and it goes in P12-04b once its own caller runs the effect on its own
runtime edge instead.

`runTest` in `packages/wire/src/testing/effect.ts` is the test harness's own
door on the same terms: a suite still written on `node:assert` outside
`it.effect` holds a `Promise`, so the effect is run to one here, over the layer
the caller supplied or none. It goes when the last such suite is an
`it.effect`; no PR in this plan is that one yet.

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
list was drawn: the read prefetch's slot is cancelled through the
`AbortSignal` seams its collaborators still take — `ModelAdapter#respond`, a
tool module's `ToolExecutionContext`, the turn's own signal — so it holds a
controller per slot and one for the reads, on the same terms as `turn.ts` and
`runtime.ts` beside it, and goes with them in P12-02 when those seams become
a fiber's own interruption.
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
| `admit()` Promise door over `admitEffect()` | P4-01 | P12-15 — blocked on the `ToolExecutor` seam answering an effect; P12-04 turned out to be the CloudFetch/HttpClient family alone |
| `BrainTransport#send`'s internal `runCall`, over `runtimeExit(execution)` since P12-04d | P5-05 | never — permanent alongside `tracedModelAdapter`, `compaction.ts`'s `ModelAdapter` stays a promise |
| `createAccountCall` Promise door over `accountCall` | P3-06 | P12-04b |
| `HostedChangesClient`/`HostedRosterClient`/`HostedConversationClient`'s `#run` | P3-06c | P12-04b |
| `@sidecar/host`'s `snapshot-roster.ts`, `compose-devices.ts`, and `compose-conversation.ts`'s `runClientEffect`, over the three clients above | P12-04b | pending — once `ObservationLoop`'s `run`, `deviceCadence`'s beat, and the Conversation poll's pager are each a fiber |
| `ProductEventSender`'s `start`/`stop`/`flush` over its own runtime | P4-08 | P7-03 |
| `providerRegistrations` record door over `providersLayer` | P6-09 | P7-05 |
| `ServerBoundTransport#run`, the in-process transports' runs on the host's runtime | P6-13 | P12-09 |
| `createGatewayService`'s `emit`/`closeAdmissions` on the host's runtime | P6-13 | pending — P7-14 established that the blocker is the synchronous collaborator callbacks that report a change and the promise steps of `GatewayShutdownSteps`, not the `Composer` face it deleted |
| `gatewayTestHost`/`scopedGatewayService`, the suites' own scoped builds | P6-13 | P12-09 |
| `shutdownGateway`, the promise door over `shutdownGatewayEffect` | P6-04 | P7-10 |
| `retryAttachWhileDetached`, the promise door over `retryAttachWhileDetachedEffect` | P6-04 | none yet — no caller can genuinely detach |
| `runAdapterRead`, every adapter's Promise face over its read effects | P6-11a | not yet — every caller stays inside `packages/providers`; P7-05 confirmed the host never called one directly |
| `AgentTraceWriter`'s own `ManagedRuntime` | P6-05 | Phase 7 devtrace composer |
| `tracedModelAdapter`'s traced `respond`, over the same `runtimeExit(execution)` since P12-04d | P6-05 | never — permanent alongside `BrainTransport#send`'s `runCall`, for the same reason |
| `timedRequest` (`credentials/account/client.ts`) | P4-03 | P12-04b |
| `LinearIssueTracker#post` | P4-03 | gone with the Linear integration itself |
| `timedRequest` (`credentials/linear/oauth.ts`) | P4-04 | gone with the Linear integration itself |
| `GoogleCalendarReader#run` / `exchangeGoogleCode`'s internal run, now over a handed-in `Runtime` | P4-05 | P7-13c — the calendars composer's methods answer effects since P7-13 |
| `timerSeamFromRuntime` (`packages/brain/src/effect/harness.ts`) | P12-03 | once `BrainAgent` answers `Clock`/`Scope` directly |
| `ReattachingSocket`'s recovery fiber over its own runtime | P6-07 | once the plain `LiveSocket` it wraps answers effects itself |
| `LiveSessionSourceTag`/`IntroductionSessionSourceTag` over their plain source objects | P6-08 | pending — every caller today (`compose-live.ts`'s `account.voiceCapabilities.liveSessions`, the renderer's orchestrator, the desktop main's introduction flow) reads its source as a getter whose answer changes over the run; a static `Layer.succeed` cannot stand in for that, so nothing adopts the tag yet |
| `LiveBrainTag`/`LiveRecordTag` over their plain collaborator objects | P6-08 | pending — P7-07 is the first real caller (`compose-host.ts` builds the plain `LiveBrain`/`LiveRecord` and hands them to `compose-live.ts` through these tags), but `LiveSessionService`'s own constructor still takes them as plain fields, so the adaptor stands until that class reads the tags itself, a `packages/voice` change beyond a host composer |
| `carryOn`, the brain's one promise door onto the host's `ExecutionRuntime` | P12-02 | P12-04 |
| `BrainAgent#onRunEvent`'s per-subscription fiber over `Stream.fromPubSub` | P5-06 | once a subscriber reads the stream directly |
| `StoreDatabase`'s synchronous `prepare`/`exec`/`transaction` beside its `sql` layer | P5-08 | with `StoreDatabase#run` |
| `StoreDatabase#run` and `#close`, the OpenClaw ports' handle over the store's own `SqlClient` | P5-10a | a synchronous accessor for `archives.ts` and `maintenance-run.ts`; unscheduled |
| The conversation, directory, transcript, envelope, and archive registry tables' synchronous doors the ports call | P5-10a..d | with `StoreDatabase#run` |
| `storeClient`'s Promise face over the store's Rpc client, on the runtime the host hands it | P5-11 | never — the ports' reach: `BrainStateRepository` and `ChildStore` are read by OpenClaw ports that may not import `effect` |
| `FiberStoreRunner`/`fiberStoreRunner`, the promise face the four promise-shaped contracts above `apps/web`'s effects are handed (it replaced `HostedStoreRun` and `BrainHostSeams.run`, which P10-16 deleted) | P10-16 | once eve's tool and stream contracts, the turn event stream, and the voice service's socket-driven compositions answer effects themselves |
| `createRateBrake`, the hosted rate brake's promise door over `RateBrake.check` | P10-12 | with the last promise-shaped hosted route (`conversation-read.ts`, `events.ts`, `devices-vault-app.ts`); P10-16 moved every route it converted onto `RateBrake.check` |
| `retireGeneration`'s `Scope.close` over `Effect.runSync` | P5-04 | P12-15 — the fence must stay synchronous, so this is bookkeeping rather than a scheduled deletion |
| `compose-account.ts`'s runs of the account gate's links on the host's own runtime | P7-13b | P12-14b |
| `awaitedSettingsStore`, the settings store's own methods as the promises their unmigrated callers hold | P12-14c | P12-14d..g — the calendars, observation, and live composers, the settings composer's promise chains, the session action performer, and `@sidecar/voice`'s `VoiceSettings` |
| `AppStateStore`'s `subscribe`, the Set-backed callback face beside `snapshot`/`update`/`touch` | P8-02 | P8-07 |
| `LinearCredentials`'s renewal, running `singleFlightEffect` over a handed-in `Runtime` | P7-06 | once `LinearCredentials` answers an Effect itself |
| `AgentSeamTag` / `agentSeamLayer(seam)` over the plain `AgentSeam` object | P5-07 | P7-08b |
| Legacy gateway envelope via a custom `RpcSerialization` | P6-01 | never — the protocol is the contract |

The three permanent entries are not unfinished work. A `GATEWAY_ERROR` code
and the envelope shape in `packages/gateway/src/protocol.ts` are what a client
speaks, and a client is not upgraded by this repository's merge queue; the
goldens in `packages/gateway/fixtures/protocol` are what keeps both
byte-stable. The third is `storeClient`'s face, above: the promises it answers
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
