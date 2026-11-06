/**
 * workspace-experiment-on.ts -- whether a workspace experiment is on in the workspace the work is in, which decides what of Task descriptions, Pilot, and Memory an agent or a member's call is offered, handed, and told.
 *
 * Every gate of a workspace experiment asks here, for the workspace the work
 * stands in: an agent's own (`agent.organizationId`), a task's
 * (`task.workspaceId`), or the one a member's request names. It never asks
 * the account calling, so every member and agent of one workspace reads the
 * same answer. It is read once where an agent's tools, instructions, and
 * context are built, and again at each tool's door, since a harness may call
 * a tool it was not listed. It stands in a module of its own, beside nothing
 * else, so the start, the turn's context, and the doors all reach it without
 * reaching each other.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { workspaceExperimentOn } from "@repo/database/models/workspace-experiment-store";
import type { WorkspaceExperiment } from "@repo/settings";
import { Effect } from "effect";
import { logStoreFailure } from "../http/store-failure.js";

/**
 * Whether the workspace has the experiment on (`workspaceExperimentOn`).
 * Where it cannot be read, it is off, logged for the operator.
 */
export function experimentOnIn(
  workspaceId: string,
  experiment: WorkspaceExperiment,
): Effect.Effect<boolean, never, DatabaseServices> {
  return workspaceExperimentOn(workspaceId, experiment).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => false),
  );
}
