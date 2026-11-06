import { randomUUID } from "node:crypto";
import { AGENT_ATTACHMENT_TYPE, type AgentAttachment } from "@repo/features/agent-wire";
import {
  type CommentSpan,
  spanWithin,
  textChange,
} from "@repo/features/description-comment-anchor";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_BOUNDS,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_REFUSAL,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentActionRequest,
  type DescriptionCommentAnchors,
  type DescriptionCommentAsked,
  type DescriptionCommentAskRequest,
  type DescriptionCommentEntry,
  type DescriptionCommentEntryKind,
  type DescriptionCommentFile,
  type DescriptionCommentPageStart,
  type DescriptionCommentRefusal,
  type DescriptionCommentStart,
  type DescriptionCommentStartRequest,
  type DescriptionCommentThread,
  type DescriptionCommentThreadAnswer,
  descriptionCommentActorSchema,
} from "@repo/features/description-comment-wire";
import { descriptionSections } from "@repo/features/description-document";
import { and, asc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import { user } from "../schemas/auth.js";
import { descriptionComment, descriptionCommentThread } from "../schemas/description-comment.js";
import { taskPageVersion } from "../schemas/task-page.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import { reachableTask, taskReachableBy } from "./workspace-store.js";

/**
 * description-comments.ts -- a plan's comment threads: read them, start one, answer, edit, resolve, reopen, and delete, and move every anchor with its words as the plan's text is saved.
 *
 * Every member of the plan's workspace reads and writes every thread, and
 * every agent on the task writes as the member whose turn it is; an account
 * outside the workspace reads no plan here, exactly as in `task-store.ts`.
 * Each write takes the plan row's lock first, as the plan's own save does,
 * so a thread started while the text is saved lands on the text as saved. A comment
 * is edited or deleted only by its writer, and a whole thread deleted only by
 * its starter, or by any member where the per-task assistant or an agent started
 * it; the rest, resolving and reopening, is any member's or agent's.
 *
 * A thread's anchor is offsets into the plan's text (`schemas/description-comment.ts`).
 * A thread is started over the text the client measured it in, carried over
 * to the text as saved; every save of the text carries every anchor over the
 * change (`moveDescriptionCommentAnchors`), and where the developer's open editor
 * reports where its anchors stand, those are taken instead for the threads
 * it carried, which is how undo brings an anchor back with its words.
 *
 * A comment's files are rows of the shared attachment table owned by the
 * comment (`schemas/attachment.ts`), written in the same transaction as the
 * comment, so no reader sees one without the other, and deleted with it by
 * the comment's cascade. Each names the plan and its workspace beside the
 * comment, so it moves with the plan, and is read back by any member of
 * that workspace (`readDescriptionCommentFile`).
 *
 * A thread on one of the task's pages is the task's as any other: it is
 * started on a version the task holds of the page, under the same lock and
 * the same key, and every write to a thread by its id is the same. What
 * sets it apart is what reads it: the plan's threads are read without the
 * pages', and a page's alone (`readDescriptionCommentThreads`), each subject held
 * to its own bound of threads, and no save of the plan's text moves it.
 */

/**
 * Who writes to a thread: the account it acts for, and whether it is that
 * member or a coding agent on it. The per-task assistant is read back from
 * entries written while a task had one, and nothing writes as it now.
 */
export type DescriptionCommentWriterRef =
  | { readonly actor: typeof DESCRIPTION_COMMENT_ACTOR.MEMBER; readonly userId: string }
  | {
      readonly actor: typeof DESCRIPTION_COMMENT_ACTOR.AGENT;
      readonly userId: string;
      readonly agentId: string;
    };

/** What a write to a plan's comments came to: done, with what it answers, or no plan, thread, or page the account reaches, or a thread's id another task's thread holds. */
export const DESCRIPTION_COMMENT_OUTCOME = {
  DONE: "done",
  NO_TASK: "no-plan",
  NO_THREAD: "no-thread",
  NO_PAGE: "no-page",
  ID_TAKEN: "id-taken",
} as const;

export type DescriptionCommentOutcome =
  | {
      readonly status: typeof DESCRIPTION_COMMENT_OUTCOME.DONE;
      readonly answer: DescriptionCommentThreadAnswer;
      /** Set where the write was a retry of one under the same key, which wrote nothing this time. */
      readonly repeated?: true;
      /** The transaction the write committed in, which a reader following the thread waits for; none where it wrote nothing. */
      readonly txid?: string;
    }
  | { readonly status: typeof DESCRIPTION_COMMENT_OUTCOME.NO_TASK }
  | { readonly status: typeof DESCRIPTION_COMMENT_OUTCOME.NO_THREAD }
  | { readonly status: typeof DESCRIPTION_COMMENT_OUTCOME.NO_PAGE }
  | { readonly status: typeof DESCRIPTION_COMMENT_OUTCOME.ID_TAKEN };

/** Where one thread stands, without what it says: what a held read compares between looks. */
export interface DescriptionCommentStamp {
  readonly id: string;
  readonly revision: number;
  readonly status: string;
  readonly updatedAt: number;
}

const ThreadRowSchema = Schema.Struct({
  id: Schema.String,
  scope: Schema.Literals(Object.values(DESCRIPTION_COMMENT_SCOPE)),
  quote: Schema.String,
  anchorFrom: Schema.NullOr(Schema.Number),
  anchorTo: Schema.NullOr(Schema.Number),
  section: Schema.String,
  pageId: Schema.NullOr(Schema.String),
  pageVersion: Schema.NullOr(Schema.Number),
  pageElement: Schema.NullOr(Schema.String),
  status: Schema.Literals(Object.values(DESCRIPTION_COMMENT_STATUS)),
  revision: Schema.Number,
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type ThreadRow = typeof ThreadRowSchema.Type;

const THREAD_COLUMNS = {
  id: descriptionCommentThread.id,
  scope: descriptionCommentThread.scope,
  quote: descriptionCommentThread.quote,
  anchorFrom: descriptionCommentThread.anchorFrom,
  anchorTo: descriptionCommentThread.anchorTo,
  section: descriptionCommentThread.section,
  pageId: descriptionCommentThread.pageId,
  pageVersion: descriptionCommentThread.pageVersion,
  pageElement: descriptionCommentThread.pageElement,
  status: descriptionCommentThread.status,
  revision: descriptionCommentThread.revision,
  createdAt: descriptionCommentThread.createdAt,
  updatedAt: descriptionCommentThread.updatedAt,
};

/** Which of the task's threads a read takes: the plan's where it names no page, or the page's it names. */
const SubjectSchema = Schema.NullOr(Schema.String);

/** The threads on one subject of the task: the plan's where `pageId` is null, the page's it names otherwise. */
function onSubject(pageId: string | null): SQL {
  return pageId === null
    ? isNull(descriptionCommentThread.pageId)
    : eq(descriptionCommentThread.pageId, pageId);
}

const EntryRowSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  kind: Schema.Literals(Object.values(DESCRIPTION_COMMENT_ENTRY)),
  actor: descriptionCommentActorSchema,
  userId: Schema.NullOr(Schema.String),
  userName: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  words: Schema.NullOr(Schema.String),
  askedActor: Schema.NullOr(descriptionCommentActorSchema),
  askedAgentId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  editedAt: Schema.NullOr(InstantColumnSchema),
});

type EntryRow = typeof EntryRowSchema.Type;

const ENTRY_COLUMNS = {
  id: descriptionComment.id,
  threadId: descriptionComment.threadId,
  kind: descriptionComment.kind,
  actor: descriptionComment.actor,
  userId: descriptionComment.userId,
  userName: user.name,
  agentId: descriptionComment.agentId,
  words: descriptionComment.words,
  askedActor: descriptionComment.askedActor,
  askedAgentId: descriptionComment.askedAgentId,
  createdAt: descriptionComment.createdAt,
  editedAt: descriptionComment.editedAt,
};

/** The plan's text and workspace under its row's lock, where the account reaches the plan; nothing otherwise. */
const lockOpenDescriptionText = SqlSchema.findOneOption({
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

/** The task's threads: the ones named, of any subject, or every one of the subject named. */
const findThreads = SqlSchema.findAll({
  Request: Schema.Struct({
    taskId: Schema.String,
    ids: Schema.optional(Schema.Array(Schema.String)),
    pageId: Schema.optional(SubjectSchema),
  }),
  Result: ThreadRowSchema,
  execute: ({ taskId, ids, pageId }) =>
    Database.use((db) =>
      db
        .select(THREAD_COLUMNS)
        .from(descriptionCommentThread)
        .where(
          and(
            eq(descriptionCommentThread.taskId, taskId),
            ids === undefined ? undefined : inArray(descriptionCommentThread.id, [...ids]),
            pageId === undefined ? undefined : onSubject(pageId),
          ),
        )
        .orderBy(asc(descriptionCommentThread.createdAt), asc(descriptionCommentThread.id)),
    ),
});

const findEntries = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String, threadIds: Schema.Array(Schema.String) }),
  Result: EntryRowSchema,
  execute: ({ taskId, threadIds }) =>
    Database.use((db) =>
      db
        .select(ENTRY_COLUMNS)
        .from(descriptionComment)
        .leftJoin(user, eq(user.id, descriptionComment.userId))
        .where(
          and(
            eq(descriptionComment.taskId, taskId),
            inArray(descriptionComment.threadId, [...threadIds]),
          ),
        )
        .orderBy(asc(descriptionComment.threadId), asc(descriptionComment.seq)),
    ),
});

