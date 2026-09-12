import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import type { WebStoreRun } from "../runtime.js";

/**
 * An effect-shaped collaborator as a promise-shaped caller takes it, for a
 * collaborator that answers a promise and cannot answer an effect.
 *
 * There is one place left, and it is the brain host's own: `brainHost`'s
 * `relay` builds the `StreamRelay` and the stop carrier over it, since
 * `StreamRelay` and `carryStop` are this package's own async class beneath a
 * `relay` that already answers an effect.
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

/**
 * The request's own connection as a promise-shaped seam still takes it:
 * `hostedFactsWriter`, `hostedTranscriptReads`, and the roster reader
 * `brainHost`'s `runTool` builds answer a promise, not an effect, so an
 * effect reading a row on the request's connection is run here rather than
 * handed back. `BrainWorkspaceAccess` needs none of this — it answers
 * `Effect<A, never, never>` since P12-16b, so `runTool` provides its
 * `SqlClient` and dies on its error in place, with nothing run.
 *
 * @deprecated A strangler shim. It goes with the promise-shaped callers that
 * still call it: `hostedFactsWriter`, `hostedTranscriptReads`, `relay`'s
 * `StreamRelay`, and its stop carrier, in P12-18c.
 */
export function runOverClient(client: SqlClient.SqlClient): WebStoreRun {
  return (effect) =>
    Effect.runPromise(Effect.orDie(Effect.provideService(effect, SqlClient.SqlClient, client)));
}
