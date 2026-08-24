import type { ProviderSessionObservation } from "@sidecar/session";
import {
  type CmuxSessionApplicationReader,
  CmuxSessionApplicationSnapshot,
} from "../cmux/session-applications.js";
import {
  type ConductorSessionApplicationReader,
  ConductorSessionApplicationSnapshot,
} from "../conductor/session-applications.js";
import { type OrcaWorkspaceReader, OrcaWorkspaceSnapshot } from "../orca/workspaces.js";

/** One manager's annotation of one provider's already-observed sessions. */
export type WorkspaceHostEnrichment = (
  providerId: string,
  observations: readonly ProviderSessionObservation[],
) => readonly ProviderSessionObservation[];

/**
 * One workspace manager in the observation pass: how its own records become
 * one pass's enrichment, and what a failed read stands in with — the manager
 * annotating nothing, never a failed pass. `observationFailureLabel` opens
 * the stderr line the caller reports a failed read under.
 */
export interface WorkspaceHostRegistration {
  observationFailureLabel: string;
  read(): Promise<WorkspaceHostEnrichment>;
  emptyEnrichment: WorkspaceHostEnrichment;
}

export interface WorkspaceHostRegistrationOptions {
  /**
   * Superset's package sits above this one in the graph, so its entry — the
   * read that also carries the CLI's active organization into the
   * enrichment — is handed in rather than built here.
   */
  superset: WorkspaceHostRegistration;
  conductorApplications: ConductorSessionApplicationReader;
  orcaWorkspaces: OrcaWorkspaceReader;
  cmuxApplications: CmuxSessionApplicationReader;
}

function enrichmentFrom(snapshot: {
  enrich: (
    providerId: string,
    observations: readonly ProviderSessionObservation[],
  ) => readonly ProviderSessionObservation[];
}): WorkspaceHostEnrichment {
  return (providerId, observations) => snapshot.enrich(providerId, observations);
}

/**
 * The workspace managers of one observation pass, in claim order. Superset
 * claims its workspaces first and Conductor next — the precedence that stood
 * before Orca joined, so no existing tray moves — and Orca defers to both:
 * one chat is grouped by exactly one manager however many of them hold it,
 * and a chat only Orca holds still groups under its worktree. cmux runs last
 * and claims no workspace at all: it only adds its own association, and its
 * pane address stands in as the row's link only where none of the managers
 * before it gave one.
 */
export function workspaceHostRegistrations(
  options: WorkspaceHostRegistrationOptions,
): readonly WorkspaceHostRegistration[] {
  return [
    options.superset,
    {
      observationFailureLabel: "Conductor application observation",
      read: async () => enrichmentFrom(await options.conductorApplications.read()),
      emptyEnrichment: enrichmentFrom(new ConductorSessionApplicationSnapshot()),
    },
    {
      observationFailureLabel: "Orca application observation",
      read: async () => enrichmentFrom(await options.orcaWorkspaces.read()),
      emptyEnrichment: enrichmentFrom(new OrcaWorkspaceSnapshot()),
    },
    {
      observationFailureLabel: "cmux application observation",
      read: async () => enrichmentFrom(await options.cmuxApplications.read()),
      emptyEnrichment: enrichmentFrom(new CmuxSessionApplicationSnapshot()),
    },
  ];
}
