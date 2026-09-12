import type { SqlClient } from "@effect/sql";
import { Effect, Runtime } from "effect";

/**
 * The promise face an effect is run to for a collaborator that answers a
 * promise and cannot answer an effect. It is not the store's own runner:
 * since P10-16 the hosted store, its writers, the ask record, the brain
 * host, and every route handler hold effects end to end, and what is left
 * taking this are the promise-shaped contracts above them.
 *
 * There is one place left, and it is the brain host's own: `brainHost`'s
 * `runTool` builds `BrainWorkspaceAccess`, `HostedFactsWriter`,
 * `HostedTranscriptReads`, and the roster and defaults readers over this
 * runner, and its `relay` builds the `StreamRelay` and the stop carrier over
 * it through {@link Promised} below. Each reads it from the running fiber
 * through {@link fiberStoreRunner}, so the connection they read on is the
 * request's own and a test needs no seam for it.
 *
 * Neither of its two reasons is eve's authorship. `runTool`'s seams take it
 * because the brain's tool contracts carry no requirement:
 * `BrainWorkspaceAccess` answers `Effect<A, never, never>` and so does
 * `read-tools.ts`'s `readTranscript`, so a seam reading a row on the
 * request's connection has nowhere in those types to say `SqlClient`.
 * Reading the client off the request's fiber and providing it to each seam
 * says the same thing without running anything, which is what deletes this;
 * `relay`'s seams take it because `StreamRelay` and `carryStop` are this
 * package's own async class beneath a `relay` that already answers an effect.
 *
 * A composition driven by something other than a request — the voice
 * service's sockets, a stream's reader — has no fiber to read and is handed
 * the edge's runner instead; that runner is `WebStoreRun` in
 * `server/runtime.ts`, and this type is not it.
 *
 * @deprecated A strangler shim. It goes when both of those reasons do:
 * P12-18e gives `runTool`'s seams the request's `SqlClient` through
 * `Effect.provideService` instead of a runner, and P12-18c takes `relay`'s
 * `StreamRelay` and `carryStop` onto effects.
 */
export type FiberStoreRunner = <A, E>(
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
) => Promise<A>;

/** The runner above, read from the running fiber's own runtime. */
export const fiberStoreRunner: Effect.Effect<FiberStoreRunner, never, SqlClient.SqlClient> =
  Effect.map(Effect.runtime<SqlClient.SqlClient>(), (runtime) => Runtime.runPromise(runtime));

/**
 * An effect-shaped collaborator as a promise-shaped caller takes it, for the
 * seams the callers above declare.
 *
 * @deprecated A strangler shim. It goes with the promise-shaped callers that
 * declare those seams: `StreamRelay` and `carryStop` in P12-18c, and the
 * suites that predate `it.effect` as they are rewritten onto it.
 */
export type Promised<Methods> = {
  [Name in keyof Methods]: Methods[Name] extends (
    ...args: infer Args
  ) => Effect.Effect<infer Value, infer _Failure, infer _Services>
    ? (...args: Args) => Promise<Value>
    : never;
};
