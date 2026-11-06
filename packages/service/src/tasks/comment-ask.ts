import { readAgent } from "@repo/database/models/agent-store";
import { storeWriter } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_TOOL,
  type DescriptionCommentAsked,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { EXPERIMENT } from "@repo/settings";
import { MESSAGE_CHANNEL } from "@repo/wire";
import { Effect, Option } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { steerAgent } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { TypedTurn } from "../agents/sessions/agent-sessions.js";
import { experimentOnIn } from "../agents/workspace-experiment-on.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";

/**
 * comment-ask.ts -- a description's comment thread sent to one of the task's agents: the words it is handed over in, and the hand-over.
 *
 * A member's comment hands its thread over to each agent in it, one an `@`
 * of the comment's adds among them (`description-comments-procedures.ts`'s
 * `handedTo`), as the request: who wrote what in it, the words of the description
 * it is on, and what the agent is to do with it, which is to read the thread
 * and the description and answer in the thread, and nothing more of what it
 * discusses. The agent hears it as a message from the member who sent it,
 * through the one steer path every message to an agent takes
 * (`coder-host/steer.ts`), for the member the request resolved to, never as
 * the plan's owner. It is sent under a key
 * drawn from the one the member's client made for the comment, so a comment
 * sent again is handed over once. A comment in a thread no agent is in
 * that mentions none hands nothing to anyone, an `@` of the app's own name
 * among it, and an agent's own reply never does. The line keeps beside
 * the text what a window draws it by, the member's words, what the thread is
 * on, and the description or page, so a transcript shows the comment rather than
 * the words the model is handed.
 *
 * A thread on one of the task's pages is handed over the same way, the
 * page's writer in it from the start, in words that name the page, the
 * version the thread was left on, and the element it is on, and ask the
 * agent to show the page's next version where the thread asks for a change.
 * A member's review of a page, the threads they gathered on it and sent
 * together, is handed to each agent in any of them as one message naming
 * every thread (`reviewAskMessage`), so the agent revises the page once.
 */

/** How long a comment of the thread may run in the words it is handed over in, so a long thread stays a message. */
const COMMENT_CHARS = 2_000;

/** What an ask is handed over with: the description by its task's id and name, the thread, and who sent it. */
export interface CommentAsk {
  /** The task whose description the thread is on, which the agent's reply names. */
  readonly taskId: string;
  readonly taskName: string;
  readonly thread: DescriptionCommentThread;
  /** The member who sent it, by the name the service holds. */
  readonly sender: string;
  /** The page a page's thread is on, by its newest version's title and number; none for a thread on the description. */
  readonly page?: { readonly title: string; readonly newestVersion: number };
}

/** Who wrote an entry, as the words handed over name them: the app's own name among them only in a thread written before the task's own assistant was gone. */
function writerName(entry: DescriptionCommentThread["entries"][number]): string {
  switch (entry.writer.actor) {
    case DESCRIPTION_COMMENT_ACTOR.APP:
      return PRODUCT_NAME;
    case DESCRIPTION_COMMENT_ACTOR.AGENT:
      return "An agent";
    case DESCRIPTION_COMMENT_ACTOR.MEMBER:
      return entry.writer.by?.name ?? "A former member";
  }
}

/** A comment's words on one line of the message, cut where they run long. */
function oneComment(words: string): string {
  const flat = words.replace(/\s+/gu, " ").trim();
  return flat.length > COMMENT_CHARS ? `${flat.slice(0, COMMENT_CHARS)}…` : flat;
}

/** What a thread on the description is on, as the words handed over say it. */
function descriptionPlace(thread: DescriptionCommentThread): string {
  const where = thread.section === "" ? "" : ` (section "${thread.section}")`;
  return thread.anchor === undefined
    ? `On words since deleted from the description: "${thread.quote}"${where}`
    : `On: "${thread.quote}"${where}`;
}

/** What a thread on a page is on, as the words handed over say it: the version it was left on, and its element there, or the whole page. */
function pagePlace(
  thread: DescriptionCommentThread,
  on: NonNullable<DescriptionCommentThread["page"]>,
  page: NonNullable<CommentAsk["page"]>,
): string {
  const newest = on.version === page.newestVersion ? "" : `, whose newest is ${page.newestVersion}`;
  const version = `version ${on.version} of page ${on.id}${newest}`;
  if (on.element === undefined) return `On the whole page, ${version}.`;
  const where = thread.section === "" ? "" : ` (section "${thread.section}")`;
  return `On the element \`${on.element}\` of ${version}: "${thread.quote}"${where}`;
}

