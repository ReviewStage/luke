import { randomUUID } from "node:crypto";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import { type CommentSpan, spanWithin, textChange } from "@luke/features/plan-comment-anchor";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_REFUSAL,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentActionRequest,
  type PlanCommentAnchors,
  type PlanCommentAsked,
  type PlanCommentAskRequest,
  type PlanCommentEntry,
  type PlanCommentEntryKind,
  type PlanCommentFile,
  type PlanCommentRefusal,
  type PlanCommentStartRequest,
  type PlanCommentThread,
  type PlanCommentThreadAnswer,
} from "@luke/features/plan-comment-wire";
import { planSections } from "@luke/features/plan-document";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import { user } from "../schemas/auth.js";
import { planComment, planCommentThread } from "../schemas/plan-comment.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * plan-comments.ts -- a plan's comment threads: read them, start one, answer, edit, resolve, reopen, and delete, and move every anchor with its words as the plan's text is saved.
 *
 * Every member of the plan's workspace reads and writes every thread, and
 * every agent on the task writes as the member whose turn it is; an account
 * outside the workspace reads no plan here, exactly as in `task-store.ts`.
 * Each write takes the plan row's lock first, as the plan's own save does,
 * so a thread started while the text is saved lands on the text as saved. A comment
 * is edited or deleted only by its writer; the rest, resolving and reopening
 * and deleting a whole thread among them, is any member's or agent's.
 *
 * A thread's anchor is offsets into the plan's text (`schemas/plan-comment.ts`).
 * A thread is started over the text the client measured it in, carried over
 * to the text as saved; every save of the text carries every anchor over the
 * change (`movePlanCommentAnchors`), and where the developer's open editor
 * reports where its anchors stand, those are taken instead for the threads
 * it carried, which is how undo brings an anchor back with its words.
 *
 * A comment's files are rows of the shared attachment table owned by the
 * comment (`schemas/attachment.ts`), written in the same transaction as the
 * comment, so no reader sees one without the other, and deleted with it by
 * the comment's cascade. Each names the plan and its workspace beside the
 * comment, so it moves with the plan, and is read back by any member of
 * that workspace (`readPlanCommentFile`).
 */

/**
 * Who writes to a thread: the account it acts for, and whether it is that
 * member or a coding agent on it. Luke is read back from entries written
 * while a task had one, and nothing writes as him now.
 */
export type PlanCommentWriterRef =
  | { readonly actor: typeof PLAN_COMMENT_ACTOR.MEMBER; readonly userId: string }
  | {
      readonly actor: typeof PLAN_COMMENT_ACTOR.AGENT;
      readonly userId: string;
      readonly agentId: string;
    };

/** What a write to a plan's comments came to: done, with what it answers, or no plan or thread the account reaches. */
export const PLAN_COMMENT_OUTCOME = {
  DONE: "done",
  NO_TASK: "no-plan",
  NO_THREAD: "no-thread",
} as const;

export type PlanCommentOutcome =
  | { readonly status: typeof PLAN_COMMENT_OUTCOME.DONE; readonly answer: PlanCommentThreadAnswer }
  | { readonly status: typeof PLAN_COMMENT_OUTCOME.NO_TASK }
  | { readonly status: typeof PLAN_COMMENT_OUTCOME.NO_THREAD };

/** Where one thread stands, without what it says: what a held read compares between looks. */
export interface PlanCommentStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: string;
  readonly updatedAt: number;
}