const findStamps = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String, pageId: SubjectSchema }),
  Result: Schema.Struct({
    id: Schema.String,
    revision: Schema.Number,
    status: Schema.String,
    updatedAt: InstantColumnSchema,
  }),
  execute: ({ userId, taskId, pageId }) =>
    Database.use((db) =>
      db
        .select({
          id: descriptionCommentThread.id,
          revision: descriptionCommentThread.revision,
          status: descriptionCommentThread.status,
          updatedAt: descriptionCommentThread.updatedAt,
        })
        .from(descriptionCommentThread)
        .innerJoin(task, eq(task.id, descriptionCommentThread.taskId))
        .where(
          and(
            eq(descriptionCommentThread.taskId, taskId),
            onSubject(pageId),
            taskReachableBy(userId),
          ),
        ),
    ),
});

/** How many threads one subject of the task holds, the plan or one page, resolved ones among them. */
const countThreads = SqlSchema.findOne({
  Request: Schema.Struct({ taskId: Schema.String, pageId: SubjectSchema }),
  Result: Schema.Struct({ count: Schema.Number }),
  execute: ({ taskId, pageId }) =>
    Database.use((db) =>
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(descriptionCommentThread)
        .where(and(eq(descriptionCommentThread.taskId, taskId), onSubject(pageId))),
    ),
});

