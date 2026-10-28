import type { Agent } from "@luke/database/models/agent-store";
import { isWorkspaceMember } from "@luke/database/models/workspace-store";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import {
  AGENT_BOUNDS,
  AGENT_MESSAGE_LEAD,
  AGENT_STATUS,
  agentMessageReplyLine,
} from "@luke/features/agent-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import { agentName } from "@luke/features/model-label";
import type { WireRecord } from "@luke/wire";
import { describeWire } from "@luke/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  MESSAGE_CHANNEL,
  type UnparsedWireValue,
  wireUuidSchema,
} from "../../core.js";
import type { HostedRefusal } from "../../http/http-effect.js";
import {
  agentToolRejected,
  type CodingAgentCall,
  type CodingAgentToolServices,
  callerTask,
  callerUserId,
  callerWorkspace,
  orStoreRefusal,
} from "../coding-agent-tools.js";
import { workspaceAgent } from "../workspace-agents.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";
import { agentLineSender, steerCodingAgent } from "./steer.js";

/**
 * agent-message.ts -- `message_agent`: one coding agent's message to another of its workspace, shown in the two agents' transcripts alone.
 *
 * The sender's transcript keeps the call; the other agent's takes the
 * message as a line steered into its session: minted for that agent's
 * starter, whose principal its turn runs under, under the sending agent's
 * name (`MESSAGE_SENDER.AGENT`), marked as an agent message
 * (`MESSAGE_CHANNEL.AGENT_MESSAGE`), so its window draws it as the sender's
 * bubble rather than the developer's, and keyed by eve's id for the call,
 * so a call run again sends once. Its words open with who sent it, by the
 * sender's mention link, and close with how to answer, by the sender's id,
 * both written here rather than by the model, so the receiving agent reads
 * them as a colleague's word, never the developer's or Luke's. The message
 * stands in the two transcripts and nowhere else. It reaches any agent of the sender's
 * workspace, on any task, held to what a steer into it is held to; an
 * archived agent, one whose starter has left the workspace, or the sender
 * itself takes none.
 */

/**
 * The room the head and the reply line take of a message's bound, which
 * its words leave free, so the line the other agent receives is never
 * longer than one a member could send.
 */
const MESSAGE_FRAME_ROOM_CHARS = 1_000;

/** The most characters a message's own words may spell. */
const MAX_MESSAGE_WORDS_CHARS = AGENT_BOUNDS.MAX_MESSAGE_CHARS - MESSAGE_FRAME_ROOM_CHARS;

/** Why `message_agent` sent nothing, in words the model can act on. */
export const MESSAGE_AGENT_REFUSAL = {
  UNREADABLE:
    `Not sent: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered, and the message as text of at ` +
    `most ${MAX_MESSAGE_WORDS_CHARS} characters.`,
  SELF: "Not sent: that id is your own; message another agent.",
  NO_AGENT: `Not sent: no coding agent of your workspace has that id; ${AGENT_TOOL.LIST_AGENTS} names them.`,
  ARCHIVED:
    "Not sent: that agent is archived, so it takes no message and is not woken until a member unarchives it.",
  STARTER_LEFT:
    "Not sent: the member who started that agent has left your workspace, so nothing reaches it.",
  NO_SERVICE: "Not sent: this deployment cannot reach the coding agents' service.",
  NOT_PERMITTED:
    "Not sent: that agent runs on its starter's own GitHub token or plan, so only they and their agents can message it.",
  NOT_REACHABLE:
    "Not sent: the GitHub installation connected to the workspace no longer reaches that agent's repository.",
  NOT_READY:
    "Not sent: that agent's session is still coming up; the same message a moment later is taken.",
  RETIRED:
    "Not sent: that agent's session has ended for good, so nothing reaches it; only a new agent goes on from its work.",
  IMAGE_PREPARING:
    "Not sent: that agent's sandbox image is still being prepared; the same message in a minute or two is taken.",
  PLAN_SIGNED_OUT:
    "Not sent: the plan that pays for that agent is signed out, so it cannot run until its starter signs in again in Settings.",
  PLAN_UNREACHABLE:
    "Not sent: the provider of the plan that pays for that agent did not answer; the same message in a minute or two may be taken.",
  PLAN_LIMIT_REACHED:
    "Not sent: the plan that pays for that agent has reached its usage limit; it waits until the limit resets.",
  PLAN_INELIGIBLE:
    "Not sent: the plan that pays for that agent is not eligible to run it, its provider said.",
  UNAVAILABLE: "Not sent: the service could not take the message just now.",
} as const;