const ThreadRowSchema = Schema.Struct({
  id: Schema.String,
  scope: Schema.Literals(Object.values(PLAN_COMMENT_SCOPE)),
  quote: Schema.String,
  anchorFrom: Schema.NullOr(Schema.Number),
  anchorTo: Schema.NullOr(Schema.Number),
  section: Schema.String,
  status: Schema.Literals(Object.values(PLAN_COMMENT_STATUS)),
  revision: Schema.Number,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type ThreadRow = typeof ThreadRowSchema.Type;

const THREAD_COLUMNS = {
  id: planCommentThread.id,
  scope: planCommentThread.scope,
  quote: planCommentThread.quote,
  anchorFrom: planCommentThread.anchorFrom,
  anchorTo: planCommentThread.anchorTo,
  section: planCommentThread.section,
  status: planCommentThread.status,
  revision: planCommentThread.revision,
  createdAt: planCommentThread.createdAt,
  updatedAt: planCommentThread.updatedAt,
};

const EntryRowSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  kind: Schema.Literals(Object.values(PLAN_COMMENT_ENTRY)),
  actor: Schema.Literals(Object.values(PLAN_COMMENT_ACTOR)),
  userId: Schema.NullOr(Schema.String),
  userName: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  words: Schema.NullOr(Schema.String),
  askedActor: Schema.NullOr(Schema.Literals(Object.values(PLAN_COMMENT_ACTOR))),
  askedAgentId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  editedAt: Schema.NullOr(InstantColumnSchema),
});

type EntryRow = typeof EntryRowSchema.Type;

const ENTRY_COLUMNS = {
  id: planComment.id,
  threadId: planComment.threadId,
  kind: planComment.kind,
  actor: planComment.actor,
  userId: planComment.userId,
  userName: user.name,
  agentId: planComment.agentId,
  words: planComment.words,
  askedActor: planComment.askedActor,
  askedAgentId: planComment.askedAgentId,
  createdAt: planComment.createdAt,
  editedAt: planComment.editedAt,
};

/** The plan's text and workspace under its row's lock, where the account reaches the plan; nothing otherwise. */
const lockOpenPlanText = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ text: Schema.String, organizationId: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ text: task.document, organizationId: task.organizationId })
        .from(task)
        .where(reachableTask(userId, taskId))
        .for("update"),
    ),
});

/** The plan's id, where the account reaches it. */
const findReachableTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db.select({ id: task.id }).from(task).where(reachableTask(userId, taskId)),
    ),
});

const findThreads = SqlSchema.findAll({
  Request: Schema.Struct({
    taskId: Schema.String,
    ids: Schema.optional(Schema.Array(Schema.String)),
  }),
  Result: ThreadRowSchema,
  execute: ({ taskId, ids }) =>
    Database.use((db) =>
      db
        .select(THREAD_COLUMNS)
        .from(planCommentThread)
        .where(
          and(
            eq(planCommentThread.taskId, taskId),
            ids === undefined ? undefined : inArray(planCommentThread.id, [...ids]),
          ),
        )
        .orderBy(asc(planCommentThread.createdAt), asc(planCommentThread.id)),
    ),
});

const findEntries = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String, threadIds: Schema.Array(Schema.String) }),
  Result: EntryRowSchema,
  execute: ({ taskId, threadIds }) =>
    Database.use((db) =>
      db
        .select(ENTRY_COLUMNS)
        .from(planComment)
        .leftJoin(user, eq(user.id, planComment.userId))
        .where(and(eq(planComment.taskId, taskId), inArray(planComment.threadId, [...threadIds])))
        .orderBy(asc(planComment.threadId), asc(planComment.seq)),
    ),
});

const findStamps = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    revision: Schema.Number,
    status: Schema.String,
    updatedAt: InstantColumnSchema,
  }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({
          id: planCommentThread.id,
          revision: planCommentThread.revision,
          status: planCommentThread.status,
          updatedAt: planCommentThread.updatedAt,
        })
        .from(planCommentThread)
        .innerJoin(task, eq(task.id, planCommentThread.taskId))
        .where(and(eq(planCommentThread.taskId, taskId), taskReachableBy(userId))),
    ),
});

const countThreads = SqlSchema.findOne({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ count: Schema.Number }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(planCommentThread)
        .where(eq(planCommentThread.taskId, taskId)),
    ),
});

const findKeyedThread = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, clientKey: Schema.String }),
  Result: Schema.Struct({ threadId: Schema.String }),
  execute: ({ taskId, clientKey }) =>
    Database.use((db) =>
      db
        .select({ threadId: planComment.threadId })
        .from(planComment)
        .where(and(eq(planComment.taskId, taskId), eq(planComment.clientKey, clientKey))),
    ),
});

