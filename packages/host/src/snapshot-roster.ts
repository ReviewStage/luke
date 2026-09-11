import { type HostedRosterClient, snapshotRoster } from "@sidecar/hosted";
import { PROVIDER_IDENTITY_BY_ID, type SessionRoster } from "@sidecar/session";

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
