import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { pageVersionNumberSchema } from "./page-wire.js";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentAsked,
  type PlanCommentEntry,
  type PlanCommentFile,
  type PlanCommentThread,
  planCommentActorSchema,
} from "./plan-comment-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * plan-comment-live.ts -- one subject of a task's comments, its plan's own threads or one page's, followed over the service's held poll: the statements the service answers, the rows they deliver, and the threads as the held read answers them.
 *
 * A read follows one subject, as the held read does: the plan's threads
 * with no page named, or one page's threads on every version, resolved ones
 * among them, never the task's whole, since nothing bounds how many pages
 * a task has. It is three statements, the threads, their entries with the
 * writer's name as the account names itself now, and the files their
 * comments carry without their bytes, which the reader joins, because a
 * row aggregating its children reads functions Realtime refuses. Each row
 * carries the column its rows are ordered by, since Realtime keeps no
 * order: a thread its start and id, an entry its place in its thread, and
 * a file its place on its comment.
 */

/** One subject of a task's comments sealed for following: the address, and its threads, entries, and files, one statement each. The service answers `not-found` for a task the account does not reach. */
export const taskCommentsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    threads: sealedLiveQuerySchema,
    entries: sealedLiveQuerySchema,
    files: sealedLiveQuerySchema,
  }),
});

export type TaskCommentsLiveAnswer = typeof taskCommentsLiveAnswerSchema.Type;

/** One thread as its row delivers it: its anchor null once its words were deleted and on a page, and its page, version, and element null on the plan. */
const threadLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  scope: EffectSchema.Literals(Object.values(PLAN_COMMENT_SCOPE)),
  quote: EffectSchema.String,
  anchorFrom: EffectSchema.NullOr(countedNumber),
  anchorTo: EffectSchema.NullOr(countedNumber),
  section: EffectSchema.String,
  pageId: EffectSchema.NullOr(EffectSchema.String),
  pageVersion: EffectSchema.NullOr(pageVersionNumberSchema),
  pageElement: EffectSchema.NullOr(EffectSchema.String),
  status: EffectSchema.Literals(Object.values(PLAN_COMMENT_STATUS)),
  revision: countedNumber,
  createdAt: countedNumber,
  updatedAt: countedNumber,
});

/** One entry as its row delivers it, with its place in its thread and its member's name as their account holds it now, null once the account is gone. */
const entryLiveRowSchema = EffectSchema.Struct({
  id: EffectSchema.String,
  threadId: EffectSchema.String,
  seq: countedNumber,
  kind: EffectSchema.Literals(Object.values(PLAN_COMMENT_ENTRY)),
  actor: planCommentActorSchema,
  userId: EffectSchema.NullOr(EffectSchema.String),
  userName: EffectSchema.NullOr(EffectSchema.String),
  agentId: EffectSchema.NullOr(EffectSchema.String),
  words: EffectSchema.NullOr(EffectSchema.String),
  askedActor: EffectSchema.NullOr(planCommentActorSchema),
  askedAgentId: EffectSchema.NullOr(EffectSchema.String),
  createdAt: countedNumber,
  editedAt: EffectSchema.NullOr(countedNumber),
});

/** One file a comment carries as its row delivers it, with its place on the comment, null for none kept, which Postgres orders last. */
const fileLiveRowSchema = EffectSchema.Struct({
  attachmentId: EffectSchema.String,
  entryId: EffectSchema.String,
  name: EffectSchema.String,
  mediaType: EffectSchema.String,
  position: EffectSchema.NullOr(countedNumber),
});

/** One subject's threads, entries, and files as Realtime delivers them: none for a task the account no longer reaches. */
export const taskCommentsLiveRowsSchema = EffectSchema.Struct({
  threads: EffectSchema.Array(threadLiveRowSchema),
  entries: EffectSchema.Array(entryLiveRowSchema),
  files: EffectSchema.Array(fileLiveRowSchema),
});

type TaskCommentsLiveRows = typeof taskCommentsLiveRowsSchema.Type;

type ThreadLiveRow = TaskCommentsLiveRows["threads"][number];

type EntryLiveRow = TaskCommentsLiveRows["entries"][number];

type FileLiveRow = TaskCommentsLiveRows["files"][number];

/** Two ids compared as Postgres orders them. */
function byId(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

/** Each row under the key `keyOf` reads, in the order they came. */
function groupedBy<Row>(rows: readonly Row[], keyOf: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  return groups;
}

/** Whom an ask sent the thread to, as the wire names them; nothing for any other entry. */
function askedOf(row: EntryLiveRow): PlanCommentAsked | undefined {
  if (row.askedActor === PLAN_COMMENT_ACTOR.APP) return { actor: PLAN_COMMENT_ACTOR.APP };
  return row.askedActor === PLAN_COMMENT_ACTOR.AGENT && row.askedAgentId !== null
    ? { actor: PLAN_COMMENT_ACTOR.AGENT, agentId: row.askedAgentId }
    : undefined;
}

/** An entry as the wire carries it, each absent field left out rather than null, its files in the order they were attached. */
function entryOf(row: EntryLiveRow, files: readonly FileLiveRow[]): PlanCommentEntry {
  const by =
    row.actor === PLAN_COMMENT_ACTOR.MEMBER && row.userId !== null && row.userName !== null
      ? { by: { userId: row.userId, name: row.userName } }
      : undefined;
  const carried = files
    .toSorted((one, other) => (one.position ?? Infinity) - (other.position ?? Infinity))
    .map(
      (file): PlanCommentFile => ({
        attachmentId: file.attachmentId,
        name: file.name,
        mediaType: file.mediaType,
      }),
    );
  const asked = askedOf(row);
  return {
    id: row.id,
    kind: row.kind,
    writer: {
      actor: row.actor,
      ...by,
      ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    },
    ...(row.words === null ? undefined : { words: row.words }),
    ...(carried.length === 0 ? undefined : { files: carried }),
    ...(asked === undefined ? undefined : { asked }),
    at: row.createdAt,
    ...(row.editedAt === null ? undefined : { editedAt: row.editedAt }),
  };
}

/** A thread as the wire carries it, with its entries in the order they were written. */
function threadOf(
  row: ThreadLiveRow,
  entries: readonly EntryLiveRow[],
  filesOf: ReadonlyMap<string, readonly FileLiveRow[]>,
): PlanCommentThread {
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
      .toSorted((one, other) => one.seq - other.seq)
      .map((entry) => entryOf(entry, filesOf.get(entry.id) ?? [])),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

/** The subject's threads as the held read answers them, from their rows: the oldest started first, then by id, each with its entries and their files. */
export function threadsOfLiveRows(rows: TaskCommentsLiveRows): readonly PlanCommentThread[] {
  const entriesOf = groupedBy(rows.entries, (entry) => entry.threadId);
  const filesOf = groupedBy(rows.files, (file) => file.entryId);
  return rows.threads
    .toSorted((one, other) => one.createdAt - other.createdAt || byId(one.id, other.id))
    .map((row) => threadOf(row, entriesOf.get(row.id) ?? [], filesOf));
}