/** The entry a key was written under: its thread, its kind, and whom it asked, where it is an ask. */
const findKeyedEntry = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, clientKey: Schema.String }),
  Result: Schema.Struct({
    threadId: Schema.String,
    kind: Schema.String,
    askedActor: Schema.NullOr(Schema.String),
    askedAgentId: Schema.NullOr(Schema.String),
  }),
  execute: ({ taskId, clientKey }) =>
    Database.use((db) =>
      db
        .select({
          threadId: planComment.threadId,
          kind: planComment.kind,
          askedActor: planComment.askedActor,
          askedAgentId: planComment.askedAgentId,
        })
        .from(planComment)
        .where(and(eq(planComment.taskId, taskId), eq(planComment.clientKey, clientKey))),
    ),
});

const FileRowSchema = Schema.Struct({
  id: Schema.String,
  planCommentId: Schema.String,
  name: Schema.String,
  contentType: Schema.String,
});

type FileRow = typeof FileRowSchema.Type;

/** The files the named comments carry, without their bytes, each comment's in the order they were attached. */
const findFiles = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String, entryIds: Schema.Array(Schema.String) }),
  Result: FileRowSchema,
  execute: ({ taskId, entryIds }) =>
    Database.use((db) =>
      db
        .select({
          id: attachment.id,
          planCommentId: sql<string>`${attachment.planCommentId}`,
          name: sql<string>`${attachment.name}`,
          contentType: attachment.contentType,
        })
        .from(attachment)
        .where(and(eq(attachment.taskId, taskId), inArray(attachment.planCommentId, [...entryIds])))
        .orderBy(asc(attachment.planCommentId), asc(attachment.position)),
    ),
});

/** One file a comment of the plan carries, with its bytes, where the account reaches the plan. */
const findCommentFile = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    attachmentId: Schema.String,
  }),
  Result: Schema.Struct({
    contentType: Schema.Literals(Object.values(CODING_AGENT_ATTACHMENT_TYPE)),
    bytes: Schema.Uint8Array,
  }),
  execute: ({ userId, taskId, attachmentId }) =>
    Database.use((db) =>
      db
        .select({ contentType: attachment.contentType, bytes: attachment.bytes })
        .from(attachment)
        .innerJoin(task, eq(task.id, attachment.taskId))
        .where(
          and(
            eq(attachment.taskId, taskId),
            eq(attachment.id, attachmentId),
            isNotNull(attachment.planCommentId),
            taskReachableBy(userId),
          ),
        ),
    ),
});

/** An entry as the wire carries it, each absent field left out rather than null. */
function entryOf(row: EntryRow, files: readonly FileRow[]): PlanCommentEntry {
  const by =
    row.actor === PLAN_COMMENT_ACTOR.MEMBER && row.userId !== null && row.userName !== null
      ? { by: { userId: row.userId, name: row.userName } }
      : undefined;
  const agent = row.agentId === null ? undefined : { agentId: row.agentId };
  const asked: PlanCommentAsked | undefined =
    row.askedActor === PLAN_COMMENT_ACTOR.LUKE
      ? { actor: PLAN_COMMENT_ACTOR.LUKE }
      : row.askedActor === PLAN_COMMENT_ACTOR.AGENT && row.askedAgentId !== null
        ? { actor: PLAN_COMMENT_ACTOR.AGENT, agentId: row.askedAgentId }
        : undefined;
  return {
    id: row.id,
    kind: row.kind,
    writer: { actor: row.actor, ...by, ...agent },
    ...(row.words === null ? undefined : { words: row.words }),
    ...filesOf(row.id, files),
    ...(asked === undefined ? undefined : { asked }),
    at: row.createdAt.getTime(),
    ...(row.editedAt === null ? undefined : { editedAt: row.editedAt.getTime() }),
  };
}

/** The files an entry carries as the wire names them, or nothing where it carries none. */
function filesOf(
  entryId: string,
  files: readonly FileRow[],
): { readonly files: readonly PlanCommentFile[] } | undefined {
  const carried = files
    .filter((file) => file.planCommentId === entryId)
    .map((file) => ({ attachmentId: file.id, name: file.name, mediaType: file.contentType }));
  return carried.length === 0 ? undefined : { files: carried };
}

