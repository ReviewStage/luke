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
import { MESSAGE_CHANNEL } from "@repo/wire";
import { Effect, Option } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { steerAgent } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { EveTypedTurn } from "../agents/eve-host/eve-sessions.js";
import { descriptionsOnFor } from "../agents/descriptions-on.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";

const COMMENT_CHARS = 2_000;

export interface CommentAsk {
  readonly taskId: string;
  readonly taskName: string;
  readonly thread: DescriptionCommentThread;
  readonly sender: string;
  readonly page?: { readonly title: string; readonly newestVersion: number };
}

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

function oneComment(words: string): string {
  const flat = words.replace(/\s+/gu, " ").trim();
  return flat.length > COMMENT_CHARS ? `${flat.slice(0, COMMENT_CHARS)}…` : flat;
}

function descriptionPlace(thread: DescriptionCommentThread): string {
  const where = thread.section === "" ? "" : ` (section "${thread.section}")`;
  return thread.anchor === undefined
    ? `On words since deleted from the description: "${thread.quote}"${where}`
    : `On: "${thread.quote}"${where}`;
}

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

function commentLines(thread: DescriptionCommentThread): readonly string[] {
  return thread.entries
    .filter(
      (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT && entry.words !== undefined,
    )
    .map((entry) => `${writerName(entry)}: ${oneComment(entry.words ?? "")}`);
}

export function commentAskMessage(ask: CommentAsk): string {
  const { thread, page } = ask;
  const comments = commentLines(thread);
  const reply = `answer in this thread with \`${DESCRIPTION_COMMENT_TOOL.REPLY}\` on thread "${thread.id}" of task "${ask.taskId}"`;
  const only = "Answer what the thread asks; do not act on anything else it discusses.";
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

export interface ReviewAsk {
  readonly taskId: string;
  readonly taskName: string;
  readonly threads: readonly DescriptionCommentThread[];
  readonly sender: string;
  readonly page: { readonly id: string; readonly title: string; readonly newestVersion: number };
}

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
    !(yield* descriptionsOnFor(agent.value.userId, agent.value.kind))
  ) {
    return undefined;
  }
  return agent.value;
});

export type CommentRecipient = NonNullable<Effect.Success<ReturnType<typeof askableAgent>>>;

export const handCommentAskOver = /* @__PURE__ */ Effect.fnUntraced(function* (input: {
  readonly userId: string;
  readonly to: CommentRecipient;
  readonly clientKey: string;
  readonly text: string;
  readonly threadId: string;
  readonly words: string;
  readonly line: {
    readonly taskId: string;
    readonly quote: string | undefined;
    readonly page: { readonly id: string; readonly title: string } | undefined;
  };
}) {
  const { userId, to, clientKey, text, threadId, words, line } = input;
  const eve = yield* routedSessions<EveTypedTurn>(userId);
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
