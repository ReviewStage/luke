import type { SqlClient } from "@effect/sql";
import { Effect, Runtime } from "effect";

/**
 * The promise face an effect is run to for a collaborator that answers a
 * promise and cannot yet answer an effect. It is not the store's own runner:
 * since P10-16 the hosted store, its writers, the ask record, the brain
 * host, and every route handler hold effects end to end, and what is left
 * taking this are the promise-shaped contracts above them.
 *
 * There are four, and each is a contract this package does not own. eve's
 * tool contracts (`BrainWorkspaceAccess`, `HostedFactsWriter`,
 * `HostedTranscriptReads`) are promises because a tool execution is one.
 * eve's stream handler, and the relay and stop carrier beneath it, answer
 * eve a promise. The turn event stream's polling body runs inside the
 * `ReadableStream` its handler has already answered with, so it outlives
 * that handler's own fiber. And the voice service drives its collaborators
 * from socket callbacks rather than from a request.
 *
 * The first three read it from the running fiber through
 * {@link fiberStoreRunner} below, so the connection they read on is the
 * request's own and a test needs no seam for it. The voice service's
 * compositions have no request to read from and are handed `runWeb` by the
 * function that composes them.
 *
 * @deprecated A strangler shim. It goes once those four contracts answer
 * effects themselves; no PR in this plan is that one yet.
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
 * @deprecated A strangler shim, with `FiberStoreRunner` above.
 */
export type Promised<Methods> = {
  [Name in keyof Methods]: Methods[Name] extends (
    ...args: infer Args
  ) => Effect.Effect<infer Value, infer _Failure, infer _Services>
    ? (...args: Args) => Promise<Value>
    : never;
};