/** The title of one version of one of the task's pages, where the task holds it. */
const findTaskPageVersion = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, pageId: Schema.String, version: Schema.Number }),
  Result: Schema.Struct({ title: Schema.String }),
  execute: ({ taskId, pageId, version }) =>
    Database.use((db) =>
      db
        .select({ title: taskPageVersion.title })
        .from(taskPageVersion)
        .where(
          and(
            eq(taskPageVersion.taskId, taskId),
            eq(taskPageVersion.pageId, pageId),
            eq(taskPageVersion.version, version),
          ),
        ),
    ),
});

/**
 * The transaction a write runs in, returned beside what it wrote, so a
 * reader following the thread waits for that transaction to arrive before
 * it takes the write as shown.
 */
const TXID = sql<string>`pg_current_xact_id()::text`;

/** The task a thread of any task is on, by the thread's id alone: whether an id a start chose is free. */
const findThreadTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ threadId: Schema.String }),
  Result: Schema.Struct({ taskId: Schema.String }),
  execute: ({ threadId }) =>
    Database.use((db) =>
      db
        .select({ taskId: descriptionCommentThread.taskId })
        .from(descriptionCommentThread)
        .where(eq(descriptionCommentThread.id, threadId)),
    ),
});

const findKeyedThread = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, clientKey: Schema.String }),
  Result: Schema.Struct({ threadId: Schema.String }),
  execute: ({ taskId, clientKey }) =>
    Database.use((db) =>
      db
        .select({ threadId: descriptionComment.threadId })
        .from(descriptionComment)
        .where(
          and(eq(descriptionComment.taskId, taskId), eq(descriptionComment.clientKey, clientKey)),
        ),
    ),
});

/** The entry a key was written under: its thread, its kind, and whom it asked, where it is an ask. */
const findKeyedEntry = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, clientKey: Schema.String }),
  Result: Schema.Struct({
    threadId: Schema.String,
    kind: Schema.String,
    askedActor: Schema.NullOr(descriptionCommentActorSchema),
    askedAgentId: Schema.NullOr(Schema.String),
  }),
  execute: ({ taskId, clientKey }) =>
    Database.use((db) =>
      db
        .select({
          threadId: descriptionComment.threadId,
          kind: descriptionComment.kind,
          askedActor: descriptionComment.askedActor,
          askedAgentId: descriptionComment.askedAgentId,
        })
        .from(descriptionComment)
        .where(
          and(eq(descriptionComment.taskId, taskId), eq(descriptionComment.clientKey, clientKey)),
        ),
    ),
});

const FileRowSchema = Schema.Struct({
  id: Schema.String,
  descriptionCommentId: Schema.String,
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
          descriptionCommentId: sql<string>`${attachment.descriptionCommentId}`,
          name: sql<string>`${attachment.name}`,
          contentType: attachment.contentType,
        })
        .from(attachment)
        .where(
          and(
            eq(attachment.taskId, taskId),
            inArray(attachment.descriptionCommentId, [...entryIds]),
          ),
        )
        .orderBy(asc(attachment.descriptionCommentId), asc(attachment.position)),
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
    contentType: Schema.Literals(Object.values(AGENT_ATTACHMENT_TYPE)),
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
            isNotNull(attachment.descriptionCommentId),
            taskReachableBy(userId),
          ),
        ),
    ),
});

