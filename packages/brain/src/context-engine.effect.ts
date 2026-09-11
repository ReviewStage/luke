/**
 * The Responses context engine's failing surface in Effect's own terms.
 * `context-engine.ts` is a port of OpenClaw `b7528507`'s recent-tail cut and
 * imports nothing from `effect`, so its Effect surface lives here: `bootstrap`
 * restated as a success carrying how many dangling calls it repaired, or a
 * typed refusal carrying the reason the port already writes when a checkpoint
 * of another stamp is not readable.
 */
import type { RuntimeCheckpoint } from "@sidecar/runtime/vocabulary";
import type { UnknownActionResult } from "@sidecar/wire";
import { Data, Effect } from "effect";
import type { ResponsesContextEngine } from "./context-engine.js";

/** A checkpoint of a stamp this engine cannot read, carrying the reason the port already writes. */
export class CheckpointRefused extends Data.TaggedError("CheckpointRefused")<{
  readonly reason: string;
}> {}

/** Loads a checkpoint, or fails naming why it was not readable; the engine stays empty either way. */
export const bootstrapEffect = (
  engine: ResponsesContextEngine,
  checkpoint: RuntimeCheckpoint | undefined,
  lostResult: UnknownActionResult,
): Effect.Effect<{ readonly repaired: number }, CheckpointRefused> =>
  Effect.suspend(() => {
    const outcome = engine.bootstrap(checkpoint, lostResult);
    return outcome.loaded
      ? Effect.succeed({ repaired: outcome.repaired })
      : Effect.fail(new CheckpointRefused({ reason: outcome.reason ?? "unreadable checkpoint" }));
  });
