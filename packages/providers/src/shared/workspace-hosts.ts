import type {
  ProviderActResult,
  ProviderControlResult,
  ProviderMessageResult,
  ProviderSessionObservation,
  ProviderWorkspaceResult,
  SessionIdentity,
} from "@sidecar/session";
import {
  type ClaudeDesktopSessionApplicationReader,
  ClaudeDesktopSessionApplicationSnapshot,
} from "../claude-code/desktop-applications.js";
import {
  type ConductorSessionApplicationReader,
  ConductorSessionApplicationSnapshot,
} from "../conductor/session-applications.js";

/** One manager's annotation of one provider's already-observed sessions. */
export type WorkspaceHostEnrichment = (
  providerId: string,
  observations: readonly ProviderSessionObservation[],
) => readonly ProviderSessionObservation[];

/**
 * The acts a workspace manager delivers for one session it has claimed, each
 * bound to the context the manager's latest read resolved for that session.
 * A manager delivers an act only for a capability its own enrichment
 * advertised on the row: the performer re-checks the roster before asking,
 * and the manager answers unsupported for anything its context cannot carry
 * (a chatless workspace row has no terminal for a message to land in).
 */
export interface WorkspaceHostSessionActs {
  sendMessage(text: string): Promise<ProviderMessageResult>;
  executeControl(controlId: string): Promise<ProviderControlResult>;
  spawnAgent(agent: string, task: string | undefined): Promise<ProviderWorkspaceResult>;
  renameWorkspace(name: string): Promise<ProviderActResult>;
}

/**
 * One workspace manager in the observation pass: how its own records become
 * one pass's enrichment, and what a failed read stands in with — the manager
 * annotating nothing, never a failed pass. `observationFailureLabel` opens
 * the stderr line the caller reports a failed read under.
 *
 * A manager that also carries acts for the sessions it groups declares
 * `claim`: the acts for a session its latest read resolved, or nothing for a
 * session it does not manage, so the performer hands a claimed session's act
 * to the manager and every other session's to its provider adapter.
 * `ownsControl` names the controls the manager's enrichment added to a row,
 * so a provider's own control on a managed row still reaches the provider.
 */
export interface WorkspaceHostRegistration {
  observationFailureLabel: string;
  read(): Promise<WorkspaceHostEnrichment>;
  emptyEnrichment: WorkspaceHostEnrichment;
  claim?(identity: SessionIdentity): WorkspaceHostSessionActs | undefined;
  ownsControl?(controlId: string): boolean;
}

export interface WorkspaceHostRegistrationOptions {
  /**
   * Superset's package sits above this one in the graph, so its entry — the
   * read that also carries the CLI's active organization into the
   * enrichment — is handed in rather than built here.
   */
  superset: WorkspaceHostRegistration;
  conductorApplications: ConductorSessionApplicationReader;
  claudeDesktopApplications: ClaudeDesktopSessionApplicationReader;
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
      emptyEnrichment: enrichmentFrom(new ConductorSessionApplicationSnapshot()),
    },
    {
      observationFailureLabel: "Claude application observation",
      read: async () => enrichmentFrom(await options.claudeDesktopApplications.read()),
      emptyEnrichment: enrichmentFrom(new ClaudeDesktopSessionApplicationSnapshot()),
    },
  ];
}
