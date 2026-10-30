/**
 * agents.ts -- the Tasks tab's core asks of the host about a task's coding agents, as procedures.
 *
 * A kind that carries nothing takes `undefined` alone, so a window calls it
 * with no payload and one sent anything is refused.
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, as every act contract's does. What an
 * agent published is read here too: its pull request, its changes, its Pull
 * request tab's overview, an image that overview names, and a change made to
 * the pull request on GitHub. A box's pairing is read, approved, and denied
 * here too, by the code its link named, as Settings › Hosts asks.
 */

import {
  type AgentTranscriptPage,
  agentAgentAnswerSchema,
  agentArchiveParamsSchema,
  agentChangesAnswerViewSchema,
  agentChooseParamsSchema,
  agentDefaultAnswerViewSchema,
  agentDefaultWriteParamsSchema,
  agentDeleteAnswerViewSchema,
  agentGitHubImageParamsSchema,
  agentGitHubImageViewSchema,
  agentListAnswerViewSchema,
  agentListParamsSchema,
  agentLukeToolsAnswerViewSchema,
  agentMessageParamsSchema,
  agentMessagesAnswerViewSchema,
  agentMessagesParamsSchema,
  agentModelsAnswerSchema,
  agentOperatorEnsureAnswerViewSchema,
  agentOperatorEnsureParamsSchema,
  agentOverviewChecksAnswerViewSchema,
  agentOverviewConversationAnswerViewSchema,
  agentOverviewPullRequestAnswerViewSchema,
  agentPageAnswerViewSchema,
  agentPageParamsSchema,
  agentPartParamsSchema,
  agentPartViewSchema,
  agentPinParamsSchema,
  agentPullRequestActionParamsSchema,
  agentPullRequestAnswerViewSchema,
  agentPullRequestParamsSchema,
  agentPullRequestReadParamsSchema,
  agentPullRequestViewedAnswerViewSchema,
  agentPullRequestWriteAnswerViewSchema,
  agentQueueAnswerViewSchema,
  agentQueueParamsSchema,
  agentRenameParamsSchema,
  agentReviewOptionsAnswerViewSchema,
  agentRewindParamsSchema,
  agentServersParamsSchema,
  agentStartParamsSchema,
  agentStopParamsSchema,
  agentTranscriptKeySchema,
  agentTranscriptOlderAnswerSchema,
  agentTranscriptOlderParamsSchema,
  agentWorkspaceListParamsSchema,
  devicePresenceAnswerViewSchema,
  hostDoneAnswerViewSchema,
  hostIdParamsSchema,
  hostsAnswerViewSchema,
} from "@luke/features/agent-view";
import {
  hostPairingApproveViewSchema,
  hostPairingDenyViewSchema,
  hostPairingParamsSchema,
  hostPairingViewSchema,
} from "@luke/features/host-pairing-view";
import { eventIterator, type } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { AGENT_ACT_KIND } from "./kinds.js";

/**
 * An identifier that has to match the one it names elsewhere, a task or a
 * workspace, so its ends are admitted as written rather than trimmed into a
 * value the host would not hold, and one that carries nothing is refused.
 */
const exactId = EffectSchema.String.check(
  EffectSchema.makeFilter((value) => value.trim().length > 0),
  EffectSchema.isMaxLength(512),
);

/** Which agent's tab the panel shows. */
const shownParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NullOr(exactId),
});