/** A thread as the wire carries it, with its entries in the order they were written. */
function threadOf(
  row: ThreadRow,
  entries: readonly EntryRow[],
  files: readonly FileRow[] = [],
): PlanCommentThread {
  const anchor =
    row.anchorFrom === null || row.anchorTo === null
      ? undefined
      : { anchor: { from: row.anchorFrom, to: row.anchorTo } };
  return {
    id: row.id,
    scope: row.scope,
    quote: row.quote,
    ...anchor,
    section: row.section,
    status: row.status,
    entries: entries
      .filter((entry) => entry.threadId === row.id)
      .map((entry) => entryOf(entry, files)),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    revision: row.revision,
  };
}

/** The plan's threads, or the ones named, with their entries. */
function threadsOf(taskId: string, ids?: readonly string[]): TaskStoreEffect<PlanCommentThread[]> {
  return Effect.gen(function* () {
    const rows = yield* findThreads(ids === undefined ? { taskId } : { taskId, ids });
    if (rows.length === 0) return [];
    const entries = yield* findEntries({ taskId, threadIds: rows.map((row) => row.id) });
    const comments = entries.filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT);
    const files =
      comments.length === 0
        ? []
        : yield* findFiles({ taskId, entryIds: comments.map((entry) => entry.id) });
    return rows.map((row) => threadOf(row, entries, files));
  });
}

/** The heading of the section a place in the text stands in; empty before the first heading. */
function sectionAt(text: string, offset: number): string {
  return planSections(text).findLast((section) => section.from <= offset)?.heading ?? "";
}

/** The writer's columns of an entry. */
function writerColumns(writer: PlanCommentWriterRef) {
  return {
    actor: writer.actor,
    userId: writer.userId,
    agentId: writer.actor === PLAN_COMMENT_ACTOR.AGENT ? writer.agentId : null,
  };
}

/** Where an entry is written: the plan, its workspace, and the thread. */
interface EntryPlace {
  readonly taskId: string;
  readonly organizationId: string;
  readonly threadId: string;
}

/** A comment's files as the rows it keeps, in the order they were attached. */
function fileRowsOf(
  place: EntryPlace,
  entryId: string,
  userId: string,
  files: readonly CodingAgentAttachment[],
  now: Date,
): Effect.Effect<(typeof attachment.$inferInsert)[]> {
  return Effect.forEach(files, (file, position) => {
    const bytes = Base64.decode(file.data);
    // Note that the wire schema held the data to padded base64, so a decode that fails is a broken contract, not a refusal.
    if (Result.isFailure(bytes)) return Effect.die(new Error("plan comment file is not base64"));
    return Effect.succeed({
      organizationId: place.organizationId,
      userId,
      taskId: place.taskId,
      planCommentId: entryId,
      name: file.name,
      position,
      contentType: file.mediaType,
      byteCount: bytes.success.byteLength,
      bytes: bytes.success,
      createdAt: now,
    });
  });
}

/** One entry written to a thread with the files a comment carries, and the thread moved on, so every reader's cursor moves. */
function writeEntry(
  place: EntryPlace,
  writer: PlanCommentWriterRef,
  entry: {
    readonly kind: PlanCommentEntryKind;
    readonly words?: string;
    readonly clientKey?: string;
    readonly asked?: PlanCommentAsked;
    readonly files?: readonly CodingAgentAttachment[];
  },
  now: Date,
): TaskStoreEffect<void> {
  return Effect.gen(function* () {
    const { taskId, threadId } = place;
    const id = randomUUID();
    const files = yield* fileRowsOf(place, id, writer.userId, entry.files ?? [], now);
    const seq = yield* movedOn(threadId, now);
    yield* Database.use((db) =>
      db.insert(planComment).values({
        id,
        threadId,
        taskId,
        seq,
        kind: entry.kind,
        ...writerColumns(writer),
        words: entry.words ?? null,
        askedActor: entry.asked?.actor ?? null,
        askedAgentId: entry.asked?.agentId ?? null,
        clientKey: entry.clientKey ?? null,
        createdAt: now,
      }),
    );
    if (files.length > 0) yield* Database.use((db) => db.insert(attachment).values(files));
  });
}

