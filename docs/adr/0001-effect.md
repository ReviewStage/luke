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
which peers `^3.22.2`.

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

- `apps/desktop/src/main/main.ts`, one `ManagedRuntime` the quit disposes.
- each `apps/web/api/**` function module, through the module-scope memoized
  runtime `apps/web/server/runtime.ts` holds, so a warm instance reuses it and
  a cold start builds it once. The hosted voice service is one of these: it
  runs inside the two `api/voice` functions rather than as a process of its
  own, so it takes that edge and needs none.
- the two renderer roots, `apps/desktop/src/renderer/index.tsx` and
  `apps/desktop/src/renderer/voice/index.tsx`, one browser `ManagedRuntime`
  each — two roots because the panel is the one surface that records, and the
  voice window must not be able to reach it. The runtime each holds is the one
  `apps/desktop/src/renderer/renderer-runtime.ts` builds: the module is
  instantiated once per bundle, so the panel and the voice window each get
  their own registry and their own runtime under it, and an atom's work runs
  on the runtime of the window that mounted it.

`Effect.runPromise`, `Effect.runSync`, and `Effect.runFork` belong nowhere
else: a runtime built where the work lives is a second runtime, and two
runtimes are two copies of every service a `Context.Tag` was supposed to
identify. Everything between the edges returns an Effect and lets its caller
decide. The migration enforces this by review until the lint rule
`no-run-promise-outside-edges` lands, after which the edges above are its
allowlist.

Eleven strangler shims are on that allowlist for as long as they live.
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
finds the loop disarmed; P7-10 deletes both once every composer that arms a
loop is a `Layer` and the scope is the host's own.

`admit()` in `packages/actions/src/admit.ts` is the fourth: the gauntlet is
`admitEffect()`, an Effect failing with an `AdmitRefusal`, and `admit()` runs it
to the `Promise<ValidatedAction | Refusal>` its callers still hold, answering
the refusal as the `Refusal` the action journal records and rethrowing a roster
read's own failure. It goes in P12-02 with the `Settled` Promise signatures,
once P5-14's turn runner and P7's composers call `admitEffect()` in runs of
their own.

`BrainTransport#send`'s internal `runCall` in `packages/brain/src/client.ts`
is the fifth: every caller of the brain's model transport still holds a
promise, not a fiber, so the request effect built over `@sidecar/hosted`'s
`accountCall` is run to a promise there, joining the caller's own
`AbortSignal` to the run exactly as `createAccountCall` does. P5-14 moves a
turn onto the brain's own runtime, at which point this request runs on it
instead and `runCall` goes with it.

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

`providerRegistrations` in `packages/providers/src/registrations.ts` is the
ninth: the registry is `providersLayer`, one layer per registration merged so
a repeated provider id fails the build, and the composers that hold it are
still promises reading a record, so the layers are built and the `Providers`
service read there. Every registration is synchronous, so the run is a
`runSync` over a scope that closes at once, holding nothing; P7-01 and P7-02
hand the layer to the host itself and delete the door.

`AgentTraceWriter` in `packages/devtrace/src/trace-writer.ts` is the tenth:
its callers are the host's composers, which still hold a plain object with
`record*` methods rather than a fiber, so each tapped line — the entry an
Effect `Logger` formats and the `FileSystem` write that carries it to disk —
is run on the writer's own `ManagedRuntime` here. It is deleted once the host
composer that holds it is a `Layer` able to hold that runtime itself, in
Phase 7's devtrace composer conversion.

`tracedModelAdapter` in `packages/devtrace/src/brain-trace.ts` is the
eleventh, on the same terms as `runCall`: the traced `respond` still answers
the `ModelAdapter` interface's promise, so the `Effect.withSpan` wrapping the
wrapped adapter's call is run to that promise here. It goes together with
`BrainTransport#send`'s `runCall` in P5-14.

## Strangler shims and their deletions

Old and new coexist behind a named shim rather than in a long-lived branch, so
main stays green and each package migrates on its own schedule. Every shim is
introduced by one PR and deleted by another, and a shim with no deletion is a
design decision stated as such:

| Shim | Introduced | Deleted |
| --- | --- | --- |
| `s.*` facade over Effect Schema | P1-02 | P12-08 |
| `toSchemaRead(either)` | P1-01 | P12-07 |
| TaggedErrors carry legacy `code` strings on wire | P3-04 onward | never — the wire is the compatibility surface |
| `disposableFromScope`/`addDisposable` | P1-05 | P12-06 |
| `streamFromEvent`/`eventFromStream` | P1-06 | P12-06 |
| `cloudFetchFromHttpClient` | P1-07 | P12-04 |
| `timersFromRuntime` | P2-01 | P12-03 |
| `ObservationLoop`'s `start`/`stop` over its own `Scope` | P2-04 | P7-10 |
| `admit()` Promise door over `admitEffect()` | P4-01 | P12-02 |
| `BrainTransport#send`'s internal `runCall` | P5-05 | P5-14 |
| `createAccountCall` Promise door over `accountCall` | P3-06 | P12-04 |
| `HostedChangesClient`/`HostedRosterClient`/`HostedConversationClient`'s `#run` | P3-06c | P12-04 |
| `ProductEventSender`'s `start`/`stop`/`flush` over its own runtime | P4-08 | P7-03 |
| `providerRegistrations` record door over `providersLayer` | P6-09 | P7-01, P7-02 |
| `AgentTraceWriter`'s own `ManagedRuntime` | P6-05 | Phase 7 devtrace composer |
| `tracedModelAdapter`'s traced `respond` | P6-05 | P5-14 |
| `Settled` Promise signatures | P5-01 | P12-02 |
| `StoreDatabase`'s synchronous `prepare`/`exec`/`transaction` beside its `sql` layer | P5-08 | P5-10a..d |
| `Layer.succeed(oldObject)` / `createHostKernel(options)` | P7-01 | P12-05 |
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
