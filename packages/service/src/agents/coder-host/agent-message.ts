import { type Agent, readTakeoverPilot } from "@repo/database/models/agent-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_BOUNDS,
  AGENT_KIND,
  AGENT_MESSAGE_LEAD,
  AGENT_STATUS,
  agentMessageReplyLine,
} from "@repo/features/agent-wire";
import { MENTION_KIND } from "@repo/features/mention-link";
import { agentName } from "@repo/features/model-label";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  isRecord,
  MESSAGE_CHANNEL,
  type UnparsedWireValue,
  wireUuidSchema,
} from "../../core.js";
import type { HostedRefusal } from "../../http/http-effect.js";
import {
  type AgentCall,
  type AgentToolServices,
  agentToolRejected,
  callerAgent,
  callerTask,
  callerUserId,
  callerWorkspace,
  orStoreRefusal,
} from "../agent-tools.js";
import { workspaceAgent } from "../workspace-agents.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";
import { agentLineSender, steerAgent } from "./steer.js";

const MESSAGE_FRAME_ROOM_CHARS = 1_000;

export const MAX_MESSAGE_WORDS_CHARS = AGENT_BOUNDS.MAX_MESSAGE_CHARS - MESSAGE_FRAME_ROOM_CHARS;

export const MESSAGE_AGENT_REFUSAL = {
  UNREADABLE: "Not sent: pass an agentId and a text; nothing else is read.",
  MALFORMED_ID:
    `Not sent: agentId is not an agent's id; pass the id ${AGENT_TOOL.LIST_AGENTS} answered, ` +
    "or the one a message from the agent closed with.",
  EMPTY: "Not sent: the text is empty; say what to tell the agent.",
  TOO_LONG: (length: number) =>
    `Not sent: the text is ${length} characters, over the ${MAX_MESSAGE_WORDS_CHARS} one message ` +
    "may spell; cut it to fit, or send it in parts.",
  SELF: "Not sent: that id is your own; message another agent.",
  NOT_AGENT: "Not sent: only a coding agent messages another agent.",
  NO_AGENT: `Not sent: no agent of your workspace has that id; ${AGENT_TOOL.LIST_AGENTS} names them.`,
  ARCHIVED:
    "Not sent: that agent is archived, so it takes no message and is not woken until a member unarchives it.",
  STARTER_LEFT:
    "Not sent: the member who started that agent has left your workspace, so nothing reaches it.",
  NOT_PERMITTED:
    "Not sent: that agent runs on its starter's own GitHub token or plan, so only they and their agents can message it.",
  NOT_REACHABLE:
    "Not sent: the GitHub installation connected to the workspace no longer reaches that agent's repository.",
  NOT_READY:
    "Not sent: that agent's session is still coming up; the same message a moment later is taken.",
  RETIRED:
    "Not sent: that agent's session has ended for good, so nothing reaches it; only a new agent goes on from its work, " +
    `which ${AGENT_TOOL.START_AGENT} starts with that agent's id as its from.`,
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

const REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.NOT_PERMITTED, MESSAGE_AGENT_REFUSAL.NOT_PERMITTED],
  [HOSTED_API_ERROR.NOT_FOUND, MESSAGE_AGENT_REFUSAL.NO_AGENT],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, MESSAGE_AGENT_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.AGENT_NOT_READY, MESSAGE_AGENT_REFUSAL.NOT_READY],
  [HOSTED_API_ERROR.AGENT_RETIRED, MESSAGE_AGENT_REFUSAL.RETIRED],
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

const readAgentId = Schema.decodeUnknownResult(wireUuidSchema);

function readMessage(
  input: UnparsedWireValue,
): Result.Result<{ readonly agentId: string; readonly text: string }, string> {
  if (!isRecord(input)) return Result.fail(MESSAGE_AGENT_REFUSAL.UNREADABLE);
  const words = input.text ?? input.message;
  if (typeof words !== "string") return Result.fail(MESSAGE_AGENT_REFUSAL.UNREADABLE);
  const agentId = readAgentId(input.agentId);
  if (Result.isFailure(agentId)) return Result.fail(MESSAGE_AGENT_REFUSAL.MALFORMED_ID);
  const text = words.trim();
  if (text.length === 0) return Result.fail(MESSAGE_AGENT_REFUSAL.EMPTY);
  if (text.length > MAX_MESSAGE_WORDS_CHARS) {
    return Result.fail(MESSAGE_AGENT_REFUSAL.TOO_LONG(text.length));
  }
  return Result.succeed({ agentId: agentId.success, text });
}

