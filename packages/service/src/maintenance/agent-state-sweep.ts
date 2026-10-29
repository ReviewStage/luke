/**
 * agent-state-sweep.ts -- the scheduled sweep's delete of the device agents' saved state no launch will restore again, and of uploads no commit named: each blob from the store, then its record.
 *
 * A generation stands until the sweep takes it
 * (`@luke/database/models/agent-state-store`'s `sweepableAgentStates`):
 * one superseded by a newer generation of its agent, whose blob its commit
 * deleted already unless that failed; every one of an agent whose
 * transcript is gone, purged seven days after the agent or its task was
 * deleted, or at once with its account; and every one committed seven days
 * ago or more, the newest included, archived or not, as a cloud agent's
 * snapshot goes seven days after its last use, but for an agent whose
 * launch is still open, whose run's own save renews it. An upload's grant
 * stands a day (`sweepableAgentStateUploads`), and one no commit named is
 * an upload whose commit never came, whose blob goes with it.
 *
 * Each minute it takes at most `BATCH` of each, the longest standing first,
 * deletes their blobs in one call, and only then their rows, since a row is
 * the one record of the blob it names: a delete the store refused leaves
 * every row for the next minute, and a blob already gone, or never
 * uploaded, counts as deleted. A deployment without a store passes over
 * state, since it could have kept none. What is logged is counts alone.
 */

import type { DatabaseServices, StoreFailure } from "@luke/database/core/query";
import {
  deleteAgentStates,
  deleteAgentStateUploads,
  sweepableAgentStates,
  sweepableAgentStateUploads,
} from "@luke/database/models/agent-state-store";
import { Effect } from "effect";
import { AgentStateBlobs, type AgentStateBlobsUnavailable } from "../agents/agent-state-blobs.js";

const AGENT_STATE_SWEEP = {
  /** The most generations, and the most grants, one sweep deletes, as one delete of the store's: well inside its rate. */
  BATCH: 100,
} as const;

/** What one sweep came to: generations deleted, blob and row, uploads no commit named deleted, blob and grant, and whether a full batch of either was taken, so more may wait. */
export interface AgentStateSweepOutcome {
  readonly deleted: number;
  readonly abandoned: number;
  readonly full: boolean;
}

/** One sweep of the generations no launch will restore again and the uploads no commit named, as of the instant given. */
export function sweepAgentStates(
  now: Date,
): Effect.Effect<
  AgentStateSweepOutcome,
  AgentStateBlobsUnavailable | StoreFailure,
  AgentStateBlobs | DatabaseServices
> {
  return Effect.gen(function* () {
    const blobs = yield* AgentStateBlobs;
    if (!blobs.configured) return { deleted: 0, abandoned: 0, full: false };
    const generations = yield* sweepableAgentStates(now, AGENT_STATE_SWEEP.BATCH);
    const grants = yield* sweepableAgentStateUploads(now, AGENT_STATE_SWEEP.BATCH);
    // Note that a committed grant's blob is its generation's, so only the uncommitted grants' blobs go.
    const abandoned = grants.filter((grant) => !grant.committed).map((grant) => grant.path);
    const paths = [...generations.map((generation) => generation.path), ...abandoned];
    if (paths.length > 0) yield* blobs.remove(paths);
    const deleted = yield* deleteAgentStates(generations.map((generation) => generation.id));
    yield* deleteAgentStateUploads(grants.map((grant) => grant.path));
    return {
      deleted,
      abandoned: abandoned.length,
      full:
        generations.length === AGENT_STATE_SWEEP.BATCH || grants.length === AGENT_STATE_SWEEP.BATCH,
    };
  });
}