/** An entry as the wire carries it, each absent field left out rather than null. */
function entryOf(row: EntryRow, files: readonly FileRow[]): DescriptionCommentEntry {
  const by =
    row.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER && row.userId !== null && row.userName !== null
      ? { by: { userId: row.userId, name: row.userName } }
      : undefined;
  const agent = row.agentId === null ? undefined : { agentId: row.agentId };
  const asked: DescriptionCommentAsked | undefined =
    row.askedActor === DESCRIPTION_COMMENT_ACTOR.APP
      ? { actor: DESCRIPTION_COMMENT_ACTOR.APP }
      : row.askedActor === DESCRIPTION_COMMENT_ACTOR.AGENT && row.askedAgentId !== null
        ? { actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId: row.askedAgentId }
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
): { readonly files: readonly DescriptionCommentFile[] } | undefined {
  const carried = files
    .filter((file) => file.descriptionCommentId === entryId)
    .map((file) => ({ attachmentId: file.id, name: file.name, mediaType: file.contentType }));
  return carried.length === 0 ? undefined : { files: carried };
}

/** A thread as the wire carries it, with its entries in the order they were written. */
function threadOf(
  row: ThreadRow,
  entries: readonly EntryRow[],
  files: readonly FileRow[] = [],
): DescriptionCommentThread {
  const anchor =
    row.anchorFrom === null || row.anchorTo === null
      ? undefined
      : { anchor: { from: row.anchorFrom, to: row.anchorTo } };
  const element = row.pageElement === null ? undefined : { element: row.pageElement };
  const page =
    row.pageId === null || row.pageVersion === null
      ? undefined
      : { page: { id: row.pageId, version: row.pageVersion, ...element } };
  return {
    id: row.id,
    scope: row.scope,
    quote: row.quote,
    ...anchor,
    ...page,
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

/** The threads of one subject of the task, or the ones named of any, with their entries. */
function threadsOf(
  taskId: string,
  of: { readonly ids: readonly string[] } | { readonly pageId: string | null },
): TaskStoreEffect<DescriptionCommentThread[]> {
  return Effect.gen(function* () {
    const rows = yield* findThreads({ taskId, ...of });
    if (rows.length === 0) return [];
    const entries = yield* findEntries({ taskId, threadIds: rows.map((row) => row.id) });
    const comments = entries.filter((entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT);
    const files =
      comments.length === 0
        ? []
        : yield* findFiles({ taskId, entryIds: comments.map((entry) => entry.id) });
    return rows.map((row) => threadOf(row, entries, files));
  });
}

/** The heading of the section a place in the text stands in; empty before the first heading. */
function sectionAt(text: string, offset: number): string {
  return descriptionSections(text).findLast((section) => section.from <= offset)?.heading ?? "";
}

/** The writer's columns of an entry. */
function writerColumns(writer: DescriptionCommentWriterRef) {
  return {
    actor: writer.actor,
    userId: writer.userId,
    agentId: writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT ? writer.agentId : null,
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
  files: readonly AgentAttachment[],
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
      descriptionCommentId: entryId,
      name: file.name,
      position,
      contentType: file.mediaType,
      byteCount: bytes.success.byteLength,
      bytes: bytes.success,
      createdAt: now,
    });
  });
}

/** One entry written to a thread with the files a comment carries, and the thread moved on, so every reader's cursor moves; answers the transaction it was written in. */
function writeEntry(
  place: EntryPlace,
  writer: DescriptionCommentWriterRef,
  entry: {
    readonly kind: DescriptionCommentEntryKind;
    readonly words?: string;
    readonly clientKey?: string;
    readonly asked?: DescriptionCommentAsked;
    readonly files?: readonly AgentAttachment[];
  },
  now: Date,
): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const { taskId, threadId } = place;
    const id = randomUUID();
    const files = yield* fileRowsOf(place, id, writer.userId, entry.files ?? [], now);
    const { revision: seq, txid } = yield* movedOn(threadId, now);
    yield* Database.use((db) =>
      db.insert(descriptionComment).values({
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
    return txid;
  });
}

/** The thread's revision moved on and its instant set, as every change of it does; answers the revision it moved to and the transaction it moved in. */
function movedOn(
  threadId: string,
  now: Date,
  set: Partial<typeof descriptionCommentThread.$inferInsert> = {},
): TaskStoreEffect<{ readonly revision: number; readonly txid: string }> {
  return Effect.flatMap(
    Database.use((db) =>
      db
        .update(descriptionCommentThread)
        .set({ ...set, revision: sql`${descriptionCommentThread.revision} + 1`, updatedAt: now })
        .where(eq(descriptionCommentThread.id, threadId))
        .returning({ revision: descriptionCommentThread.revision, txid: TXID }),
    ),
    // A thread read under the plan's lock that the update then misses is the database breaking its own contract.
    ([row]) =>
      row === undefined
        ? Effect.die(new Error("plan comment thread vanished"))
        : Effect.succeed(row),
  );
}

