/**
 * workspace-experiments.ts -- whether a workspace has one of its experiments on, as its owners and admins chose it for everyone in it.
 *
 * Task descriptions, Pilot, and Memory are each workspace's choice, carried
 * on its entry in the account's workspaces (`workspacesLive`), so a switch an
 * admin flips reaches every member's window as the list moves. A surface
 * about one task reads that task's workspace; one about no task, ⌘K, a
 * chord, or a Settings page, reads the workspace the window lists or Settings
 * shows. A workspace not yet read, or one the account is no member of, has
 * every experiment off. An account's own experiments are still read off its
 * settings (`selectExperiment`).
 */

import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  type ExperimentChoices,
  experimentOn,
  experimentsIn,
  NO_EXPERIMENTS,
  NO_WORKSPACE_EXPERIMENTS,
  type WorkspaceExperiment,
  type WorkspaceExperimentChoices,
  workspaceExperimentChoicesFrom,
} from "@repo/settings";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { appStateQuery, selectStoredExperimentChoices } from "./use-app-state.js";

/** What a workspace's choices are read from: its entry on the account's list. */
interface ChoosingWorkspace {
  readonly id: string;
  readonly experiments?: readonly { readonly experiment: string; readonly on: boolean }[];
}

/** The choices of the workspace `workspaceId` names among `workspaces`; every one off where none is named or listed. */
export function workspaceExperimentChoices(
  workspaces: readonly ChoosingWorkspace[],
  workspaceId: string | undefined,
): WorkspaceExperimentChoices {
  if (workspaceId === undefined) return NO_WORKSPACE_EXPERIMENTS;
  const workspace = workspaces.find((each) => each.id === workspaceId);
  return workspace === undefined
    ? NO_WORKSPACE_EXPERIMENTS
    : workspaceExperimentChoicesFrom(workspace.experiments);
}

/** Whether the workspace `workspaceId` names has `experiment` on, as main's document lists it now; for a callback that cannot wait a render. */
function workspaceExperimentOnIn(
  state: AppStateSnapshot | undefined,
  workspaceId: string | undefined,
  experiment: WorkspaceExperiment,
): boolean {
  const workspaces = state?.tasks.workspaces ?? [];
  return experimentOn(workspaceExperimentChoices(workspaces, workspaceId), experiment);
}

/**
 * Whether a workspace has one experiment on: the one way a surface about a
 * task, or about the workspace the window lists, asks of a workspace
 * experiment. Off while `workspaceId` is none, or names no workspace read.
 */
export function useWorkspaceExperiment(
  workspaceId: string | undefined,
  experiment: WorkspaceExperiment,
): boolean {
  const select = useCallback(
    (state: AppStateSnapshot) => workspaceExperimentOnIn(state, workspaceId, experiment),
    [workspaceId, experiment],
  );
  return useQuery({ ...appStateQuery, select }).data === true;
}

/**
 * Every experiment on where the window works in one workspace: the account's
 * own choices of its own, and that workspace's of the workspace's. For a list
 * that gates its entries by a tag (`AppShortcut.experiment`), or a page by
 * its experiment, whatever its scope.
 */
export function useExperimentsIn(workspaceId: string | undefined): ExperimentChoices {
  const select = useCallback(
    (state: AppStateSnapshot) =>
      experimentsIn(
        selectStoredExperimentChoices(state),
        workspaceExperimentChoices(state.tasks.workspaces, workspaceId),
      ),
    [workspaceId],
  );
  return useQuery({ ...appStateQuery, select }).data ?? NO_EXPERIMENTS;
}