/** The thread's revision moved on and its instant set, as every change of it does; answers the revision it moved to. */
function movedOn(
  threadId: string,
  now: Date,
  set: Partial<typeof planCommentThread.$inferInsert> = {},
): TaskStoreEffect<number> {
  return Effect.flatMap(
    Database.use((db) =>
      db
        .update(planCommentThread)
        .set({ ...set, revision: sql`${planCommentThread.revision} + 1`, updatedAt: now })
        .where(eq(planCommentThread.id, threadId))
        .returning({ revision: planCommentThread.revision }),
    ),
    // A thread read under the plan's lock that the update then misses is the database breaking its own contract.
    ([row]) =>
      row === undefined
        ? Effect.die(new Error("plan comment thread vanished"))
        : Effect.succeed(row.revision),
  );
}

/** The thread answered as it now stands. */
function answered(taskId: string, threadId: string): TaskStoreEffect<PlanCommentOutcome> {
  return Effect.map(threadsOf(taskId, [threadId]), ([thread]) =>
    thread === undefined
      ? { status: PLAN_COMMENT_OUTCOME.NO_THREAD }
      : { status: PLAN_COMMENT_OUTCOME.DONE, answer: { thread } },
  );
}

function refused(refusal: PlanCommentRefusal): PlanCommentOutcome {
  return { status: PLAN_COMMENT_OUTCOME.DONE, answer: { refused: refusal } };
}

/** Whether an entry is the writer's own, which only they edit or delete. */
function writtenBy(row: EntryRow, writer: PlanCommentWriterRef): boolean {
  if (row.actor !== writer.actor) return false;
  if (writer.actor === PLAN_COMMENT_ACTOR.AGENT) return row.agentId === writer.agentId;
  return row.userId === writer.userId;
}

