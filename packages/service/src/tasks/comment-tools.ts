import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  actOnDescriptionCommentThread,
  DESCRIPTION_COMMENT_OUTCOME,
  type DescriptionCommentOutcome,
  type DescriptionCommentWriterRef,
  readDescriptionCommentThread,
  readDescriptionCommentThreads,
} from "@repo/database/models/description-comments";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentAsked,
  type DescriptionCommentEntry,
  type DescriptionCommentThread,
  type DescriptionCommentThreadAnswer,
  descriptionCommentWordsSchema,
} from "@repo/features/description-comment-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { describeWire, readEither } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import {
  ACTION_RESULT_STATUS,
  EXCESS_KEYS,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { logStoreFailure } from "../http/store-failure.js";

export interface CommentToolBinding {
  readonly taskId: string;
  readonly writer: DescriptionCommentWriterRef;
  readonly descriptionsOn: boolean;
}

export const COMMENT_TOOL_REFUSAL = {
  UNREADABLE: "The input is not one this tool takes.",
  NO_TASK_NAMED: `Name the task whose description's comments to act on as taskId, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  NO_THREAD: "No thread of this description has that id; read_comments lists them.",
  NO_TASK: `No task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  RESOLVED: `The thread is resolved; reopen it with ${AGENT_TOOL.UPDATE_COMMENT} before replying.`,
  UNAVAILABLE: "The comments could not be reached; try again.",
  DESCRIPTIONS_OFF:
    "Task descriptions is off, so the description's comment threads are not reached; a page's threads still are, by the page's id.",
} as const;

