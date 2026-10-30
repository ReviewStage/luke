import { randomUUID } from "node:crypto";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  actOnPlanCommentThread,
  PLAN_COMMENT_OUTCOME,
  type PlanCommentOutcome,
  type PlanCommentWriterRef,
  readPlanCommentThreads,
} from "@luke/database/models/plan-comments";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_STATUS,
  type PlanCommentEntry,
  type PlanCommentThread,
  planCommentWordsSchema,
} from "@luke/features/plan-comment-wire";
import { describeWire, readEither } from "@luke/wire/effect";
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

/**
 * comment-tools.ts -- a plan's comments as the coding agents read and answer them: one implementation of `read_comments`, `reply_to_comment`, `resolve_thread`, and `reopen_thread`.
 *
 * An agent reads the threads for context at any time, but replies only where
 * someone sent a thread to it (`comment-ask.ts`), which its instructions say;
 * resolving and reopening are any agent's, as they are any member's. Every
 * call names the task whose plan it acts on, the agent's own or any other of
 * its workspace, which the door holds to that workspace
 * (`../agents/coder-host/agent-doors.ts`), so an agent on no task answers a
 * thread too. It runs on the plan the door bound, as the member whose turn
 * it is, and is written under the agent that made it, by its id. A call
 * answers what it did as the model reads it, never a failure.
 */

/** Where a call reads and writes: the plan the door bound, and who writes, the member whose turn it is and the agent. */
export interface CommentToolBinding {
  readonly taskId: string;
  readonly writer: PlanCommentWriterRef;
}

/** Why a call took nothing, in the words its result says. */
export const COMMENT_TOOL_REFUSAL = {
  UNREADABLE: "The input is not one this tool takes.",
  NO_TASK_NAMED: `Name the task whose plan's comments to act on as taskId, by the id ${AGENT_TOOL.LIST_TASKS} answered.`,
  NO_THREAD: "No thread of this plan has that id; read_comments lists them.",
  NO_TASK: `No task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  RESOLVED: "The thread is resolved; reopen it before replying.",
  UNAVAILABLE: "The comments could not be reached; try again.",
} as const;

/** The task a call names, whose plan's comments it acts on. */
const TASK_ID = describeWire(
  wireUuidSchema,
  `The task whose plan's comments to act on, your own or another of your workspace, by the id ${AGENT_TOOL.LIST_TASKS} answered or a mention of it names.`,
);

const THREAD_ID = describeWire(wireUuidSchema, "The thread's id, as read_comments lists it.");

// The call's other fields stand beside its task, and are read on their own.
const readCommentedTask = readEither(Schema.Struct({ taskId: wireUuidSchema }), {
  excess: EXCESS_KEYS.DROP,
});

const READ_INPUT = Schema.Struct({
  taskId: TASK_ID,
  status: Schema.optionalKey(
    describeWire(
      Schema.Literals(Object.values(PLAN_COMMENT_STATUS)),
      "Which threads to read: open, the default, or resolved.",
    ),
  ),
});

const REPLY_INPUT = Schema.Struct({
  taskId: TASK_ID,
  thread: THREAD_ID,
  words: describeWire(
    planCommentWordsSchema,
    "The reply, in plain words: what the thread asked of you, answered.",
  ),
});

const THREAD_INPUT = Schema.Struct({ taskId: TASK_ID, thread: THREAD_ID });

/** `read_comments`: the plan's threads as they stand. */
export const READ_COMMENTS_TOOL = {
  name: AGENT_TOOL.READ_COMMENTS,
  description:
    "Read the comment threads on the plan of the task taskId names, your own task or any other of your workspace: each thread's id, the words of the plan it is on and their section, " +
    "whether those words were since deleted, and every comment with who wrote it, when, and the names of the files it carries. Open threads unless you ask " +
    "for resolved ones. Reading asks nothing of you: reply only to a thread someone sent you.",
  inputSchema: READ_INPUT,
} as const;

/** `reply_to_comment`: an answer in a thread. */
export const REPLY_TO_COMMENT_TOOL = {
  name: AGENT_TOOL.REPLY_TO_COMMENT,
  description:
    "Reply in one comment thread on the plan of the task taskId names, by the thread's id, as yourself; every member of the workspace sees it beside " +
    "the words it is on. Reply where someone sent you the thread, answering what it asks; your replies send the thread to no one.",
  inputSchema: REPLY_INPUT,
} as const;

/** `resolve_thread`: a thread settled. */
export const RESOLVE_THREAD_TOOL = {
  name: AGENT_TOOL.RESOLVE_THREAD,
  description:
    "Resolve one comment thread on the plan of the task taskId names, by the thread's id, once what it asked is settled; it leaves the plan's margin " +
    "and stays in its history.",
  inputSchema: THREAD_INPUT,
} as const;

/** `reopen_thread`: a resolved thread brought back. */
export const REOPEN_THREAD_TOOL = {
  name: AGENT_TOOL.REOPEN_THREAD,
  description:
    "Reopen one resolved comment thread on the plan of the task taskId names, by the thread's id, where what it asked is unsettled again.",
  inputSchema: THREAD_INPUT,
} as const;

/** The four tools, in the order an agent is offered them. */
const COMMENT_TOOLS = [
  READ_COMMENTS_TOOL,
  REPLY_TO_COMMENT_TOOL,
  RESOLVE_THREAD_TOOL,
  REOPEN_THREAD_TOOL,
] as const;

type CommentTool = (typeof COMMENT_TOOLS)[number];
export type CommentToolName = CommentTool["name"];

