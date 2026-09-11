import {
  type HostedProjectsAnswer,
  type HostedRosterClient,
  snapshotRoster,
} from "@sidecar/hosted";
import {
  isCloudAgentProviderId,
  type ObservedWorkspaceProject,
  PROVIDER_IDENTITY_BY_ID,
  type SessionRoster,
} from "@sidecar/session";

export interface SnapshotRosterDependencies {
  client: Pick<HostedRosterClient, "observe">;
  registry: SessionRoster;
  /** Whether the pass that began this read still owns the roster once the read answers. */
  isCurrent: () => boolean;
  report: (message: string) => void;
}

/**
 * One observation pass of the desktop: the roster the service's scheduled
 * pass last stored, drawn into the one roster the rows, the brain, and the
 * voice read. Each cloud provider's slice is replaced whole, so a session the
 * snapshot no longer holds leaves on this pass. A read that answers nothing
 * leaves the last roster standing, the way a failed provider pass always
 * did, and says so; the next tick is the retry. A pass stopped while its
 * read was out draws nothing over the empty roster the stop published.
 */
export async function drawSnapshotRoster(dependencies: SnapshotRosterDependencies): Promise<void> {
  const { client, registry, isCurrent, report } = dependencies;
  const answer = await client.observe();
  if (!isCurrent()) return;
  if (!answer) {
    report("Roster snapshot could not be read; the last roster stands.");
    return;
  }
  for (const [providerId, observations] of snapshotRoster(answer)) {
    const { id, displayName } = PROVIDER_IDENTITY_BY_ID[providerId];
    try {
      registry.replaceProvider({ id, displayName }, observations);
    } catch (error) {
      report(
        `Roster snapshot could not be drawn (${providerId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export interface SnapshotProjectsDependencies {
  client: Pick<HostedRosterClient, "projects">;
  /** Whether the pass that began this read still owns the list once the read answers. */
  isCurrent: () => boolean;
  report: (message: string) => void;
}

/**
 * The projects the service's answer lists, as the app reports a project:
 * stamped with the provider that offered it, under the name this build
 * gives that provider. A project under a provider this build does not
 * observe in the cloud is dropped, and no agent list is read onto a
 * project, exactly as the cloud adapter's own listing carried none: which
 * agents a creation may name is the build's table, which the service's
 * admission and this Mac's read the same way.
 */
export function snapshotProjects(
  answer: HostedProjectsAnswer,
): readonly ObservedWorkspaceProject[] {
  return answer.projects.flatMap((project) =>
    isCloudAgentProviderId(project.providerId)
      ? [{ ...project, providerName: PROVIDER_IDENTITY_BY_ID[project.providerId].displayName }]
      : [],
  );
}

/**
 * The same pass's read of where a workspace can be created: the projects the
 * service's stored snapshot lists for the account's keys, so the brain and
 * the settings rows offer exactly what a creation is admitted against. A
 * read that answers nothing leaves the last list standing and says so; a
 * pass stopped while its read was out replaces nothing.
 */
export async function drawSnapshotProjects(
  dependencies: SnapshotProjectsDependencies,
): Promise<readonly ObservedWorkspaceProject[] | undefined> {
  const { client, isCurrent, report } = dependencies;
  const answer = await client.projects();
  if (!isCurrent()) return undefined;
  if (!answer) {
    report("Workspace projects could not be read; the last list stands.");
    return undefined;
  }
  return snapshotProjects(answer);
}