/** The plan's threads, oldest first, each with its entries; nothing where the account reaches no such plan. */
export function readPlanCommentThreads(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<readonly PlanCommentThread[]>> {
  return Effect.gen(function* () {
    const reached = yield* findReachableTask({ userId, taskId });
    if (Option.isNone(reached)) return Option.none();
    return Option.some(yield* threadsOf(taskId));
  });
}

/** Where each of the plan's threads stands, read without its words; none where the account reaches no such plan. */
export function planCommentStamps(
  userId: string,
  taskId: string,
): TaskStoreEffect<readonly PlanCommentStamp[]> {
  return Effect.map(findStamps({ userId, taskId }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

/**
 * A thread started on the plan with its first comment, anchored to the words
 * the request measured in its text, carried over to the text as saved.
 * Refused where the plan holds its bound of threads, or where none of the
 * words stand in the text now; the thread a key already started where the
 * request was taken before.
 */
export function startPlanCommentThread(
  writer: PlanCommentWriterRef,
  taskId: string,
  request: PlanCommentStartRequest,
): TaskStoreEffect<PlanCommentOutcome> {
  return inTransaction(
    Effect.gen(function* () {
      const locked = yield* lockOpenPlanText({ userId: writer.userId, taskId });
      if (Option.isNone(locked)) return { status: PLAN_COMMENT_OUTCOME.NO_TASK } as const;
      const taken = yield* findKeyedThread({ taskId, clientKey: request.clientKey });
      if (Option.isSome(taken)) return yield* answered(taskId, taken.value.threadId);
      const { count } = yield* countThreads({ taskId }).pipe(
        Effect.catchTag("NoSuchElementError", Effect.die),
      );
      if (count >= PLAN_COMMENT_BOUNDS.MAX_THREADS_PER_PLAN) {
        return refused(PLAN_COMMENT_REFUSAL.TOO_MANY);
      }
      const text = locked.value.text;
      const anchor = spanWithin(request.anchor, request.text.length)
        ? textChange(request.text, text)(request.anchor)
        : undefined;
      if (anchor === undefined) return refused(PLAN_COMMENT_REFUSAL.NO_WORDS);
      const id = randomUUID();
      const now = yield* DateTime.nowAsDate;
      yield* Database.use((db) =>
        db.insert(planCommentThread).values({
          id,
          taskId,
          scope: request.scope,
          quote: request.quote,
          anchorFrom: anchor.from,
          anchorTo: anchor.to,
          section: sectionAt(text, anchor.from),
          status: PLAN_COMMENT_STATUS.OPEN,
          revision: 0,
          createdAt: now,
          updatedAt: now,
        }),
      );
      const first = {
        kind: PLAN_COMMENT_ENTRY.COMMENT,
        words: request.words,
        clientKey: request.clientKey,
        ...(request.attachments === undefined ? undefined : { files: request.attachments }),
      };
      const place = { taskId, organizationId: locked.value.organizationId, threadId: id };
      yield* writeEntry(place, writer, first, now);
      return yield* answered(taskId, id);
    }),
  );
}

/** One of the thread's entries, by id. */
function entryIn(
  thread: PlanCommentThread,
  entries: readonly EntryRow[],
  id: string,
): EntryRow | undefined {
  return entries.find((entry) => entry.threadId === thread.id && entry.id === id);
}

/** A reply to the thread, taken once under its key; refused where the thread holds its bound of entries. */
function replied(
  place: EntryPlace,
  thread: PlanCommentThread,
  writer: PlanCommentWriterRef,
  reply: {
    readonly words: string;
    readonly clientKey?: string;
    readonly attachments?: readonly CodingAgentAttachment[];
  },
  now: Date,
): TaskStoreEffect<PlanCommentOutcome> {
  return Effect.gen(function* () {
    const { taskId } = place;
    if (reply.clientKey !== undefined) {
      const taken = yield* findKeyedThread({ taskId, clientKey: reply.clientKey });
      if (Option.isSome(taken) && taken.value.threadId !== thread.id) {
        return refused(PLAN_COMMENT_REFUSAL.KEY_TAKEN);
      }
      if (Option.isSome(taken)) return yield* answered(taskId, thread.id);
    }
    const comments = thread.entries.filter((entry) => entry.kind === PLAN_COMMENT_ENTRY.COMMENT);
    if (comments.length >= PLAN_COMMENT_BOUNDS.MAX_ENTRIES_PER_THREAD) {
      return refused(PLAN_COMMENT_REFUSAL.TOO_MANY);
    }
    const entry = {
      kind: PLAN_COMMENT_ENTRY.COMMENT,
      words: reply.words,
      ...(reply.clientKey === undefined ? undefined : { clientKey: reply.clientKey }),
      ...(reply.attachments === undefined ? undefined : { files: reply.attachments }),
    };
    yield* writeEntry(place, writer, entry, now);
    return yield* answered(taskId, thread.id);
  });
}

/** The line saying who sent the thread to whom, written once under its key: what an ask that was handed over leaves in the thread. */
function askedOf(
  place: EntryPlace,
  thread: PlanCommentThread,
  writer: PlanCommentWriterRef,
  ask: { readonly clientKey: string; readonly to: PlanCommentAsked },
  now: Date,
): TaskStoreEffect<PlanCommentOutcome> {
  return Effect.gen(function* () {
    const { taskId } = place;
    // Note that a key answers as a retry only for the same ask of the same thread, so no other entry's key hands the thread over unrecorded.
    const taken = yield* findKeyedEntry({ taskId, clientKey: ask.clientKey });
    if (Option.isSome(taken)) {
      const { threadId, kind, askedActor, askedAgentId } = taken.value;
      const same =
        threadId === thread.id &&
        kind === PLAN_COMMENT_ENTRY.ASKED &&
        askedActor === ask.to.actor &&
        askedAgentId === (ask.to.agentId ?? null);
      return same ? yield* answered(taskId, thread.id) : refused(PLAN_COMMENT_REFUSAL.KEY_TAKEN);
    }
    const entry = { kind: PLAN_COMMENT_ENTRY.ASKED, asked: ask.to, clientKey: ask.clientKey };
    yield* writeEntry(place, writer, entry, now);
    return yield* answered(taskId, thread.id);
  });
}

/** The thread deleted, its entries with it. */
function deletedThread(threadId: string): TaskStoreEffect<PlanCommentOutcome> {
  return Effect.as(
    Database.use((db) => db.delete(planCommentThread).where(eq(planCommentThread.id, threadId))),
    { status: PLAN_COMMENT_OUTCOME.DONE, answer: { deleted: threadId } } as const,
  );
}

/** The thread set resolved or open, with the line saying who did it; a thread already so answers as it stands. */
function settled(
  place: EntryPlace,
  thread: PlanCommentThread,
  writer: PlanCommentWriterRef,
  status: typeof PLAN_COMMENT_STATUS.OPEN | typeof PLAN_COMMENT_STATUS.RESOLVED,
  now: Date,
): TaskStoreEffect<PlanCommentOutcome> {
  return Effect.gen(function* () {
    const { taskId } = place;
    if (thread.status === status) return yield* answered(taskId, thread.id);
    yield* movedOn(thread.id, now, { status });
    // Note that past the bound the change is made and goes unsaid, because a resolve must never be refused, and its lines must not grow a thread without end.
    const lines = thread.entries.filter((entry) => entry.kind !== PLAN_COMMENT_ENTRY.COMMENT);
    if (lines.length < PLAN_COMMENT_BOUNDS.MAX_ENTRIES_PER_THREAD) {
      const kind =
        status === PLAN_COMMENT_STATUS.RESOLVED
          ? PLAN_COMMENT_ENTRY.RESOLVED
          : PLAN_COMMENT_ENTRY.REOPENED;
      yield* writeEntry(place, writer, { kind }, now);
    }
    return yield* answered(taskId, thread.id);
  });
}

/**
 * What a member, Luke, or an agent does to one thread of the plan: answer
 * it, edit or delete a comment of its own (deleting the first deletes the
 * thread), resolve or reopen it, or delete it whole. Nothing where the
 * account reaches no such plan, or the plan no such thread.
 */
export function actOnPlanCommentThread(
  writer: PlanCommentWriterRef,
  taskId: string,
  threadId: string,
  request: PlanCommentActionRequest | PlanCommentAskRequest,
): TaskStoreEffect<PlanCommentOutcome> {
  return inTransaction(
    Effect.gen(function* () {
      const locked = yield* lockOpenPlanText({ userId: writer.userId, taskId });
      if (Option.isNone(locked)) return { status: PLAN_COMMENT_OUTCOME.NO_TASK } as const;
      const [row] = yield* findThreads({ taskId, ids: [threadId] });
      if (row === undefined) return { status: PLAN_COMMENT_OUTCOME.NO_THREAD } as const;
      const entries = yield* findEntries({ taskId, threadIds: [threadId] });
      const thread = threadOf(row, entries);
      const place = { taskId, organizationId: locked.value.organizationId, threadId };
      const now = yield* DateTime.nowAsDate;
      switch (request.action) {
        case PLAN_COMMENT_ACTION.REPLY:
          return yield* replied(place, thread, writer, request, now);
        case PLAN_COMMENT_ACTION.RESOLVE:
          return yield* settled(place, thread, writer, PLAN_COMMENT_STATUS.RESOLVED, now);
        case PLAN_COMMENT_ACTION.REOPEN:
          return yield* settled(place, thread, writer, PLAN_COMMENT_STATUS.OPEN, now);
        case PLAN_COMMENT_ACTION.DELETE_THREAD:
          return yield* deletedThread(threadId);
        case PLAN_COMMENT_ACTION.ASK:
          return yield* askedOf(place, thread, writer, request, now);
        case PLAN_COMMENT_ACTION.EDIT:
        case PLAN_COMMENT_ACTION.DELETE: {
          const entry = entryIn(thread, entries, request.entry);
          if (entry === undefined || entry.kind !== PLAN_COMMENT_ENTRY.COMMENT) {
            return refused(PLAN_COMMENT_REFUSAL.NO_ENTRY);
          }
          if (!writtenBy(entry, writer)) return refused(PLAN_COMMENT_REFUSAL.NOT_YOURS);
          if (request.action === PLAN_COMMENT_ACTION.EDIT) {
            yield* Database.use((db) =>
              db
                .update(planComment)
                .set({ words: request.words, editedAt: now })
                .where(eq(planComment.id, entry.id)),
            );
            yield* movedOn(threadId, now);
            return yield* answered(taskId, threadId);
          }
          const first = entries.find((each) => each.kind === PLAN_COMMENT_ENTRY.COMMENT);
          if (first?.id === entry.id) return yield* deletedThread(threadId);
          yield* Database.use((db) => db.delete(planComment).where(eq(planComment.id, entry.id)));
          yield* movedOn(threadId, now);
          return yield* answered(taskId, threadId);
        }
      }
    }),
  );
}

/**
 * The line an ask wrote taken back, where its hand-over to Luke or the agent
 * did not land, so the thread never says someone was asked who was not.
 */
export function withdrawPlanCommentAsk(taskId: string, clientKey: string): TaskStoreEffect<void> {
  return inTransaction(
    Effect.gen(function* () {
      const taken = yield* findKeyedThread({ taskId, clientKey });
      if (Option.isNone(taken)) return;
      yield* Database.use((db) =>
        db
          .delete(planComment)
          .where(
            and(
              eq(planComment.taskId, taskId),
              eq(planComment.clientKey, clientKey),
              eq(planComment.kind, PLAN_COMMENT_ENTRY.ASKED),
            ),
          ),
      );
      yield* movedOn(taken.value.threadId, yield* DateTime.nowAsDate);
    }),
  );
}

/**
 * One file a comment of the plan carries, its bytes under the type it
 * travelled as, where the account reaches the plan; nothing for a plan of a
 * workspace the account is not in, and for an id that names no comment's
 * file of this plan, a plan's picture among them.
 */
export function readPlanCommentFile(
  userId: string,
  taskId: string,
  attachmentId: string,
): TaskStoreEffect<
  Option.Option<{
    readonly contentType: CodingAgentAttachment["mediaType"];
    readonly bytes: Uint8Array;
  }>
> {
  return findCommentFile({ userId, taskId, attachmentId });
}

/** Where the open editor reported its anchors, in the text it sent. */
export interface ReportedAnchors {
  readonly text: string;
  readonly anchors: PlanCommentAnchors;
}

/**
 * Every anchor of the plan's threads carried over a save of its text from
 * `before` to `after`, resolved threads' among them, so a thread reopened
 * later stands on its words again. An anchor whose every word the save
 * deleted stands nowhere from now on, keeping its quote and its section.
 * Where the developer's editor `reported` its anchors, a thread it carried
 * stands where it reported it, carried over from its text to `after`, or
 * nowhere where it reported none: its words deleted, or brought back by
 * undo. Run inside the save's own transaction, under the plan's lock.
 */
export function movePlanCommentAnchors(
  taskId: string,
  before: string,
  after: string,
  reported?: ReportedAnchors,
): TaskStoreEffect<void> {
  return Effect.gen(function* () {
    const rows = yield* findThreads({ taskId });
    if (rows.length === 0) return;
    const change = textChange(before, after);
    const fromReport = reported === undefined ? undefined : textChange(reported.text, after);
    const carried = new Set(reported?.anchors.carried ?? []);
    const now = yield* DateTime.nowAsDate;
    for (const row of rows) {
      const was: CommentSpan | undefined =
        row.anchorFrom === null || row.anchorTo === null
          ? undefined
          : { from: row.anchorFrom, to: row.anchorTo };
      let moved: CommentSpan | undefined;
      if (reported !== undefined && fromReport !== undefined && carried.has(row.id)) {
        const report = reported.anchors.anchors.find((anchor) => anchor.thread === row.id);
        moved =
          report !== undefined && spanWithin(report, reported.text.length)
            ? fromReport(report)
            : undefined;
      } else if (was !== undefined) {
        moved = change(was);
      } else continue;
      const section = moved === undefined ? row.section : sectionAt(after, moved.from);
      if (moved?.from === was?.from && moved?.to === was?.to && section === row.section) continue;
      yield* movedOn(row.id, now, {
        anchorFrom: moved?.from ?? null,
        anchorTo: moved?.to ?? null,
        section,
      });
    }
  });
}

/** One write over the plan's comments, whole or not at all. */
function inTransaction<A>(write: TaskStoreEffect<A>): TaskStoreEffect<A> {
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(write));
}
