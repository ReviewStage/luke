import type { ProviderSessionObservation } from "@sidecar/session";

export type { WorkspaceHostEnrichment } from "./host-claims.js";

import type { ClaudeDesktopApplications } from "../claude-code/applications.js";
import type { ConductorApplications } from "../conductor/applications.js";
import type { WorkspaceHostEnrichment } from "./host-claims.js";

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
  conductorApplications: ConductorApplications;
  claudeDesktopApplications: ClaudeDesktopApplications;
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
 * claims its workspaces first and Conductor next: one chat is grouped by
 * exactly one manager however many of them hold it. The Claude desktop app
 * comes last and claims no workspace at all — it only names the chats its
 * Code tab holds — so its place in the order decides nothing but the order
 * its mark is added in.
 */
export function workspaceHostRegistrations(
  options: WorkspaceHostRegistrationOptions,
): readonly WorkspaceHostRegistration[] {
  return [
    options.superset,
    {
      observationFailureLabel: "Conductor application observation",
      read: async () => enrichmentFrom(await options.conductorApplications.read()),
      emptyEnrichment: enrichmentFrom(options.conductorApplications.empty),
    },
    {
      observationFailureLabel: "Claude application observation",
      read: async () => enrichmentFrom(await options.claudeDesktopApplications.read()),
      emptyEnrichment: enrichmentFrom(options.claudeDesktopApplications.empty),
    },
  ];
}