/** A thread's comments as the words handed over say them, one a line, each by its writer. */
function commentLines(thread: DescriptionCommentThread): readonly string[] {
  return thread.entries
    .filter(
      (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT && entry.words !== undefined,
    )
    .map((entry) => `${writerName(entry)}: ${oneComment(entry.words ?? "")}`);
}

/** The words a thread is handed over in: what it is on, each comment by its writer, and what to do with it. */
export function commentAskMessage(ask: CommentAsk): string {
  const { thread, page } = ask;
  const comments = commentLines(thread);
  const reply = `answer in this thread with \`${DESCRIPTION_COMMENT_TOOL.REPLY}\` on thread "${thread.id}" of task "${ask.taskId}"`;
  const only = "Answer what the thread asks; do not act on anything else it discusses.";
  // Note that the thread is handed over as its quoted words and its comments alone, never the description or its section, which an agent handed the description already holds.
  if (thread.page === undefined || page === undefined) {
    const lead = `${ask.sender} sent you a comment thread on the description of "${ask.taskName}" to answer (thread ${thread.id}).`;
    return [
      lead,
      descriptionPlace(thread),
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

/** What a review is handed over with: the threads of one page a member sent together, in the order they were started. */
export interface ReviewAsk {
  readonly taskId: string;
  readonly taskName: string;
  readonly threads: readonly DescriptionCommentThread[];
  readonly sender: string;
  /** The page the threads are on, by its id and its newest version's title and number. */
  readonly page: { readonly id: string; readonly title: string; readonly newestVersion: number };
}

/**
 * The words a review is handed over in: every thread of it, each by its id,
 * what it is on, and its comments, then what to do with them, which is to
 * answer each in its own thread and, where they ask for changes, to make
 * them all and show the page's next version once.
 */
export function reviewAskMessage(ask: ReviewAsk): string {
  const { threads, page } = ask;
  const lead = `${ask.sender} sent you ${threads.length} comment threads on the page "${page.title}" of the task "${ask.taskName}" together, as one review to answer.`;
  const each = threads.flatMap((thread) => [
    "",
    `Thread ${thread.id}`,
    thread.page === undefined ? descriptionPlace(thread) : pagePlace(thread, thread.page, page),
    ...commentLines(thread),
  ]);
  const doing = `Read the threads and the page with \`${AGENT_TOOL.READ_PAGE}\`, then answer in each thread with \`${DESCRIPTION_COMMENT_TOOL.REPLY}\` on its thread of task "${ask.taskId}". Where they ask for changes to the page, make them all, then show the page's next version once with \`${AGENT_TOOL.SHOW_PAGE}\` and page "${page.id}" before you answer. Answer what the threads ask; do not act on anything else they discuss.`;
  return [lead, ...each, "", doing].join("\n");
}

/**
 * The agent an ask names, where it is the plan's own and stands, and, for a
 * thread on the description rather than a page, where its workspace has Task
 * descriptions on (`workspace-experiment-on.ts`), since an agent with it off
 * is told nothing of the description's comments; nothing otherwise, which no
 * ask is written for.
 */
export const askableAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
  to: DescriptionCommentAsked,
  thread: Pick<DescriptionCommentThread, "page">,
) {
  if (to.actor !== DESCRIPTION_COMMENT_ACTOR.AGENT || to.agentId === undefined) return undefined;
  const agent = yield* hostedStoreOrUnavailable(readAgent(userId, to.agentId));
  if (Option.isNone(agent) || agent.value.taskId !== taskId || agent.value.archivedAt !== null) {
    return undefined;
  }
  if (
    thread.page === undefined &&
    !(yield* experimentOnIn(agent.value.organizationId, EXPERIMENT.DESCRIPTIONS))
  ) {
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
export const handCommentAskOver = /* @__PURE__ */ Effect.fnUntraced(function* (input: {
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
}) {
  const { userId, to, clientKey, text, threadId, words, line } = input;
  const agentSessions = yield* routedSessions<TypedTurn>(userId);
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  yield* steerAgent(agentSessions, writer, userId, to, {
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
