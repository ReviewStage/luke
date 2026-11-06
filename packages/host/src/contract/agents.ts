/**
 * agents.ts -- the Tasks tab's core asks of the host about a task's coding agents: the plain ones declared, and the procedures of the holds beside them.
 *
 * A kind that carries nothing takes `undefined` alone, so a window calls it
 * with no payload and one sent anything is refused.
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, as every act contract's does. What an
 * agent published is read here too: its pull request, its changes, its Pull
 * request tab's overview, an image that overview names, and a change made to
 * the pull request on GitHub. A box's pairing is read, approved, and denied
 * here too, by the code its link named, as Settings › Hosts asks. Only a
 * panel draws a task's agents, so every ask is the panel's alone, and a
 * refusal or a defect of the host's is drawn as the ask's unanswered
 * failure, as every one was before it was declared. Each hold, its Try
 * again, and the notes of which agent is shown and seen stay procedures of
 * their own.
 */

import { eventIterator, type } from "@orpc/contract";
import {
  AGENT_CALL_FAILURE,
  agentAddRepositoryParamsSchema,
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
  agentMarkReadParamsSchema,
  agentMessageParamsSchema,
  agentMessagesAnswerViewSchema,
  agentMessagesParamsSchema,
  agentPageAnswerViewSchema,
  agentPageParamsSchema,
  agentPartParamsSchema,
  agentPartViewSchema,
  agentPinParamsSchema,
  agentPullRequestActionParamsSchema,
  agentPullRequestParamsSchema,
  agentPullRequestReadParamsSchema,
  agentPullRequestWriteAnswerViewSchema,
  agentQueueAnswerViewSchema,
  agentQueueParamsSchema,
  agentRenameParamsSchema,
  agentRewindParamsSchema,
  agentServersParamsSchema,
  agentStartParamsSchema,
  agentStopParamsSchema,
  agentTranscriptKeySchema,
  agentTranscriptOlderAnswerSchema,
  agentTranscriptOlderParamsSchema,
  agentWorkspaceListParamsSchema,
  chaptersProviderAnswerViewSchema,
  chaptersProviderWriteParamsSchema,
  hostDoneAnswerViewSchema,
  hostIdParamsSchema,
  pullRequestPartParamsSchema,
  thisMacHostSetParamsSchema,
} from "@repo/features/agent-view";
import {
  HOST_PAIRING_CALL_FAILURE,
  hostPairingApproveViewSchema,
  hostPairingDenyViewSchema,
  hostPairingParamsSchema,
  hostPairingViewSchema,
} from "@repo/features/host-pairing-view";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACT } from "@repo/sync";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
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

/** What the window draws for an agent's ask the host could not answer. */
const AGENT_UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** A pairing's read, approve, or deny that reached no answer, as each of them answers one. */
const PAIRING_UNANSWERED = { failure: HOST_PAIRING_CALL_FAILURE.UNANSWERED } as const;

/**
 * The agents' plain acts, each answered by its composer. Those whose answer
 * the window's notices note on its way (`act-port/agents-procedures.ts`)
 * are answered by hand on their handler.
 */