/** A call that took nothing, and why. */
export function commentToolRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The task a call names, or nothing where it names none that reads, which refuses it whole. */
export function commentedTaskOf(input: UnparsedWireValue): string | undefined {
  const read = readCommentedTask(input);
  return Result.isSuccess(read) ? read.success.taskId : undefined;
}

/** Who wrote an entry, as an agent reads it. */
function writerOf(entry: PlanCommentEntry): string {
  switch (entry.writer.actor) {
    case PLAN_COMMENT_ACTOR.LUKE:
      return "Luke";
    case PLAN_COMMENT_ACTOR.AGENT:
      return entry.writer.agentId === undefined ? "agent" : `agent ${entry.writer.agentId}`;
    case PLAN_COMMENT_ACTOR.MEMBER:
      return entry.writer.by?.name ?? "a former member";
  }
}

/** A thread as an agent reads it: what it is on, its comments, and who was asked to answer it. */
function threadRead(thread: PlanCommentThread): WireRecord {
  const comments = thread.entries
    .filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT)
    .map((entry) => ({
      by: writerOf(entry),
      at: new Date(entry.at).toISOString(),
      words: entry.words ?? "",
      ...(entry.files === undefined
        ? undefined
        : { files: entry.files.map((file) => ({ name: file.name, type: file.mediaType })) }),
    }));
  const asked = thread.entries
    .filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.ASKED && entry.asked !== undefined)
    .map((entry) => ({
      by: writerOf(entry),
      to:
        entry.asked?.actor === PLAN_COMMENT_ACTOR.LUKE
          ? "Luke"
          : `agent ${entry.asked?.agentId ?? ""}`,
    }));
  return {
    thread: thread.id,
    state: thread.status,
    section: thread.section,
    on: thread.quote,
    ...(thread.anchor === undefined ? { onWordsDeleted: true } : undefined),
    comments,
    ...(asked.length === 0 ? undefined : { asked }),
  };
}

/** A write's outcome as the result the model reads. */
function written(outcome: PlanCommentOutcome): WireRecord {
  if (outcome.status === PLAN_COMMENT_OUTCOME.NO_TASK)
    return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK);
  if (outcome.status === PLAN_COMMENT_OUTCOME.NO_THREAD)
    return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_THREAD);
  const { answer } = outcome;
  if ("refused" in answer) return commentToolRejected(answer.refused);
  if ("deleted" in answer) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_THREAD);
  return { status: ACTION_RESULT_STATUS.ACCEPTED, ...threadRead(answer.thread) };
}

/** One call of a comment tool on the plan the door bound, answered as the result the model reads. */
export function runCommentTool(
  name: CommentToolName,
  binding: CommentToolBinding,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const { taskId, writer } = binding;
  const act = (thread: string, action: Parameters<typeof actOnPlanCommentThread>[3]) =>
    Effect.map(actOnPlanCommentThread(writer, taskId, thread, action), written);
  const run = Effect.gen(function* () {
    switch (name) {
      case AGENT_TOOL.READ_COMMENTS: {
        const read = readEither(READ_INPUT)(input);
        if (Result.isFailure(read)) return commentToolRejected(COMMENT_TOOL_REFUSAL.UNREADABLE);
        const status = read.success.status ?? PLAN_COMMENT_STATUS.OPEN;
        const threads = yield* readPlanCommentThreads(writer.userId, taskId);
        if (Option.isNone(threads)) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK);
        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          threads: threads.value.filter((thread) => thread.status === status).map(threadRead),
        };
      }
      case AGENT_TOOL.REPLY_TO_COMMENT: {
        const read = readEither(REPLY_INPUT)(input);
        if (Result.isFailure(read)) return commentToolRejected(COMMENT_TOOL_REFUSAL.UNREADABLE);
        const threads = yield* readPlanCommentThreads(writer.userId, taskId);
        const thread = Option.getOrUndefined(threads)?.find(
          (each) => each.id === read.success.thread,
        );
        if (thread?.status === PLAN_COMMENT_STATUS.RESOLVED)
          return commentToolRejected(COMMENT_TOOL_REFUSAL.RESOLVED);
        return yield* act(read.success.thread, {
          action: PLAN_COMMENT_ACTION.REPLY,
          clientKey: randomUUID(),
          words: read.success.words,
        });
      }
      case AGENT_TOOL.RESOLVE_THREAD:
      case AGENT_TOOL.REOPEN_THREAD: {
        const read = readEither(THREAD_INPUT)(input);
        if (Result.isFailure(read)) return commentToolRejected(COMMENT_TOOL_REFUSAL.UNREADABLE);
        const action =
          name === AGENT_TOOL.RESOLVE_THREAD
            ? PLAN_COMMENT_ACTION.RESOLVE
            : PLAN_COMMENT_ACTION.REOPEN;
        return yield* act(read.success.thread, { action });
      }
    }
  });
  return run.pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(commentToolRejected(COMMENT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

/**
 * The plan's open threads as Luke is handed them every turn, beside the
 * saved document: one line each, read again every turn, so a comment a
 * member left since his last turn is there to raise. Nothing where the plan
 * holds no open thread.
 */
export function openThreadsText(threads: readonly PlanCommentThread[]): readonly string[] {
  const open = threads.filter((thread) => thread.status === PLAN_COMMENT_STATUS.OPEN);
  if (open.length === 0) return [];
  return [OPEN_THREADS_MARKER, ...open.map((thread) => JSON.stringify(threadRead(thread)))];
}

/** The marker the open threads ride behind in Luke's standing context. */
export const OPEN_THREADS_MARKER = "[open comment threads]";