/** The thread answered as it now stands, with the transaction the write committed in where it wrote. */
function answered(
  taskId: string,
  threadId: string,
  txid?: string,
): TaskStoreEffect<DescriptionCommentOutcome> {
  return Effect.map(threadsOf(taskId, { ids: [threadId] }), ([thread]) =>
    thread === undefined
      ? { status: DESCRIPTION_COMMENT_OUTCOME.NO_THREAD }
      : {
          status: DESCRIPTION_COMMENT_OUTCOME.DONE,
          answer: { thread },
          ...(txid === undefined ? undefined : { txid }),
        },
  );
}

/** The thread answered as a retry under a key already taken: as it stands, marked as having written nothing. */
function answeredAgain(
  taskId: string,
  threadId: string,
): TaskStoreEffect<DescriptionCommentOutcome> {
  return Effect.map(answered(taskId, threadId), (outcome) =>
    outcome.status === DESCRIPTION_COMMENT_OUTCOME.DONE ? { ...outcome, repeated: true } : outcome,
  );
}

function refused(refusal: DescriptionCommentRefusal): DescriptionCommentOutcome {
  return { status: DESCRIPTION_COMMENT_OUTCOME.DONE, answer: { refused: refusal } };
}

/** Whether an entry is the writer's own, which only they edit or delete. */
function writtenBy(row: EntryRow, writer: DescriptionCommentWriterRef): boolean {
  if (row.actor !== writer.actor) return false;
  if (writer.actor === DESCRIPTION_COMMENT_ACTOR.AGENT) return row.agentId === writer.agentId;
  return row.userId === writer.userId;
}

/**
 * Whether the writer may delete the whole thread: its starter may, and any
 * member may where the per-task assistant or an agent started it, since no
 * member wrote it.
 */
function mayDeleteThread(starter: EntryRow, writer: DescriptionCommentWriterRef): boolean {
  if (writtenBy(starter, writer)) return true;
  return (
    starter.actor !== DESCRIPTION_COMMENT_ACTOR.MEMBER &&
    writer.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER
  );
}

/** The plan's threads, or the named page's, oldest first, each with its entries; nothing where the account reaches no such plan. */
export function readDescriptionCommentThreads(
  userId: string,
  taskId: string,
  pageId?: string,
): TaskStoreEffect<Option.Option<readonly DescriptionCommentThread[]>> {
  return Effect.gen(function* () {
    const reached = yield* findReachableTask({ userId, taskId });
    if (Option.isNone(reached)) return Option.none();
    return Option.some(yield* threadsOf(taskId, { pageId: pageId ?? null }));
  });
}

/** One of the task's threads by its id, the plan's or a page's, with its entries; nothing where the account reaches no such plan or the plan no such thread. */
export function readDescriptionCommentThread(
  userId: string,
  taskId: string,
  threadId: string,
): TaskStoreEffect<Option.Option<DescriptionCommentThread>> {
  return Effect.gen(function* () {
    const reached = yield* findReachableTask({ userId, taskId });
    if (Option.isNone(reached)) return Option.none();
    const [thread] = yield* threadsOf(taskId, { ids: [threadId] });
    return Option.fromNullishOr(thread);
  });
}

/** Where each of the plan's threads, or the named page's, stands, read without its words; none where the account reaches no such plan. */
export function descriptionCommentStamps(
  userId: string,
  taskId: string,
  pageId?: string,
): TaskStoreEffect<readonly DescriptionCommentStamp[]> {
  return Effect.map(findStamps({ userId, taskId, pageId: pageId ?? null }), (rows) =>
    rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() })),
  );
}

/** Where a thread being started stands, as its row keeps it. */
type ThreadPlace = Pick<
  typeof descriptionCommentThread.$inferInsert,
  | "scope"
  | "quote"
  | "anchorFrom"
  | "anchorTo"
  | "section"
  | "pageId"
  | "pageVersion"
  | "pageElement"
>;

/** A thread placed on the words the request measured in its text, carried over to the plan's text as saved; refused where none of them stand there now. */
function placedOnDescription(
  text: string,
  request: DescriptionCommentStartRequest,
): ThreadPlace | DescriptionCommentOutcome {
  const anchor = spanWithin(request.anchor, request.text.length)
    ? textChange(request.text, text)(request.anchor)
    : undefined;
  if (anchor === undefined) return refused(DESCRIPTION_COMMENT_REFUSAL.NO_WORDS);
  return {
    scope: request.scope,
    quote: request.quote,
    anchorFrom: anchor.from,
    anchorTo: anchor.to,
    section: sectionAt(text, anchor.from),
  };
}

/**
 * A thread placed on the version of the task's page the request names: on
 * the element it picked there, or on words selected in one, or on the whole
 * page, quoted by the version's title; no page where the task holds no such
 * version.
 */