export const AGENT_ACTS = declaredActs({
  AGENTS_DEFAULT_WRITE: hostAct({
    input: agentDefaultWriteParamsSchema,
    output: agentDefaultAnswerViewSchema,
    refusal: "Could not change the default model on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_CHAPTERS_PROVIDER_WRITE: hostAct({
    input: chaptersProviderWriteParamsSchema,
    output: chaptersProviderAnswerViewSchema,
    refusal: "Could not change which key chapters run on on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
  }),
  HOSTS_REMOVE: hostAct({
    input: hostIdParamsSchema,
    output: hostDoneAnswerViewSchema,
    refusal: "Could not remove the host on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
  }),
  HOSTS_THIS_MAC_SET: hostAct({
    input: thisMacHostSetParamsSchema,
    output: hostDoneAnswerViewSchema,
    refusal: "Could not change this Mac on this system.",
    panelOnly: true,
    door: ACT.LOCAL_WRITE,
    unanswered: AGENT_UNANSWERED,
  }),
  HOSTS_PAIRING_READ: hostAct({
    input: hostPairingParamsSchema,
    output: hostPairingViewSchema,
    refusal: "Could not read the code on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: PAIRING_UNANSWERED,
  }),
  HOSTS_PAIRING_APPROVE: hostAct({
    input: hostPairingParamsSchema,
    output: hostPairingApproveViewSchema,
    refusal: "Could not connect the host on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: PAIRING_UNANSWERED,
  }),
  HOSTS_PAIRING_DENY: hostAct({
    input: hostPairingParamsSchema,
    output: hostPairingDenyViewSchema,
    refusal: "Could not deny the host on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: PAIRING_UNANSWERED,
  }),
  AGENTS_LIST: hostAct({
    input: agentListParamsSchema,
    output: agentListAnswerViewSchema,
    refusal: "Could not read the task's agents on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_WORKSPACE_LIST: hostAct({
    input: agentWorkspaceListParamsSchema,
    output: agentListAnswerViewSchema,
    refusal: "Could not read the workspace's agents on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_START: hostAct({
    input: agentStartParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not start an agent on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_MESSAGES: hostAct({
    input: agentMessagesParamsSchema,
    output: agentMessagesAnswerViewSchema,
    refusal: "Could not read the agent's transcript on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_PART: hostAct({
    input: agentPartParamsSchema,
    output: agentPartViewSchema,
    refusal: "Could not read the agent's output on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_TRANSCRIPT_OLDER: hostAct({
    input: agentTranscriptOlderParamsSchema,
    output: agentTranscriptOlderAnswerSchema,
    refusal: "Could not read the agent's earlier messages on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_MESSAGE: hostAct({
    input: agentMessageParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not message the agent on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_CHOOSE: hostAct({
    input: agentChooseParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not change the agent's model on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_RENAME: hostAct({
    input: agentRenameParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not rename the agent on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_SERVERS: hostAct({
    input: agentServersParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not switch the agent's MCP servers on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_ADD_REPOSITORY: hostAct({
    input: agentAddRepositoryParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not add a repository to the agent on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_QUEUE: hostAct({
    input: agentQueueParamsSchema,
    output: agentQueueAnswerViewSchema,
    refusal: "Could not change the agent's queue on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_STOP: hostAct({
    input: agentStopParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not stop the agent on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_REWIND: hostAct({
    input: agentRewindParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not rewind the agent on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_ARCHIVE: hostAct({
    input: agentArchiveParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not archive the agent on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_PIN: hostAct({
    input: agentPinParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not pin the agent on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_MARK_READ: hostAct({
    input: agentMarkReadParamsSchema,
    output: agentAgentAnswerSchema,
    refusal: "Could not mark the agent on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
    byHand: true,
  }),
  AGENTS_DELETE: hostAct({
    input: agentStopParamsSchema,
    output: agentDeleteAnswerViewSchema,
    refusal: "Could not delete the agent on this system.",
    panelOnly: true,
    door: ACT.ROW_WRITE,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_PAGE: hostAct({
    input: agentPageParamsSchema,
    output: agentPageAnswerViewSchema,
    refusal: "Could not read the agent on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_CHANGES: hostAct({
    input: agentPullRequestReadParamsSchema,
    output: agentChangesAnswerViewSchema,
    refusal: "Could not read the agent's changes on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_GITHUB_IMAGE: hostAct({
    input: agentGitHubImageParamsSchema,
    output: agentGitHubImageViewSchema,
    refusal: "Could not read the pull request's image on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: AGENT_UNANSWERED,
  }),
  AGENTS_PULL_REQUEST_ACTION: hostAct({
    input: agentPullRequestActionParamsSchema,
    output: agentPullRequestWriteAnswerViewSchema,
    refusal: "Could not change the pull request on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: AGENT_UNANSWERED,
  }),
});

export const agentActsContract = {
  ...contractOf(AGENT_ACTS),
  [AGENT_ACT_KIND.AGENTS_MODELS_FOLLOW]: actProcedure("Could not follow the models on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(eventIterator(type<never>())),
  [AGENT_ACT_KIND.AGENTS_MODELS_RETRY]: actProcedure(
    "Could not read the models again on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  [AGENT_ACT_KIND.AGENTS_PREFERENCES_RETRY]: actProcedure(
    "Could not read your preferences again on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  // Note that the hold's stream carries nothing: the held hosts reach the panel on app state, and the stream is the window's hold on them.
  [AGENT_ACT_KIND.HOSTS_FOLLOW]: actProcedure("Could not follow your hosts on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(eventIterator(type<never>())),
  [AGENT_ACT_KIND.HOSTS_RETRY]: actProcedure("Could not read your hosts again on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  // Note that the hold's stream carries nothing: the held beats reach the panel on app state, and the stream is the window's hold on them.
  [AGENT_ACT_KIND.HOSTS_PRESENCE_FOLLOW]: actProcedure(
    "Could not follow your devices' beats on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(eventIterator(type<never>())),
  [AGENT_ACT_KIND.HOSTS_PRESENCE_REFRESH]: actProcedure(
    "Could not read your devices' beats again on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.Void),
  // Note that the hold's stream carries nothing: the held transcript reaches the panel on app state, and the stream is the window's hold on it.
  [AGENT_ACT_KIND.AGENTS_TRANSCRIPT]: actProcedure(
    "Could not follow the agent's transcript on this system.",
  )
    .input(exactInput(agentTranscriptKeySchema))
    .output(eventIterator(type<never>())),
  [AGENT_ACT_KIND.AGENTS_TRANSCRIPT_RETRY]: actProcedure(
    "Could not read the agent's transcript again on this system.",
  )
    .input(exactInput(agentTranscriptKeySchema))
    .output(EffectSchema.Void),
  [AGENT_ACT_KIND.AGENTS_SHOWN]: actProcedure("Could not note which agent is shown on this system.")
    .input(exactInput(shownParamsSchema))
    .output(EffectSchema.Void),
  [AGENT_ACT_KIND.AGENTS_SEEN]: actProcedure("Could not mark the agent as read on this system.")
    .input(exactInput(EffectSchema.Struct({ agentId: exactId })))
    .output(EffectSchema.Void),
  // Note that the hold's stream carries nothing: the held origin reaches the panel on app state, and the stream is the window's hold on it.
  [AGENT_ACT_KIND.AGENTS_ORIGIN_FOLLOW]: actProcedure(
    "Could not follow the run that started the agent on this system.",
  )
    .input(exactInput(agentPageParamsSchema))
    .output(eventIterator(type<never>())),
  [AGENT_ACT_KIND.AGENTS_ORIGIN_RETRY]: actProcedure(
    "Could not read the run that started the agent again on this system.",
  )
    .input(exactInput(agentPageParamsSchema))
    .output(EffectSchema.Void),
  // Note that the hold's stream carries nothing: the held part reaches the panel on app state, and the stream is the window's hold on it.
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_FOLLOW]: actProcedure(
    "Could not follow the agent's pull request on this system.",
  )
    .input(exactInput(pullRequestPartParamsSchema))
    .output(eventIterator(type<never>())),
  [AGENT_ACT_KIND.AGENTS_PULL_REQUEST_PART_RETRY]: actProcedure(
    "Could not read the agent's pull request again on this system.",
  )
    .input(exactInput(pullRequestPartParamsSchema))
    .output(EffectSchema.Void),
  // Note that the hold's stream carries nothing: the held tools reach the panel on app state, and the stream is the window's hold on them.
  [AGENT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_FOLLOW]: actProcedure(
    `Could not follow the agent's ${PRODUCT_NAME} tools on this system.`,
  )
    .input(exactInput(agentPullRequestParamsSchema))
    .output(eventIterator(type<never>())),
  [AGENT_ACT_KIND.AGENTS_WORKSPACE_TOOLS_RETRY]: actProcedure(
    `Could not read the agent's ${PRODUCT_NAME} tools again on this system.`,
  )
    .input(exactInput(agentPullRequestParamsSchema))
    .output(EffectSchema.Void),
};
