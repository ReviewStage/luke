import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import type { WebStoreRun } from "../runtime.js";

/**
 * The voice service's two compositions are what is left taking the request's
 * own connection as a promise-shaped seam: `LiveRecord`'s two utterance
 * writes and `LiveBrain`'s submission are promises `@sidecar/voice` declares,
 * so `hostedLiveRecord` and `hostedLiveBrain` read `SqlClient` once where the
 * socket's scope builds them and run those promises here. Nothing else of
 * either is a promise: the record's writes, each ask's follow, and the
 * briefing look are fibers of that scope.
 *
 * The brain host takes none of it. `runTool`'s seams carry no requirement in
 * the brain's own contracts, but that was a requirement rather than a
 * promise: P12-18e read `SqlClient` off the request once and
 * `Effect.provideService`-d it to the workspace access, and P12-18g did the
 * same for the last three — `hostedFactsWriter`, `hostedTranscriptReads`, and
 * the roster reader — once those three answered effects themselves. `relay`
 * needs none of it either: P12-18c took `StreamRelay` and `carryStop` onto
 * effects, and with them went the `Promised` mapped type this file used to
 * declare.
 *
 * @deprecated A strangler shim. It goes with the voice compositions when
 * `@sidecar/voice`'s `LiveRecord` and `LiveBrain` answer effects, which no PR
 * in this plan schedules.
 */
export function runOverClient(client: SqlClient.SqlClient): WebStoreRun {
  return (effect) =>
    Effect.runPromise(Effect.orDie(Effect.provideService(effect, SqlClient.SqlClient, client)));
}
