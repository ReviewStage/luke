import { readAgent } from "@luke/database/models/agent-store";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_TOOL,
  type PlanCommentAsked,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import { PRODUCT_NAME } from "@luke/features/product-name";
import { MESSAGE_CHANNEL } from "@luke/wire";
import { Effect, Option } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { steerAgent } from "../agents/coder-host/steer.js";
import { type EveReach, eveFor } from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";

/**
 * comment-ask.ts -- a plan's comment thread sent to one of the task's agents: the words it is handed over in, and the hand-over.
 *
 * A member's comment hands its thread over to each agent in it, one an \`@\`
 * of the comment's adds among them (`plan-comments-procedures.ts`'s
 * `handedTo`), as the request: who wrote what in it, the words of the plan
 * it is on, and what the agent is to do with it, which is to read the thread
 * and the plan and answer in the thread, and nothing more of what it
 * discusses. The agent hears it as a message from the member who sent it,
 * through the one steer path every message to an agent takes
 * (`coder-host/steer.ts`), reaching eve as the request's own caller
 * (`coder-host/stop.ts`'s `eveFor`), never as the plan's owner: over the
 * member's own bearer from the desktop, and from a browser's session cookie
 * as the deployment acting for the member, which the channel admits for a
 * typed message and mints as the member's own principal
 * (`eve-host/auth.ts`'s `DEPLOYMENT_PRESENCE`). It is sent under a key
 * drawn from the one the member's client made for the comment, so a comment
 * sent again is handed over once. A comment in a thread no agent is in
 * that mentions none hands nothing to anyone, an \`@\` of the app's own name
 * among it, and an agent's own reply never does. The line keeps beside
 * the text what a window draws it by, the member's words, what the thread is
 * on, and the plan or page, so a transcript shows the comment rather than
 * the words the model is handed.
 *
 * A thread on one of the task's pages is handed over the same way, the
 * page's writer in it from the start, in words that name the page, the
 * version the thread was left on, and the element it is on, and ask the
 * agent to show the page's next version where the thread asks for a change.
 */

/** How long a comment of the thread may run in the words it is handed over in, so a long thread stays a message. */
const COMMENT_CHARS = 2_000;

/** What an ask is handed over with: the plan by its task's id and name, the thread, and who sent it. */
export interface CommentAsk {
  /** The task whose plan the thread is on, which the agent's reply names. */
  readonly taskId: string;
  readonly taskName: string;
  readonly thread: PlanCommentThread;
  /** The member who sent it, by the name the service holds. */
  readonly sender: string;
  /** The page a page's thread is on, by its newest version's title and number; none for a thread on the plan. */
  readonly page?: { readonly title: string; readonly newestVersion: number };
}

/** Who wrote an entry, as the words handed over name them: the app's own name among them only in a thread written before the task's own assistant was gone. */
function writerName(entry: PlanCommentThread["entries"][number]): string {
  switch (entry.writer.actor) {
    case PLAN_COMMENT_ACTOR.LUKE:
      return PRODUCT_NAME;
    case PLAN_COMMENT_ACTOR.AGENT:
      return "An agent";
    case PLAN_COMMENT_ACTOR.MEMBER:
      return entry.writer.by?.name ?? "A former member";
  }
}

/** A comment's words on one line of the message, cut where they run long. */
function oneComment(words: string): string {
  const flat = words.replace(/\s+/gu, " ").trim();
  return flat.length > COMMENT_CHARS ? `${flat.slice(0, COMMENT_CHARS)}…` : flat;
}

/** What a thread on the plan is on, as the words handed over say it. */
function planPlace(thread: PlanCommentThread): string {
  const where = thread.section === "" ? "" : ` (section "${thread.section}")`;
  return thread.anchor === undefined
    ? `On words since deleted from the plan: "${thread.quote}"${where}`
    : `On: "${thread.quote}"${where}`;
}

/** What a thread on a page is on, as the words handed over say it: the version it was left on, and its element there, or the whole page. */
function pagePlace(
  thread: PlanCommentThread,
  on: NonNullable<PlanCommentThread["page"]>,
  page: NonNullable<CommentAsk["page"]>,
): string {
  const newest = on.version === page.newestVersion ? "" : `, whose newest is ${page.newestVersion}`;
  const version = `version ${on.version} of page ${on.id}${newest}`;
  if (on.element === undefined) return `On the whole page, ${version}.`;
  const where = thread.section === "" ? "" : ` (section "${thread.section}")`;
  return `On the element \`${on.element}\` of ${version}: "${thread.quote}"${where}`;
}

/** The words a thread is handed over in: what it is on, each comment by its writer, and what to do with it. */
export function commentAskMessage(ask: CommentAsk): string {
  const { thread, page } = ask;
  const comments = thread.entries
    .filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT && entry.words !== undefined)
    .map((entry) => `${writerName(entry)}: ${oneComment(entry.words ?? "")}`);
  const reply = `answer in this thread with \`${PLAN_COMMENT_TOOL.REPLY}\` on thread "${thread.id}" of task "${ask.taskId}"`;
  const only = "Answer what the thread asks; do not act on anything else it discusses.";
  // Note that the thread is handed over as its quoted words and its comments alone, never the plan or its section, which an agent handed the plan already holds.
  if (thread.page === undefined || page === undefined) {
    const lead = `${ask.sender} sent you a comment thread on the plan "${ask.taskName}" to answer (thread ${thread.id}).`;
    return [
      lead,
      planPlace(thread),
      "",
      ...comments,
      "",
      `Read the thread, then ${reply}. ${only}`,
    ].join("\n");
  }
  const lead = `${ask.sender} sent you a comment thread on the page "${page.title}" of the task "${ask.taskName}" to answer (thread ${thread.id}).`;
  const doing = `Read the thread and the page with \`${AGENT_TOOL.READ_PAGE}\`, then ${reply}. Where it asks for a change to the page, show the page's next version with \`${AGENT_TOOL.SHOW_PAGE}\` and page "${thread.page.id}" before you answer. ${only}`;
  return [lead, pagePlace(thread, thread.page, page), "", ...comments, "", doing].join("\n");
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
  const agent = yield* hostedStoreOrUnavailable(readAgent(userId, to.agentId));
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
    /** The comment thread handed over, which the line's row names. */
    readonly threadId: string;
    /** The asking member's own words, whose servers and links alone the agent's next turn takes up, never another writer's in the thread. */
    readonly words: string;
    /** What a window draws the line by in place of the text: the task, what the thread is on, and the page where it is on one. */
    readonly line: {
      readonly taskId: string;
      readonly quote: string | undefined;
      readonly page: { readonly id: string; readonly title: string } | undefined;
    };
  },
) {
  const { userId, to, clientKey, text, threadId, words, line } = input;
  const eve = yield* eveFor<EveTypedTurn>(seams, request, userId);
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  yield* steerAgent(eve, writer, userId, to, {
    text,
    serverWords: words,
    clientKey,
    sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    metadata: {
      channel: MESSAGE_CHANNEL.COMMENT,
      thread_id: threadId,
      task_id: line.taskId,
      ...(line.quote === undefined ? undefined : { quote: line.quote }),
      words,
      ...(line.page === undefined
        ? undefined
        : { page_id: line.page.id, page_title: line.page.title }),
    },
  });
});