export const MESSAGE_AGENT_TOOL = {
  name: AGENT_TOOL.MESSAGE_AGENT,
  description:
    "Send another agent of your workspace a message, by its id, on any task. It lands in that agent's " +
    "conversation under your name, opening with your mention link and closing with how to answer you, and " +
    "only the two of you see it: a running agent reads it at its next step, and an idle one starts a turn on it. " +
    "Answers `accepted` once that agent's session has taken it, without waiting for it to act or reply, or " +
    "`rejected` and why nothing was sent; an archived agent takes nothing.",
  inputSchema: MESSAGE_AGENT_INPUT,
} as const;

export function messageRefusalWords(refusal: HostedRefusal): string {
  const words = REFUSAL_WORDS.get(refusal.error) ?? MESSAGE_AGENT_REFUSAL.UNAVAILABLE;
  return refusal.resetsAt === undefined
    ? words
    : `${words} It resets at ${new Date(refusal.resetsAt).toISOString()}.`;
}

function messageLine(sender: Agent, senderMention: string, text: string): string {
  const head = `${AGENT_MESSAGE_LEAD} · ${senderMention} to you:`;
  return [head, text, agentMessageReplyLine(sender.id)].join("\n\n");
}

const receivingAgent = (userId: string, workspaceId: string, target: Agent, senderId: string) =>
  Effect.gen(function* () {
    if (target.archivedAt === null) return Option.some(target);
    if (target.kind !== AGENT_KIND.PILOT) return Option.none<Agent>();
    const pilot = yield* readTakeoverPilot(userId, target.id);
    return Option.filter(
      pilot,
      (agent) => agent.organizationId === workspaceId && agent.id !== senderId,
    );
  });

export function runMessageAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readMessage(input);
  if (Result.isFailure(asked)) return Effect.succeed(agentToolRejected(asked.failure));
  const { agentId, text } = asked.success;
  const { caller } = call;
  const sender = callerAgent(caller);
  if (sender === undefined) {
    return Effect.succeed(agentToolRejected(MESSAGE_AGENT_REFUSAL.NOT_AGENT));
  }
  if (agentId === sender.id) return Effect.succeed(agentToolRejected(MESSAGE_AGENT_REFUSAL.SELF));
  return orStoreRefusal(
    Effect.gen(function* () {
      const userId = callerUserId(caller);
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) return agentToolRejected(MESSAGE_AGENT_REFUSAL.NO_AGENT);
      const found = yield* workspaceAgent(userId, workspace.value, agentId, sender.id);
      if (Option.isNone(found)) return agentToolRejected(MESSAGE_AGENT_REFUSAL.NO_AGENT);
      const receiving = yield* receivingAgent(userId, workspace.value, found.value, sender.id);
      if (Option.isNone(receiving)) return agentToolRejected(MESSAGE_AGENT_REFUSAL.ARCHIVED);
      const target = receiving.value;
      if (!(yield* isWorkspaceMember(target.userId, workspace.value))) {
        return agentToolRejected(MESSAGE_AGENT_REFUSAL.STARTER_LEFT);
      }
      const eve = call.eveAs(target.userId);
      const step = yield* workspaceStepOf(userId, workspace.value);
      const mention = writtenMention(
        { kind: MENTION_KIND.AGENT, agentId: sender.id },
        agentName(sender),
        step,
      );
      const sent = yield* steerAgent(eve, call.writer, userId, target, {
        text: messageLine(sender, mention, text),
        clientKey: call.clientKey,
        sender: agentLineSender(sender),
        metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
      }).pipe(Effect.result);
      if (Result.isFailure(sent)) return agentToolRejected(messageRefusalWords(sent.failure));
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
