/**
 * agents.ts -- the Tasks tab's core asks of the host about a task's coding agents, as procedures.
 *
 * A kind that carries nothing takes `undefined` alone, so a window calls it
 * with no payload and one sent anything is refused, as `app:act` refused it.
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * row's value into what crosses the port, as the issue acts' do.
 */

import {
  codingAgentAgentAnswerSchema,
  codingAgentArchiveParamsSchema,
  codingAgentChooseParamsSchema,
  codingAgentDefaultAnswerViewSchema,
  codingAgentDefaultWriteParamsSchema,
  codingAgentListAnswerViewSchema,
  codingAgentListParamsSchema,
  codingAgentMessageParamsSchema,
  codingAgentMessagesAnswerViewSchema,
  codingAgentMessagesParamsSchema,
  codingAgentModelsAnswerSchema,
  codingAgentPageAnswerViewSchema,
  codingAgentPageParamsSchema,
  codingAgentPinParamsSchema,
  codingAgentRenameParamsSchema,
  codingAgentServersParamsSchema,
  codingAgentStartParamsSchema,
  codingAgentStopParamsSchema,
  codingAgentWorkspaceListParamsSchema,
} from "@luke/features/coding-agent-view";
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

/**
 * The Chat the panel has on screen: a workspace's whole Chat, where the
 * plan is none, or one task's Chat tab, which shows only its plan's channel.
 */
const chatShownSchema = EffectSchema.Struct({
  workspaceId: exactId,
  taskId: EffectSchema.NullOr(exactId),
});

export type ChatShown = typeof chatShownSchema.Type;

/** Which agent's tab, which task's Inbox, and which Chat the panel shows. */
const shownParamsSchema = EffectSchema.Struct({
  agentId: EffectSchema.NullOr(exactId),
  inboxTaskId: EffectSchema.NullOr(exactId),
  /** The Chat on screen: a workspace's whole Chat, the plan none, or a task's Chat tab on its plan's channel; none where no Chat is. */
  chatShown: EffectSchema.optionalKey(EffectSchema.NullOr(chatShownSchema)),
});

export const agentActsContract = {
  [AGENT_ACT_KIND.CODING_AGENTS_MODELS]: actProcedure("Could not read the models on this system.")
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(codingAgentModelsAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_READ]: actProcedure(
    "Could not read the default model on this system.",
  )
    .input(exactInput(EffectSchema.Undefined))
    .output(EffectSchema.flip(codingAgentDefaultAnswerViewSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_DEFAULT_WRITE]: actProcedure(
    "Could not change the default model on this system.",
  )
    .input(exactInput(codingAgentDefaultWriteParamsSchema))
    .output(EffectSchema.flip(codingAgentDefaultAnswerViewSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_LIST]: actProcedure(
    "Could not read the task's agents on this system.",
  )
    .input(exactInput(codingAgentListParamsSchema))
    .output(EffectSchema.flip(codingAgentListAnswerViewSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_WORKSPACE_LIST]: actProcedure(
    "Could not read the workspace's agents on this system.",
  )
    .input(exactInput(codingAgentWorkspaceListParamsSchema))
    .output(EffectSchema.flip(codingAgentListAnswerViewSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_START]: actProcedure("Could not start an agent on this system.")
    .input(exactInput(codingAgentStartParamsSchema))
    .output(EffectSchema.flip(codingAgentAgentAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_MESSAGES]: actProcedure(
    "Could not read the agent's transcript on this system.",
  )
    .input(exactInput(codingAgentMessagesParamsSchema))
    .output(EffectSchema.flip(codingAgentMessagesAnswerViewSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_MESSAGE]: actProcedure(
    "Could not message the agent on this system.",
  )
    .input(exactInput(codingAgentMessageParamsSchema))
    .output(EffectSchema.flip(codingAgentAgentAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_CHOOSE]: actProcedure(
    "Could not change the agent's model on this system.",
  )
    .input(exactInput(codingAgentChooseParamsSchema))
    .output(EffectSchema.flip(codingAgentAgentAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_RENAME]: actProcedure("Could not rename the agent on this system.")
    .input(exactInput(codingAgentRenameParamsSchema))
    .output(EffectSchema.flip(codingAgentAgentAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_SERVERS]: actProcedure(
    "Could not switch the agent's MCP servers on this system.",
  )
    .input(exactInput(codingAgentServersParamsSchema))
    .output(EffectSchema.flip(codingAgentAgentAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_STOP]: actProcedure("Could not stop the agent on this system.")
    .input(exactInput(codingAgentStopParamsSchema))
    .output(EffectSchema.flip(codingAgentAgentAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_ARCHIVE]: actProcedure(
    "Could not archive the agent on this system.",
  )
    .input(exactInput(codingAgentArchiveParamsSchema))
    .output(EffectSchema.flip(codingAgentAgentAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_PIN]: actProcedure("Could not pin the agent on this system.")
    .input(exactInput(codingAgentPinParamsSchema))
    .output(EffectSchema.flip(codingAgentAgentAnswerSchema)),
  [AGENT_ACT_KIND.CODING_AGENTS_SHOWN]: actProcedure(
    "Could not note which agent is shown on this system.",
  )
    .input(exactInput(shownParamsSchema))
    .output(EffectSchema.Void),
  [AGENT_ACT_KIND.CODING_AGENTS_PAGE]: actProcedure("Could not read the agent on this system.")
    .input(exactInput(codingAgentPageParamsSchema))
    .output(EffectSchema.flip(codingAgentPageAnswerViewSchema)),
};
