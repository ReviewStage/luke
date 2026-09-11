/**
 * The desktop's fold in Effect's own terms. `compaction.ts` carries no
 * OpenClaw attribution in its own words but stands in the ported list beside
 * `context-engine.ts`'s recent-tail cut, and imports nothing from `effect`,
 * so its Effect surface lives here: `compactContext`'s outcome restated as a
 * success or a typed refusal carrying the reason the port already writes,
 * so a caller composing a fold reads a reason it can report rather than a
 * discriminated union it must narrow by hand.
 */

import type { ContextEngine, ModelAdapter, RuntimeCompaction } from "@sidecar/runtime/vocabulary";
import { Data, Effect } from "effect";
import { type CompactionRequest, compactContext } from "./compaction.js";

/** Why a fold did not happen, carrying the reason the port already decided. */
export class CompactionDeclined extends Data.TaggedError("CompactionDeclined")<{
  readonly reason: string;
}> {}

type FoldedCompaction = Extract<RuntimeCompaction, { compacted: true }>;

/** Folds the context, or fails with the reason the port already writes when nothing folded. */
export const compactContextEffect = (
  context: ContextEngine,
  model: ModelAdapter,
  request: CompactionRequest,
): Effect.Effect<FoldedCompaction, CompactionDeclined> =>
  Effect.promise(() => compactContext(context, model, request)).pipe(
    Effect.flatMap((outcome) =>
      outcome.compacted
        ? Effect.succeed(outcome)
        : Effect.fail(new CompactionDeclined({ reason: outcome.reason })),
    ),
  );