function placedOnPage(
  taskId: string,
  request: DescriptionCommentPageStart,
): TaskStoreEffect<ThreadPlace | DescriptionCommentOutcome> {
  return Effect.map(
    findTaskPageVersion({ taskId, pageId: request.page.id, version: request.page.version }),
    Option.match({
      onNone: () => ({ status: DESCRIPTION_COMMENT_OUTCOME.NO_PAGE }) as const,
      onSome: ({ title }) => {
        const on = { pageId: request.page.id, pageVersion: request.page.version };
        const { element } = request;
        if (element === undefined) {
          return { ...on, scope: DESCRIPTION_COMMENT_SCOPE.PAGE, quote: title, section: "" };
        }
        return {
          ...on,
          scope:
            element.words === true
              ? DESCRIPTION_COMMENT_SCOPE.WORDS
              : DESCRIPTION_COMMENT_SCOPE.ELEMENT,
          quote: element.quote,
          section: element.section,
          pageElement: element.path,
        };
      },
    }),
  );
}

/**
 * A thread started on the plan with its first comment, anchored to the words
 * the request measured in its text, carried over to the text as saved, or on
 * a version of one of the task's pages. Refused where the plan, or the page,
 * holds its bound of threads, or where none of the words stand in the text
 * now; no page where the task holds no such version; the thread a key
 * already started where the request was taken before. A start may name the
 * thread's id, minted by its client so it can draw the thread before the
 * service answers: the thread is made under it, a start of this task's
 * under an id it already holds answers that thread as a retry does, and an
 * id another task's thread holds is taken, answered as a plan not reached
 * is, so it says nothing of whose it is.
 */
