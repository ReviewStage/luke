import { Schema as EffectSchema } from "effect";
import { refuses } from "./contract/base.js";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentAsked,
  type DescriptionCommentEntry,
  type DescriptionCommentFile,
  type DescriptionCommentThread,
  descriptionCommentActorSchema,
} from "./description-comment-wire.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_USER_QUERY } from "./live-wire.js";
import { pageVersionNumberSchema } from "./page-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber, HOSTED_API_ERROR } from "./service-wire.js";

/**
 * description-comment-live.ts -- one subject of a task's comments, its description's own threads or one page's, followed over the service's held poll: the statements the service answers, the rows they deliver, and the threads as the held read answers them.
 *
 * A read follows one subject, as the held read does: the description's threads
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

/** One thread as its row delivers it: its anchor null once its words were deleted and on a page, and its page, version, and element null on the description. */
const THREADS = liveRows({
  row: EffectSchema.Struct({
    id: EffectSchema.String,
    scope: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_SCOPE)),
    quote: EffectSchema.String,
    anchorFrom: EffectSchema.NullOr(countedNumber),
    anchorTo: EffectSchema.NullOr(countedNumber),
    section: EffectSchema.String,
    pageId: EffectSchema.NullOr(EffectSchema.String),
    pageVersion: EffectSchema.NullOr(pageVersionNumberSchema),
    pageElement: EffectSchema.NullOr(EffectSchema.String),
    status: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_STATUS)),
    revision: countedNumber,
    createdAt: countedNumber,
    updatedAt: countedNumber,
  }),
  key: "id",
  order: [
    ["createdAt", ORDER.ASC],
    ["id", ORDER.ASC],
  ],
});

/** One entry as its row delivers it, with its place in its thread and its member's name as their account holds it now, null once the account is gone. */
const ENTRIES = liveRows({
  row: EffectSchema.Struct({
    id: EffectSchema.String,
    threadId: EffectSchema.String,
    seq: countedNumber,
    kind: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_ENTRY)),
    actor: descriptionCommentActorSchema,
    userId: EffectSchema.NullOr(EffectSchema.String),
    userName: EffectSchema.NullOr(EffectSchema.String),
    agentId: EffectSchema.NullOr(EffectSchema.String),
    words: EffectSchema.NullOr(EffectSchema.String),
    askedActor: EffectSchema.NullOr(descriptionCommentActorSchema),
    askedAgentId: EffectSchema.NullOr(EffectSchema.String),
    createdAt: countedNumber,
    editedAt: EffectSchema.NullOr(countedNumber),
  }),
  key: "id",
  order: [
    ["threadId", ORDER.ASC],
    ["seq", ORDER.ASC],
  ],
});

/** One file a comment carries as its row delivers it, with its place on the comment, null for none kept, which Postgres orders last. */
const FILES = liveRows({
  row: EffectSchema.Struct({
    attachmentId: EffectSchema.String,
    entryId: EffectSchema.String,
    name: EffectSchema.String,
    mediaType: EffectSchema.String,
    position: EffectSchema.NullOr(countedNumber),
  }),
  key: "attachmentId",
  order: [
    ["entryId", ORDER.ASC],
    ["position", ORDER.ASC],
  ],
});

/**
 * One subject of a task's comments, by the task its query names under
 * `?id=` and the page under `&page=`, its description's own threads where it
 * names none: its threads, their entries, and their files, one statement
 * each. The service answers `not-found` for a task the account does not
 * reach.
 */
export const TASK_COMMENTS_READ = liveRead({
  name: "taskComments",
  path: HOSTED_SERVICE_PATH.LIVE_TASK_COMMENTS,
  params: { id: LIVE_PARAM.ID, page: LIVE_PARAM.OPTIONAL_ID, [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: { threads: THREADS, entries: ENTRIES, files: FILES },
  refuses: refuses(HOSTED_API_ERROR.NOT_FOUND),
});

/** One subject's threads, entries, and files as Realtime delivers them: none for a task the account no longer reaches. */
type TaskCommentsLiveRows = typeof TASK_COMMENTS_READ.rows.Type;

type ThreadLiveRow = LiveRowOf<typeof THREADS>;

type EntryLiveRow = LiveRowOf<typeof ENTRIES>;

type FileLiveRow = LiveRowOf<typeof FILES>;

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
function askedOf(row: EntryLiveRow): DescriptionCommentAsked | undefined {
  if (row.askedActor === DESCRIPTION_COMMENT_ACTOR.APP)
    return { actor: DESCRIPTION_COMMENT_ACTOR.APP };
  return row.askedActor === DESCRIPTION_COMMENT_ACTOR.AGENT && row.askedAgentId !== null
    ? { actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId: row.askedAgentId }
    : undefined;
}

/** An entry as the wire carries it, each absent field left out rather than null, its files in the order they were attached. */
function entryOf(row: EntryLiveRow, files: readonly FileLiveRow[]): DescriptionCommentEntry {
  const by =
    row.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER && row.userId !== null && row.userName !== null
      ? { by: { userId: row.userId, name: row.userName } }
      : undefined;
  const carried = files.map(
    (file): DescriptionCommentFile => ({
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
    entries: entries.map((entry) => entryOf(entry, filesOf.get(entry.id) ?? [])),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

/** The subject's threads as the held read answers them, from their rows: the oldest started first, then by id, each with its entries and their files. */
export function threadsOfLiveRows(rows: TaskCommentsLiveRows): readonly DescriptionCommentThread[] {
  // Note that each group keeps the order its rows stand in, so an entry's place in its thread and a file's on its comment hold within it.
  const entriesOf = groupedBy(orderedLiveRows(ENTRIES, rows.entries), (entry) => entry.threadId);
  const filesOf = groupedBy(orderedLiveRows(FILES, rows.files), (file) => file.entryId);
  return orderedLiveRows(THREADS, rows.threads).map((row) =>
    threadOf(row, entriesOf.get(row.id) ?? [], filesOf),
  );
}