const TASK_ID = describeWire(
  wireUuidSchema,
  `The task whose description's comments to act on, your own or another of your workspace, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
);

const THREAD_ID = describeWire(wireUuidSchema, "The thread's id, as read_comments lists it.");

const readCommentedTask = readEither(Schema.Struct({ taskId: wireUuidSchema }), {
  excess: EXCESS_KEYS.DROP,
});

const READ_INPUT = Schema.Struct({
  taskId: TASK_ID,
  page: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `One of the task's pages, by the id ${AGENT_TOOL.SHOW_PAGE} answered or a mention of it names, to read its threads instead of the description's.`,
    ),
  ),
  status: Schema.optionalKey(
    describeWire(
      Schema.Literals(Object.values(DESCRIPTION_COMMENT_STATUS)),
      "Which threads to read: open, the default, or resolved.",
    ),
  ),
});

const REPLY_INPUT = Schema.Struct({
  taskId: TASK_ID,
  thread: THREAD_ID,
  words: describeWire(
    descriptionCommentWordsSchema,
    "The reply, in plain words: what the thread asked of you, answered.",
  ),
});

const UPDATE_INPUT = Schema.Struct({
  taskId: TASK_ID,
  thread: THREAD_ID,
  resolved: describeWire(
    Schema.Boolean,
    "true to resolve the thread once what it asked is settled; false to reopen a resolved one where it is unsettled again.",
  ),
});

export const READ_COMMENTS_TOOL = {
  name: AGENT_TOOL.READ_COMMENTS,
  description:
    "Read the comment threads on the description of the task taskId names, your own task or any other of your workspace, or on one of its pages where you name the page: each thread's id, the words of the description it is on and their section, " +
    "whether those words were since deleted, and every comment with who wrote it, when, and the names of the files it carries. A page's thread names the version it was left on and the element it is on, by its words and its path, or none for the whole page. Open threads unless you ask " +
    "for resolved ones. Reading asks nothing of you: reply only to a thread someone sent you.",
  inputSchema: READ_INPUT,
} as const;

export const REPLY_TO_COMMENT_TOOL = {
  name: AGENT_TOOL.REPLY_TO_COMMENT,
  description:
    "Reply in one comment thread on the description of the task taskId names, by the thread's id, as yourself; every member of the workspace sees it beside " +
    "the words it is on. Reply where someone sent you the thread, answering what it asks; your replies send the thread to no one.",
  inputSchema: REPLY_INPUT,
} as const;

export const UPDATE_COMMENT_TOOL = {
  name: AGENT_TOOL.UPDATE_COMMENT,
  description:
    "Resolve or reopen one comment thread on the description of the task taskId names, by the thread's id: a resolved thread leaves the description's margin " +
    "and stays in its history.",
  inputSchema: UPDATE_INPUT,
} as const;

const COMMENT_TOOLS = [READ_COMMENTS_TOOL, REPLY_TO_COMMENT_TOOL, UPDATE_COMMENT_TOOL] as const;

type CommentTool = (typeof COMMENT_TOOLS)[number];
export type CommentToolName = CommentTool["name"];

export function commentToolRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

export function commentedTaskOf(input: UnparsedWireValue): string | undefined {
  const read = readCommentedTask(input);
  return Result.isSuccess(read) ? read.success.taskId : undefined;
}

function writerOf(entry: DescriptionCommentEntry): string {
  switch (entry.writer.actor) {
    case DESCRIPTION_COMMENT_ACTOR.APP:
      return PRODUCT_NAME;
    case DESCRIPTION_COMMENT_ACTOR.AGENT:
      return entry.writer.agentId === undefined ? "agent" : `agent ${entry.writer.agentId}`;
    case DESCRIPTION_COMMENT_ACTOR.MEMBER:
      return entry.writer.by?.name ?? "a former member";
  }
}

function askedName(asked: DescriptionCommentAsked | undefined): string {
  return asked?.actor === DESCRIPTION_COMMENT_ACTOR.APP
    ? PRODUCT_NAME
    : `agent ${asked?.agentId ?? ""}`;
}

function threadRead(thread: DescriptionCommentThread): WireRecord {
  const comments = thread.entries
    .filter((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT)
    .map((entry) => ({
      by: writerOf(entry),
      at: new Date(entry.at).toISOString(),
      words: entry.words ?? "",
      ...(entry.files === undefined
        ? undefined
        : { files: entry.files.map((file) => ({ name: file.name, type: file.mediaType })) }),
    }));
  const asked = thread.entries
    .filter((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.ASKED && entry.asked !== undefined)
    .map((entry) => ({ by: writerOf(entry), to: askedName(entry.asked) }));
  const where =
    thread.page !== undefined
      ? { page: thread.page }
      : thread.anchor === undefined
        ? { onWordsDeleted: true }
        : undefined;
  return {
    thread: thread.id,
    state: thread.status,
    section: thread.section,
    on: thread.quote,
    ...where,
    comments,
    ...(asked.length === 0 ? undefined : { asked }),
  };
}

export function commentAnswerRead(answer: DescriptionCommentThreadAnswer): WireRecord {
  if ("refused" in answer) return commentToolRejected(answer.refused);
  if ("deleted" in answer) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_THREAD);
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    ...threadRead(answer.thread),
    ...(answer.unsent === undefined ? undefined : { unsent: answer.unsent.map(askedName) }),
  };
}

function written(outcome: DescriptionCommentOutcome): WireRecord {
  if (outcome.status === DESCRIPTION_COMMENT_OUTCOME.NO_TASK)
    return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK);
  if (outcome.status !== DESCRIPTION_COMMENT_OUTCOME.DONE)
    return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_THREAD);
  return commentAnswerRead(outcome.answer);
}

export function descriptionThreadOff(
  thread: DescriptionCommentThread | undefined,
  descriptionsOn: boolean,
): boolean {
  return !descriptionsOn && thread !== undefined && thread.page === undefined;
}

export function runCommentTool(
  name: CommentToolName,
  binding: CommentToolBinding,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const { taskId, writer, descriptionsOn } = binding;
  const act = (thread: string, action: Parameters<typeof actOnDescriptionCommentThread>[3]) =>
    Effect.map(actOnDescriptionCommentThread(writer, taskId, thread, action), written);
  const threadOf = (thread: string) =>
    Effect.map(readDescriptionCommentThread(writer.userId, taskId, thread), Option.getOrUndefined);
  const descriptionOff = (thread: DescriptionCommentThread | undefined) =>
    descriptionThreadOff(thread, descriptionsOn);
  const run = Effect.gen(function* () {
    switch (name) {
      case AGENT_TOOL.READ_COMMENTS: {
        const read = readEither(READ_INPUT)(input);
        if (Result.isFailure(read)) return commentToolRejected(COMMENT_TOOL_REFUSAL.UNREADABLE);
        const { page } = read.success;
        if (page === undefined && !descriptionsOn) {
          return commentToolRejected(COMMENT_TOOL_REFUSAL.DESCRIPTIONS_OFF);
        }
        const status = read.success.status ?? DESCRIPTION_COMMENT_STATUS.OPEN;
        const threads = yield* readDescriptionCommentThreads(writer.userId, taskId, page);
        if (Option.isNone(threads)) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK);
        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          threads: threads.value.filter((thread) => thread.status === status).map(threadRead),
        };
      }
      case AGENT_TOOL.REPLY_TO_COMMENT: {
        const read = readEither(REPLY_INPUT)(input);
        if (Result.isFailure(read)) return commentToolRejected(COMMENT_TOOL_REFUSAL.UNREADABLE);
        const thread = yield* threadOf(read.success.thread);
        if (descriptionOff(thread))
          return commentToolRejected(COMMENT_TOOL_REFUSAL.DESCRIPTIONS_OFF);
        if (thread?.status === DESCRIPTION_COMMENT_STATUS.RESOLVED)
          return commentToolRejected(COMMENT_TOOL_REFUSAL.RESOLVED);
        return yield* act(read.success.thread, {
          action: DESCRIPTION_COMMENT_ACTION.REPLY,
          clientKey: randomUUID(),
          words: read.success.words,
        });
      }
      case AGENT_TOOL.UPDATE_COMMENT: {
        const read = readEither(UPDATE_INPUT)(input);
        if (Result.isFailure(read)) return commentToolRejected(COMMENT_TOOL_REFUSAL.UNREADABLE);
        if (descriptionOff(yield* threadOf(read.success.thread))) {
          return commentToolRejected(COMMENT_TOOL_REFUSAL.DESCRIPTIONS_OFF);
        }
        const action = read.success.resolved
          ? DESCRIPTION_COMMENT_ACTION.RESOLVE
          : DESCRIPTION_COMMENT_ACTION.REOPEN;
        return yield* act(read.success.thread, { action });
      }
    }
  });
  return run.pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(commentToolRejected(COMMENT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

export function openThreadsText(threads: readonly DescriptionCommentThread[]): readonly string[] {
  const open = threads.filter((thread) => thread.status === DESCRIPTION_COMMENT_STATUS.OPEN);
  if (open.length === 0) return [];
  return [OPEN_THREADS_MARKER, ...open.map((thread) => JSON.stringify(threadRead(thread)))];
}

export const OPEN_THREADS_MARKER = "[open comment threads]";
