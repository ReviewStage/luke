import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import type { WebStoreRun } from "../runtime.js";

/**
 * The request's own connection as a promise-shaped seam still takes it:
 * `hostedFactsWriter`, `hostedTranscriptReads`, and the roster reader
 * `brainHost`'s `runTool` builds answer a promise, not an effect, so an
 * effect reading a row on the request's connection is run here rather than
 * handed back. `BrainWorkspaceAccess` needs none of this — it answers
 * `Effect<A, never, never>` since P12-16b, so `runTool` provides its
 * `SqlClient` and dies on its error in place, with nothing run. `relay` needs
 * none of it either: P12-18c took `StreamRelay` and `carryStop` onto effects,
 * so the relay composes into the effect `relay` already answers, and with them
 * went the `Promised` mapped type this file used to declare.
 *
 * The voice service's compositions take it on the same terms: `LiveRecord`'s
 * two utterance writes and `LiveBrain`'s submission are promises
 * `@sidecar/voice` declares, so `hostedLiveRecord` and `hostedLiveBrain` read
 * `SqlClient` once where the socket's scope builds them and run those
 * promises here. Nothing else of either is a promise: the record's writes,
 * each ask's follow, and the briefing look are fibers of that scope.
 *
 * @deprecated A strangler shim. It goes with the promise-shaped callers that
 * still call it — `hostedFactsWriter`, `hostedTranscriptReads`, and the roster
 * reader — in P12-18g, which needs the brain's own tool contracts to answer
 * effects first, and with the voice compositions' two when `@sidecar/voice`'s
 * `LiveRecord` and `LiveBrain` answer effects, which no PR in this plan
 * schedules.
 */
export function runOverClient(client: SqlClient.SqlClient): WebStoreRun {
  return (effect) =>
    Effect.runPromise(Effect.orDie(Effect.provideService(effect, SqlClient.SqlClient, client)));
}