/** The refusal's sentence for each hosted refusal a steer may answer; any other is the service down. */
const REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.NOT_PERMITTED, MESSAGE_AGENT_REFUSAL.NOT_PERMITTED],
  [HOSTED_API_ERROR.NOT_FOUND, MESSAGE_AGENT_REFUSAL.NO_AGENT],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, MESSAGE_AGENT_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.AGENT_NOT_READY, MESSAGE_AGENT_REFUSAL.NOT_READY],
  [HOSTED_API_ERROR.AGENT_RETIRED, MESSAGE_AGENT_REFUSAL.RETIRED],
  [HOSTED_API_ERROR.AGENT_IMAGE_PREPARING, MESSAGE_AGENT_REFUSAL.IMAGE_PREPARING],
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT, MESSAGE_AGENT_REFUSAL.PLAN_SIGNED_OUT],
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE, MESSAGE_AGENT_REFUSAL.PLAN_UNREACHABLE],
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED, MESSAGE_AGENT_REFUSAL.PLAN_LIMIT_REACHED],
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE, MESSAGE_AGENT_REFUSAL.PLAN_INELIGIBLE],
]);

const MESSAGE_AGENT_INPUT = Schema.Struct({
  agentId: describeWire(
    wireUuidSchema,
    `The agent's id, as ${AGENT_TOOL.LIST_AGENTS} answered it or a message from it named it.`,
  ),
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_MESSAGE_WORDS_CHARS)),
    "What to tell the agent, as a message it reads in its own conversation, short and complete.",
  ),
});

const readMessage = Schema.decodeUnknownResult(MESSAGE_AGENT_INPUT);

/** `message_agent` as a coding agent is offered it: its name, its words, and its input. */
export const MESSAGE_AGENT_TOOL = {
  name: AGENT_TOOL.MESSAGE_AGENT,
  description:
    "Send another coding agent of your workspace a message, by its id, on any task. It lands in that agent's " +
    "conversation under your name, opening with your mention link and closing with how to answer you, and " +
    "only the two of you see it: a running agent reads it at its next step, and an idle one starts a turn on it. " +
    "Answers `accepted` once that agent's session has taken it, without waiting for it to act or reply, or " +
    "`rejected` and why nothing was sent; an archived agent takes nothing.",
  inputSchema: MESSAGE_AGENT_INPUT,
} as const;

/** A steer's refusal in the model's words, with when a plan's reached limit resets where the provider said. */
function refusalWords(refusal: HostedRefusal): string {
  const words = REFUSAL_WORDS.get(refusal.error) ?? MESSAGE_AGENT_REFUSAL.UNAVAILABLE;
  return refusal.resetsAt === undefined
    ? words
    : `${words} It resets at ${new Date(refusal.resetsAt).toISOString()}.`;
}

/** The line the other agent receives: who sent it, by its mention link, the words, and how to answer. */
function messageLine(sender: Agent, senderMention: string, text: string): string {
  const head = `${AGENT_MESSAGE_LEAD} · ${senderMention} to you:`;
  return [head, text, agentMessageReplyLine(sender.id)].join("\n\n");
}

/** One call of `message_agent`: the words handed to another agent of the caller's workspace, or why nothing was sent. */
export function runMessageAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readMessage(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(MESSAGE_AGENT_REFUSAL.UNREADABLE));
  }
  const { agentId, text } = asked.success;
  const { caller } = call;
  const sender = caller.agent;
  if (agentId === sender.id) return Effect.succeed(agentToolRejected(MESSAGE_AGENT_REFUSAL.SELF));
  return orStoreRefusal(
    Effect.gen(function* () {
      const userId = callerUserId(caller);
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) return agentToolRejected(MESSAGE_AGENT_REFUSAL.NO_AGENT);
      const found = yield* workspaceAgent(userId, workspace.value, agentId, sender.id);
      if (Option.isNone(found)) return agentToolRejected(MESSAGE_AGENT_REFUSAL.NO_AGENT);
      const target = found.value;
      if (target.archivedAt !== null) return agentToolRejected(MESSAGE_AGENT_REFUSAL.ARCHIVED);
      // An agent runs as its starter, so one whose starter left the workspace hears nothing of it.
      if (!(yield* isWorkspaceMember(target.userId, workspace.value))) {
        return agentToolRejected(MESSAGE_AGENT_REFUSAL.STARTER_LEFT);
      }
      // The line is minted for the receiving agent's starter, whose principal its turn runs under.
      const eve = call.eveAs?.(target.userId);
      if (eve === undefined) return agentToolRejected(MESSAGE_AGENT_REFUSAL.NO_SERVICE);
      const step = yield* workspaceStepOf(userId, workspace.value);
      const mention = writtenMention(
        { kind: MENTION_KIND.AGENT, agentId: sender.id },
        agentName(sender),
        step,
      );
      const sent = yield* steerCodingAgent(eve, call.writer, userId, target, {
        text: messageLine(sender, mention, text),
        clientKey: call.clientKey,
        sender: agentLineSender(sender),
        metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
      }).pipe(Effect.result);
      if (Result.isFailure(sent)) return agentToolRejected(refusalWords(sent.failure));
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        delivery: sent.success,
        agent: {
          id: target.id,
          title: agentName(target),
          model: target.model,
          status: AGENT_STATUS.RUNNING,
          onYourTask: target.taskId !== null && target.taskId === callerTask(caller),
        },
      };
    }),
  );
}
