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
import {
  workspaceExperimentOn,
  workspaceExperimentsOf,
} from "@repo/database/models/workspace-experiment-store";
import { EXPERIMENT, type WorkspaceExperiment } from "@repo/settings";
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

/**
 * The workspace's experiments as an agent's tools, their words, and its
 * instructions are built by: each of Task descriptions, Pilot, and Memory on
 * or off. An agent is told nothing of one that is off, so every word that
 * names one is chosen by this.
 */
export interface ExperimentsOn {
  readonly descriptionsOn: boolean;
  readonly pilotOn: boolean;
  readonly memoryOn: boolean;
}

/** Every workspace experiment on: the words a tool is declared in where nothing narrows it, as eve's tool files and the goldens hold them. */
export const EVERY_EXPERIMENT_ON: ExperimentsOn = {
  descriptionsOn: true,
  pilotOn: true,
  memoryOn: true,
};

/** Every workspace experiment off. */
export const NO_EXPERIMENT_ON: ExperimentsOn = {
  descriptionsOn: false,
  pilotOn: false,
  memoryOn: false,
};

/** The workspace's experiments, read in one statement; where they cannot be read, every one is off, logged for the operator. */
export function experimentsOnIn(
  workspaceId: string,
): Effect.Effect<ExperimentsOn, never, DatabaseServices> {
  return workspaceExperimentsOf(workspaceId).pipe(
    Effect.map((standings) => {
      const on = (experiment: WorkspaceExperiment) =>
        standings.some((standing) => standing.experiment === experiment && standing.on);
      return {
        descriptionsOn: on(EXPERIMENT.DESCRIPTIONS),
        pilotOn: on(EXPERIMENT.PILOT),
        memoryOn: on(EXPERIMENT.MEMORY),
      };
    }),
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => NO_EXPERIMENT_ON),
  );
}

/**
 * The one refusal of a tool, or of a part of one, that an experiment off in
 * the workspace withholds. It names no experiment, since an agent is told
 * nothing of one that is off; a call meets it only from a session that
 * started before the switch flipped, or a harness that calls a tool it was
 * not listed.
 */
export const EXPERIMENT_OFF_REFUSAL = "This tool is not available here.";
