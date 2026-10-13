import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { ChangesView } from "./changes-view";
import { agentStillWriting, agentTabLabel } from "./coding-agent-model";
import { useAgentChanges } from "./use-agent-changes";
import { useAgentPullRequest } from "./use-agent-pull-request";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * agent-changes-tab.tsx -- one agent's Changes tab in the side panel: the files of the pull request it published, drawn in the shared changes view.
 *
 * The tab feeds the changes view (`changes-view.tsx`) from the one source
 * it reads today, the agent's pull request on GitHub, read when the tab
 * first shows, on Refresh, and as the agent ends (`use-agent-changes.ts`).
 * What the agent published is read beside it on the same terms as its own
 * tab reads it, for the pull request's page the view's GitHub door opens.
 * The tab is named for the agent whose changes it shows, as its own tab is
 * named (`changesTabLabel`).
 */

/** Empty, because the tab holds no transcript, and the published read asks once as the tab shows. */
const NO_MESSAGES: readonly never[] = [];

/** The Changes tab's name: the agent's own, after the word for what it shows. */
export function changesTabLabel(
  agent: Pick<CodingAgentSummary, "title" | "model"> | undefined,
  models?: readonly CatalogModel[],
): string {
  return agent === undefined ? "Changes" : `Changes: ${agentTabLabel(agent, models)}`;
}

export function AgentChangesTab({
  agentId,
  control,
  shown,
}: {
  agentId: string;
  control: CodingAgentsControl;
  /** Whether the panel is on screen, which is when the tab reads. */
  shown: boolean;
}): React.JSX.Element {
  const { tell } = useAct();
  const agent = control.agents?.find((each) => each.id === agentId);
  const status = agent?.status ?? CODING_AGENT_STATUS.RUNNING;
  const changes = useAgentChanges({
    agentId,
    shown,
    ended: !agentStillWriting(status),
    read: control.readChanges,
  });
  const published = useAgentPullRequest({
    agentId,
    status,
    shown,
    messages: NO_MESSAGES,
    read: control.readPullRequest,
  });
  const pullRequest = published?.pullRequest ?? null;
  return (
    <ChangesView
      read={changes.read}
      refreshing={changes.refreshing}
      onRefresh={changes.onRefresh}
      pageUrl={pullRequest === null ? undefined : `${pullRequest.url}/files`}
      openGitHub={(url) => tell(ACT_KIND.GITHUB_OPEN, { url })}
    />
  );
}
