import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_TOOL,
  type PlanCommentAsked,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { Effect, Option } from "effect";
import type { EveTypedTurn } from "../agents/brain-host/eve-sessions.js";
import { steerCodingAgent } from "../agents/coder-host/steer.js";
import { type EveReach, eveFor } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";

/**
 * comment-ask.ts -- a plan's comment thread sent to one of the task's agents: the words it is handed over in, and the hand-over.
 *
 * A member's \`@\` of one of the task's agents in a comment hands the thread
 * itself over as the request: who wrote what in it, the words of the plan it
 * is on, and what the agent is to do with it, which is to read the thread
 * and the plan and answer in the thread, and nothing more of what it
 * discusses. The agent hears it as a message from the member who sent it,
 * through the one steer path every message to an agent takes
 * (`coder-host/steer.ts`), reaching eve as the request's own caller
 * (`coder-host/stop.ts`'s `eveFor`), never as the plan's owner: over the
 * member's own bearer from the desktop, and from a browser's session cookie
 * as the deployment acting for the member, which the channel admits for a
 * typed message and mints as the member's own principal
 * (`brain-host/auth.ts`'s `DEPLOYMENT_PRESENCE`). It is sent under a key
 * drawn from the one the member's client made for the comment, so a comment
 * sent again is handed over once. A comment that mentions no agent hands
 * nothing to anyone, an \`@\` of Luke among it, and an agent's own reply
 * never does.
 */

/** How long a comment of the thread may run in the words it is handed over in, so a long thread stays a message. */
const COMMENT_CHARS = 2_000;

/** What an ask is handed over with: the plan by its name, the thread, and who sent it. */
export interface CommentAsk {
  readonly taskName: string;
  readonly thread: PlanCommentThread;
  /** The member who sent it, by the name the service holds. */
  readonly sender: string;
}

/** Who wrote an entry, as the words handed over name them: Luke among them only in a thread written before the task's Luke was gone. */
function writerName(entry: PlanCommentThread["entries"][number]): string {
  switch (entry.writer.actor) {
    case PLAN_COMMENT_ACTOR.LUKE:
      return "Luke";
    case PLAN_COMMENT_ACTOR.AGENT:
      return "A coding agent";
    case PLAN_COMMENT_ACTOR.MEMBER:
      return entry.writer.by?.name ?? "A former member";
  }
}

/** A comment's words on one line of the message, cut where they run long. */
function oneComment(words: string): string {
  const flat = words.replace(/\s+/gu, " ").trim();
  return flat.length > COMMENT_CHARS ? `${flat.slice(0, COMMENT_CHARS)}…` : flat;
}

/** The words a thread is handed over in: what it is on, each comment by its writer, and what to do with it. */
export function commentAskMessage(ask: CommentAsk): string {
  const { thread } = ask;
  const where = thread.section === "" ? "" : ` (section "${thread.section}")`;
  const on =
    thread.anchor === undefined
      ? `On words since deleted from the plan: "${thread.quote}"${where}`
      : `On: "${thread.quote}"${where}`;
  const comments = thread.entries
    .filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT && entry.words !== undefined)
    .map((entry) => `${writerName(entry)}: ${oneComment(entry.words ?? "")}`);
  const lead = `${ask.sender} sent you a comment thread on the plan "${ask.taskName}" to answer (thread ${thread.id}).`;
  // Note that the thread is handed over as its quoted words and its comments alone, never the plan or its section, which an agent handed the plan already holds.
  const doing = `Read the thread, then answer in this thread with \`${PLAN_COMMENT_TOOL.REPLY}\` on thread "${thread.id}". Answer what the thread asks; do not act on anything else it discusses.`;
  return [lead, on, "", ...comments, "", doing].join("\n");
}

/** What a hand-over needs: eve as the member reaches it. */
export type CommentAskSeams = EveReach;

/** The agent an ask names, where it is the plan's own and stands; nothing otherwise, which no ask is written for. */
export const askableAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
  to: PlanCommentAsked,
) {
  if (to.actor !== PLAN_COMMENT_ACTOR.AGENT || to.agentId === undefined) return undefined;
  const agent = yield* hostedStoreOrUnavailable(readCodingAgent(userId, to.agentId));
  if (Option.isNone(agent) || agent.value.taskId !== taskId || agent.value.archivedAt !== null) {
    return undefined;
  }
  return agent.value;
});

/** The agent a thread is handed to: the plan's own standing agent, as `askableAgent` read it. */
export type CommentRecipient = NonNullable<Effect.Success<ReturnType<typeof askableAgent>>>;

/**
 * The thread handed to the agent asked, under the member's key, as a message
 * from the member. Fails with the refusal the route answers where it was not.
 */
export const handCommentAskOver = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: CommentAskSeams,
  request: Request,
  input: {
    readonly userId: string;
    readonly to: CommentRecipient;
    readonly clientKey: string;
    readonly text: string;
    /** The asking member's own words, whose servers and links alone the agent's next turn takes up, never another writer's in the thread. */
    readonly words: string;
  },
) {
  const { userId, to, clientKey, text, words } = input;
  const eve = yield* eveFor<EveTypedTurn>(seams, request, userId);
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  yield* steerCodingAgent(eve, writer, userId, to, {
    text,
    serverWords: words,
    clientKey,
    sender: { kind: MESSAGE_SENDER.MEMBER, userId },
  });
});
