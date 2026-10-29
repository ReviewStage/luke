/**
 * agent-state-sweep.ts -- the scheduled sweep's delete of the device agents' saved state no launch will restore again: each bundle from the store, then its record.
 *
 * A generation stands until the sweep takes it
 * (`@luke/database/models/agent-state-store`'s `sweepableAgentStates`):
 * one superseded by a newer generation of its agent, whose blob its commit
 * deleted already unless that failed; every one of an agent whose
 * transcript is gone, purged seven days after the agent or its task was
 * deleted, or at once with its account; and every one committed seven days
 * ago or more, the newest included, archived or not, as a cloud agent's
 * snapshot goes seven days after its last use. Each minute it takes at most `BATCH`, the longest
 * saved first, deletes their blobs in one call, and only then their rows,
 * since a row is the one record of the blob it names: a delete the store
 * refused leaves every row for the next minute, and a blob already gone
 * counts as deleted. A deployment without a store passes over state, since
 * it could have kept none. What is logged is counts alone.
 */

import type { DatabaseServices, StoreFailure } from "@luke/database/core/query";
import { deleteAgentStates, sweepableAgentStates } from "@luke/database/models/agent-state-store";
import { Effect } from "effect";
import { AgentStateBlobs, type AgentStateBlobsUnavailable } from "../agents/agent-state-blobs.js";

const AGENT_STATE_SWEEP = {
  /** The most generations one sweep deletes, as one delete of the store's: well inside its rate. */
  BATCH: 100,
} as const;

/** What one sweep came to: generations deleted, blob and row, and whether a full batch was taken, so more may wait. */
export interface AgentStateSweepOutcome {
  readonly deleted: number;
  readonly full: boolean;
}

/** One sweep of the generations no launch will restore again, as of the instant given. */
export function sweepAgentStates(
  now: Date,
): Effect.Effect<
  AgentStateSweepOutcome,
  AgentStateBlobsUnavailable | StoreFailure,
  AgentStateBlobs | DatabaseServices
> {
  return Effect.gen(function* () {
    const blobs = yield* AgentStateBlobs;
    if (!blobs.configured) return { deleted: 0, full: false };
    const sweepable = yield* sweepableAgentStates(now, AGENT_STATE_SWEEP.BATCH);
    if (sweepable.length === 0) return { deleted: 0, full: false };
    yield* blobs.remove(sweepable.map((generation) => generation.path));
    const deleted = yield* deleteAgentStates(sweepable.map((generation) => generation.id));
    return { deleted, full: sweepable.length === AGENT_STATE_SWEEP.BATCH };
  });
}