export const agentActsContract = {
  [AGENT_ACT_KIND.AGENTS_MODELS]: actProcedure("Could not read the models on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(agentModelsAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_DEFAULT_READ]: actProcedure(
    "Could not read the default model on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(agentDefaultAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_DEFAULT_WRITE]: actProcedure(
    "Could not change the default model on this system.",
  )
    .input(exactInput(agentDefaultWriteParamsSchema))
    .output(EffectSchema.flip(agentDefaultAnswerViewSchema)),
  [AGENT_ACT_KIND.HOSTS_LIST]: actProcedure("Could not read your hosts on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(hostsAnswerViewSchema)),
  [AGENT_ACT_KIND.HOSTS_PRESENCE]: actProcedure(
    "Could not read your devices' beats on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(devicePresenceAnswerViewSchema)),
  [AGENT_ACT_KIND.HOSTS_REMOVE]: actProcedure("Could not remove the host on this system.")
    .input(exactInput(hostIdParamsSchema))
    .output(EffectSchema.flip(hostDoneAnswerViewSchema)),
  [AGENT_ACT_KIND.HOSTS_PAIRING_READ]: actProcedure("Could not read the code on this system.")
    .input(exactInput(hostPairingParamsSchema))
    .output(EffectSchema.flip(hostPairingViewSchema)),
  [AGENT_ACT_KIND.HOSTS_PAIRING_APPROVE]: actProcedure("Could not connect the host on this system.")
    .input(exactInput(hostPairingParamsSchema))
    .output(EffectSchema.flip(hostPairingApproveViewSchema)),
  [AGENT_ACT_KIND.HOSTS_PAIRING_DENY]: actProcedure("Could not deny the host on this system.")
    .input(exactInput(hostPairingParamsSchema))
    .output(EffectSchema.flip(hostPairingDenyViewSchema)),
  [AGENT_ACT_KIND.AGENTS_LIST]: actProcedure("Could not read the task's agents on this system.")
    .input(exactInput(agentListParamsSchema))
    .output(EffectSchema.flip(agentListAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_WORKSPACE_LIST]: actProcedure(
    "Could not read the workspace's agents on this system.",
  )
    .input(exactInput(agentWorkspaceListParamsSchema))
    .output(EffectSchema.flip(agentListAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_START]: actProcedure("Could not start an agent on this system.")
    .input(exactInput(agentStartParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_MESSAGES]: actProcedure(
    "Could not read the agent's transcript on this system.",
  )
    .input(exactInput(agentMessagesParamsSchema))
    .output(EffectSchema.flip(agentMessagesAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_TRANSCRIPT]: actProcedure(
    "Could not follow the agent's transcript on this system.",
  )
    .input(exactInput(agentTranscriptKeySchema))
    .output(eventIterator(type<AgentTranscriptPage>())),
  [AGENT_ACT_KIND.AGENTS_PART]: actProcedure("Could not read the agent's output on this system.")
    .input(exactInput(agentPartParamsSchema))
    .output(EffectSchema.flip(agentPartViewSchema)),
  [AGENT_ACT_KIND.AGENTS_TRANSCRIPT_OLDER]: actProcedure(
    "Could not read the agent's earlier messages on this system.",
  )
    .input(exactInput(agentTranscriptOlderParamsSchema))
    .output(EffectSchema.flip(agentTranscriptOlderAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_MESSAGE]: actProcedure("Could not message the agent on this system.")
    .input(exactInput(agentMessageParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_CHOOSE]: actProcedure("Could not change the agent's model on this system.")
    .input(exactInput(agentChooseParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_RENAME]: actProcedure("Could not rename the agent on this system.")
    .input(exactInput(agentRenameParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_SERVERS]: actProcedure(
    "Could not switch the agent's MCP servers on this system.",
  )
    .input(exactInput(agentServersParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_QUEUE]: actProcedure("Could not change the agent's queue on this system.")
    .input(exactInput(agentQueueParamsSchema))
    .output(EffectSchema.flip(agentQueueAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_STOP]: actProcedure("Could not stop the agent on this system.")
    .input(exactInput(agentStopParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_REWIND]: actProcedure("Could not rewind the agent on this system.")
    .input(exactInput(agentRewindParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_ARCHIVE]: actProcedure("Could not archive the agent on this system.")
    .input(exactInput(agentArchiveParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_PIN]: actProcedure("Could not pin the agent on this system.")
    .input(exactInput(agentPinParamsSchema))
    .output(EffectSchema.flip(agentAgentAnswerSchema)),
  [AGENT_ACT_KIND.AGENTS_ENSURE_OPERATOR]: actProcedure("Could not reach Luke on this system.")
    .input(exactInput(agentOperatorEnsureParamsSchema))
    .output(EffectSchema.flip(agentOperatorEnsureAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_DELETE]: actProcedure("Could not delete the agent on this system.")
    .input(exactInput(agentStopParamsSchema))
    .output(EffectSchema.flip(agentDeleteAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_SHOWN]: actProcedure("Could not note which agent is shown on this system.")
    .input(exactInput(shownParamsSchema))
    .output(EffectSchema.Void),
  [AGENT_ACT_KIND.AGENTS_SEEN]: actProcedure("Could not mark the agent as read on this system.")
    .input(exactInput(EffectSchema.Struct({ agentId: exactId })))
    .output(EffectSchema.Void),
  [AGENT_ACT_KIND.AGENTS_PAGE]: actProcedure("Could not read the agent on this system.")
    .input(exactInput(agentPageParamsSchema))
    .output(EffectSchema.flip(agentPageAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST]: actProcedure(
    "Could not read the agent's pull request on this system.",
  )
    .input(exactInput(agentPullRequestReadParamsSchema))
    .output(EffectSchema.flip(agentPullRequestAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_CHANGES]: actProcedure(
    "Could not read the agent's changes on this system.",
  )
    .input(exactInput(agentPullRequestReadParamsSchema))
    .output(EffectSchema.flip(agentChangesAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_OVERVIEW_PULL_REQUEST]: actProcedure(
    "Could not read the agent's pull request on this system.",
  )
    .input(exactInput(agentPullRequestReadParamsSchema))
    .output(EffectSchema.flip(agentOverviewPullRequestAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_REVIEW_OPTIONS]: actProcedure(
    "Could not read the repository's reviewers and labels on this system.",
  )
    .input(exactInput(agentPullRequestParamsSchema))
    .output(EffectSchema.flip(agentReviewOptionsAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_LUKE_TOOLS]: actProcedure(
    "Could not read the agent's Luke tools on this system.",
  )
    .input(exactInput(agentPullRequestParamsSchema))
    .output(EffectSchema.flip(agentLukeToolsAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_OVERVIEW_CHECKS]: actProcedure(
    "Could not read the pull request's checks on this system.",
  )
    .input(exactInput(agentPullRequestReadParamsSchema))
    .output(EffectSchema.flip(agentOverviewChecksAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_OVERVIEW_CONVERSATION]: actProcedure(
    "Could not read the pull request's conversation on this system.",
  )
    .input(exactInput(agentPullRequestReadParamsSchema))
    .output(EffectSchema.flip(agentOverviewConversationAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_GITHUB_IMAGE]: actProcedure(
    "Could not read the pull request's image on this system.",
  )
    .input(exactInput(agentGitHubImageParamsSchema))
    .output(EffectSchema.flip(agentGitHubImageViewSchema)),
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_ACTION]: actProcedure(
    "Could not change the pull request on this system.",
  )
    .input(exactInput(agentPullRequestActionParamsSchema))
    .output(EffectSchema.flip(agentPullRequestWriteAnswerViewSchema)),
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_VIEWED]: actProcedure(
    "Could not read which files you viewed on this system.",
  )
    .input(exactInput(agentPullRequestReadParamsSchema))
    .output(EffectSchema.flip(agentPullRequestViewedAnswerViewSchema)),
};
