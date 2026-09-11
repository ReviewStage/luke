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
rather than `JSONSchema.make`, because those bytes are prompt-cache bytes and
their goldens are compared as bytes. And every file ported from OpenClaw keeps
its internals faithful to the pinned source and imports nothing from `effect`;
the Effect wrap is a sibling module.

## Version line

`effect` is pinned at `3.22.2`, the newest 3.x release, through the pnpm
catalog in `pnpm-workspace.yaml` and nowhere else. Every workspace that reaches
it declares `"effect": "catalog:"`, so one version resolves across the
repository, which is what keeps a `Context.Tag` minted in one package the same
service in another; `repository-checks.sh` refuses a literal version. Today
that is `@sidecar/wire`'s development dependency alone, for the spike test at
`packages/wire/src/effect-spike.test.ts`, which exercises `Schema.Struct`
decoding, `Effect.gen`, `Layer`, and `Context.Tag` under the repository's own
test runner.

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
several packages. It is not enabled here; whether to enable it and fix the
errors, or to have every Effect Schema spell `Schema.optionalWith(..., { exact:
true })` instead, is decided by the migration's follow-up PR on this count.

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
  voice window must not be able to reach it.

`Effect.runPromise`, `Effect.runSync`, and `Effect.runFork` belong nowhere
else: a runtime built where the work lives is a second runtime, and two
runtimes are two copies of every service a `Context.Tag` was supposed to
identify. Everything between the edges returns an Effect and lets its caller
decide. The migration enforces this by review until the lint rule
`no-run-promise-outside-edges` lands, after which the edges above are its
allowlist.

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
| `Settled` Promise signatures | P5-01 | P12-02 |
| `Layer.succeed(oldObject)` / `createHostKernel(options)` | P7-01 | P12-05 |
| Legacy gateway envelope via a custom `RpcSerialization` | P6-01 | never — the protocol is the contract |

The two permanent entries are not unfinished work. A `GATEWAY_ERROR` code and
the envelope shape in `packages/gateway/src/protocol.ts` are what a client
speaks, and a client is not upgraded by this repository's merge queue; the
goldens in `packages/gateway/fixtures/protocol` are what keeps both byte-stable.