export function startDescriptionCommentThread(
  writer: DescriptionCommentWriterRef,
  taskId: string,
  request: DescriptionCommentStart,
): TaskStoreEffect<DescriptionCommentOutcome> {
  return inTransaction(
    Effect.gen(function* () {
      const locked = yield* lockOpenDescriptionText({ userId: writer.userId, taskId });
      if (Option.isNone(locked)) return { status: DESCRIPTION_COMMENT_OUTCOME.NO_TASK } as const;
      const taken = yield* findKeyedThread({ taskId, clientKey: request.clientKey });
      if (Option.isSome(taken)) return yield* answeredAgain(taskId, taken.value.threadId);
      if (request.id !== undefined) {
        const held = yield* findThreadTask({ threadId: request.id });
        if (Option.isSome(held)) {
          return held.value.taskId === taskId
            ? yield* answeredAgain(taskId, request.id)
            : ({ status: DESCRIPTION_COMMENT_OUTCOME.ID_TAKEN } as const);
        }
      }
      const onPage = "page" in request;
      const { count } = yield* countThreads({
        taskId,
        pageId: onPage ? request.page.id : null,
      }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
      if (count >= DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION) {
        return refused(DESCRIPTION_COMMENT_REFUSAL.TOO_MANY);
      }
      const placed = onPage
        ? yield* placedOnPage(taskId, request)
        : placedOnDescription(locked.value.text, request);
      if ("status" in placed) return placed;
      const id = request.id ?? randomUUID();
      const now = yield* DateTime.nowAsDate;
      const made = yield* Database.use((db) =>
        db
          .insert(descriptionCommentThread)
          .values({
            ...placed,
            id,
            taskId,
            status: DESCRIPTION_COMMENT_STATUS.OPEN,
            revision: 0,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: descriptionCommentThread.id })
          .returning({ id: descriptionCommentThread.id }),
      );
      // Note that a start of this task waits on the plan's lock, so an id taken meanwhile is another task's.
      if (made.length === 0) return { status: DESCRIPTION_COMMENT_OUTCOME.ID_TAKEN } as const;
      const first = {
        kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
        words: request.words,
        clientKey: request.clientKey,
        ...(request.attachments === undefined ? undefined : { files: request.attachments }),
      };
      const place = { taskId, organizationId: locked.value.organizationId, threadId: id };
      const txid = yield* writeEntry(place, writer, first, now);
      return yield* answered(taskId, id, txid);
    }),
  );
}

/** One of the thread's entries, by id. */
function entryIn(
  thread: DescriptionCommentThread,
  entries: readonly EntryRow[],
  id: string,
): EntryRow | undefined {
  return entries.find((entry) => entry.threadId === thread.id && entry.id === id);
}

/** A reply to the thread, taken once under its key; refused where the thread holds its bound of entries. */
function replied(
  place: EntryPlace,
  thread: DescriptionCommentThread,
  writer: DescriptionCommentWriterRef,
  reply: {
    readonly words: string;
    readonly clientKey?: string;
    readonly attachments?: readonly AgentAttachment[];
  },
  now: Date,
): TaskStoreEffect<DescriptionCommentOutcome> {
  return Effect.gen(function* () {
    const { taskId } = place;
    if (reply.clientKey !== undefined) {
      const taken = yield* findKeyedThread({ taskId, clientKey: reply.clientKey });
      if (Option.isSome(taken) && taken.value.threadId !== thread.id) {
        return refused(DESCRIPTION_COMMENT_REFUSAL.KEY_TAKEN);
      }
      if (Option.isSome(taken)) return yield* answeredAgain(taskId, thread.id);
    }
    const comments = thread.entries.filter(
      (entry) => entry.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT,
    );
    if (comments.length >= DESCRIPTION_COMMENT_BOUNDS.MAX_ENTRIES_PER_THREAD) {
      return refused(DESCRIPTION_COMMENT_REFUSAL.TOO_MANY);
    }
    const entry = {
      kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
      words: reply.words,
      ...(reply.clientKey === undefined ? undefined : { clientKey: reply.clientKey }),
      ...(reply.attachments === undefined ? undefined : { files: reply.attachments }),
    };
    const txid = yield* writeEntry(place, writer, entry, now);
    return yield* answered(taskId, thread.id, txid);
  });
}

/** The line saying who sent the thread to whom, written once under its key: what an ask that was handed over leaves in the thread. */
function askedOf(
  place: EntryPlace,
  thread: DescriptionCommentThread,
  writer: DescriptionCommentWriterRef,
  ask: { readonly clientKey: string; readonly to: DescriptionCommentAsked },
  now: Date,
): TaskStoreEffect<DescriptionCommentOutcome> {
  return Effect.gen(function* () {
    const { taskId } = place;
    // Note that a key answers as a retry only for the same ask of the same thread, so no other entry's key hands the thread over unrecorded.
    const taken = yield* findKeyedEntry({ taskId, clientKey: ask.clientKey });
    if (Option.isSome(taken)) {
      const { threadId, kind, askedActor, askedAgentId } = taken.value;
      const same =
        threadId === thread.id &&
        kind === DESCRIPTION_COMMENT_ENTRY.ASKED &&
        askedActor === ask.to.actor &&
        askedAgentId === (ask.to.agentId ?? null);
      return same
        ? yield* answered(taskId, thread.id)
        : refused(DESCRIPTION_COMMENT_REFUSAL.KEY_TAKEN);
    }
    const entry = {
      kind: DESCRIPTION_COMMENT_ENTRY.ASKED,
      asked: ask.to,
      clientKey: ask.clientKey,
    };
    const txid = yield* writeEntry(place, writer, entry, now);
    return yield* answered(taskId, thread.id, txid);
  });
}

/** The thread deleted, its entries with it, answered with the transaction it was deleted in. */
function deletedThread(threadId: string): TaskStoreEffect<DescriptionCommentOutcome> {
  return Effect.map(
    Database.use((db) =>
      db
        .delete(descriptionCommentThread)
        .where(eq(descriptionCommentThread.id, threadId))
        .returning({ txid: TXID }),
    ),
    ([row]) => ({
      status: DESCRIPTION_COMMENT_OUTCOME.DONE,
      answer: { deleted: threadId },
      ...(row === undefined ? undefined : { txid: row.txid }),
    }),
  );
}

/** The thread set resolved or open, with the line saying who did it; a thread already so answers as it stands. */
function settled(
  place: EntryPlace,
  thread: DescriptionCommentThread,
  writer: DescriptionCommentWriterRef,
  status: typeof DESCRIPTION_COMMENT_STATUS.OPEN | typeof DESCRIPTION_COMMENT_STATUS.RESOLVED,
  now: Date,
): TaskStoreEffect<DescriptionCommentOutcome> {
  return Effect.gen(function* () {
    const { taskId } = place;
    if (thread.status === status) return yield* answered(taskId, thread.id);
    const { txid } = yield* movedOn(thread.id, now, { status });
    // Note that past the bound the change is made and goes unsaid, because a resolve must never be refused, and its lines must not grow a thread without end.
    const lines = thread.entries.filter(
      (entry) => entry.kind !== DESCRIPTION_COMMENT_ENTRY.COMMENT,
    );
    if (lines.length < DESCRIPTION_COMMENT_BOUNDS.MAX_ENTRIES_PER_THREAD) {
      const kind =
        status === DESCRIPTION_COMMENT_STATUS.RESOLVED
          ? DESCRIPTION_COMMENT_ENTRY.RESOLVED
          : DESCRIPTION_COMMENT_ENTRY.REOPENED;
      yield* writeEntry(place, writer, { kind }, now);
    }
    return yield* answered(taskId, thread.id, txid);
  });
}

/**
 * What a member, the per-task assistant, or an agent does to one thread of
 * the plan: answer it, edit or delete a comment of its own (deleting the
 * first deletes the thread), resolve or reopen it, or delete it whole, which
 * only its starter does, or any member where the per-task assistant or an
 * agent started it. Nothing where the
 * account reaches no such plan, or the plan no such thread.
 */
export function actOnDescriptionCommentThread(
  writer: DescriptionCommentWriterRef,
  taskId: string,
  threadId: string,
  request: DescriptionCommentActionRequest | DescriptionCommentAskRequest,
): TaskStoreEffect<DescriptionCommentOutcome> {
  return inTransaction(
    Effect.gen(function* () {
      const locked = yield* lockOpenDescriptionText({ userId: writer.userId, taskId });
      if (Option.isNone(locked)) return { status: DESCRIPTION_COMMENT_OUTCOME.NO_TASK } as const;
      const [row] = yield* findThreads({ taskId, ids: [threadId] });
      if (row === undefined) return { status: DESCRIPTION_COMMENT_OUTCOME.NO_THREAD } as const;
      const entries = yield* findEntries({ taskId, threadIds: [threadId] });
      const thread = threadOf(row, entries);
      const place = { taskId, organizationId: locked.value.organizationId, threadId };
      const now = yield* DateTime.nowAsDate;
      switch (request.action) {
        case DESCRIPTION_COMMENT_ACTION.REPLY:
          return yield* replied(place, thread, writer, request, now);
        case DESCRIPTION_COMMENT_ACTION.RESOLVE:
          return yield* settled(place, thread, writer, DESCRIPTION_COMMENT_STATUS.RESOLVED, now);
        case DESCRIPTION_COMMENT_ACTION.REOPEN:
          return yield* settled(place, thread, writer, DESCRIPTION_COMMENT_STATUS.OPEN, now);
        case DESCRIPTION_COMMENT_ACTION.DELETE_THREAD: {
          const starter = entries.find((each) => each.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT);
          if (starter !== undefined && !mayDeleteThread(starter, writer)) {
            return refused(DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS);
          }
          return yield* deletedThread(threadId);
        }
        case DESCRIPTION_COMMENT_ACTION.ASK:
          return yield* askedOf(place, thread, writer, request, now);
        case DESCRIPTION_COMMENT_ACTION.EDIT:
        case DESCRIPTION_COMMENT_ACTION.DELETE: {
          const entry = entryIn(thread, entries, request.entry);
          if (entry === undefined || entry.kind !== DESCRIPTION_COMMENT_ENTRY.COMMENT) {
            return refused(DESCRIPTION_COMMENT_REFUSAL.NO_ENTRY);
          }
          if (!writtenBy(entry, writer)) return refused(DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS);
          if (request.action === DESCRIPTION_COMMENT_ACTION.EDIT) {
            yield* Database.use((db) =>
              db
                .update(descriptionComment)
                .set({ words: request.words, editedAt: now })
                .where(eq(descriptionComment.id, entry.id)),
            );
            const { txid } = yield* movedOn(threadId, now);
            return yield* answered(taskId, threadId, txid);
          }
          const first = entries.find((each) => each.kind === DESCRIPTION_COMMENT_ENTRY.COMMENT);
          if (first?.id === entry.id) return yield* deletedThread(threadId);
          yield* Database.use((db) =>
            db.delete(descriptionComment).where(eq(descriptionComment.id, entry.id)),
          );
          const { txid } = yield* movedOn(threadId, now);
          return yield* answered(taskId, threadId, txid);
        }
      }
    }),
  );
}

/**
 * The line an ask wrote taken back, where its hand-over to the per-task
 * assistant or the agent did not land, so the thread never says someone was
 * asked who was not.
 */
export function withdrawDescriptionCommentAsk(
  taskId: string,
  clientKey: string,
): TaskStoreEffect<void> {
  return inTransaction(
    Effect.gen(function* () {
      const taken = yield* findKeyedThread({ taskId, clientKey });
      if (Option.isNone(taken)) return;
      yield* Database.use((db) =>
        db
          .delete(descriptionComment)
          .where(
            and(
              eq(descriptionComment.taskId, taskId),
              eq(descriptionComment.clientKey, clientKey),
              eq(descriptionComment.kind, DESCRIPTION_COMMENT_ENTRY.ASKED),
            ),
          ),
      );
      yield* movedOn(taken.value.threadId, yield* DateTime.nowAsDate);
    }),
  );
}

/**
 * One file a comment of the plan carries, its bytes under the type it
 * traveled as, where the account reaches the plan; nothing for a plan of a
 * workspace the account is not in, and for an id that names no comment's
 * file of this plan, a plan's picture among them.
 */
export function readDescriptionCommentFile(
  userId: string,
  taskId: string,
  attachmentId: string,
): TaskStoreEffect<
  Option.Option<{
    readonly contentType: AgentAttachment["mediaType"];
    readonly bytes: Uint8Array;
  }>
> {
  return findCommentFile({ userId, taskId, attachmentId });
}

/** Where the open editor reported its anchors, in the text it sent. */
export interface ReportedAnchors {
  readonly text: string;
  readonly anchors: DescriptionCommentAnchors;
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
export function moveDescriptionCommentAnchors(
  taskId: string,
  before: string,
  after: string,
  reported?: ReportedAnchors,
): TaskStoreEffect<void> {
  return Effect.gen(function* () {
    const rows = yield* findThreads({ taskId, pageId: null });
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
