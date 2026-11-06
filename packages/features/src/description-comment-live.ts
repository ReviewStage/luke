import { Schema as EffectSchema } from "effect";
import { sealedLiveQuerySchema } from "./live-wire.js";
import { pageVersionNumberSchema } from "./page-wire.js";
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
import { countedNumber } from "./service-wire.js";

export const taskCommentsLiveAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
  queries: EffectSchema.Struct({
    threads: sealedLiveQuerySchema,
    entries: sealedLiveQuerySchema,
    files: sealedLiveQuerySchema,
  }),
});

export type TaskCommentsLiveAnswer = typeof taskCommentsLiveAnswerSchema.Type;

const threadLiveRowSchema = EffectSchema.Struct({
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
});

const entryLiveRowSchema = EffectSchema.Struct({
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
});

const fileLiveRowSchema = EffectSchema.Struct({
  attachmentId: EffectSchema.String,
  entryId: EffectSchema.String,
  name: EffectSchema.String,
  mediaType: EffectSchema.String,
  position: EffectSchema.NullOr(countedNumber),
});

export const taskCommentsLiveRowsSchema = EffectSchema.Struct({
  threads: EffectSchema.Array(threadLiveRowSchema),
  entries: EffectSchema.Array(entryLiveRowSchema),
  files: EffectSchema.Array(fileLiveRowSchema),
});

type TaskCommentsLiveRows = typeof taskCommentsLiveRowsSchema.Type;

type ThreadLiveRow = TaskCommentsLiveRows["threads"][number];

type EntryLiveRow = TaskCommentsLiveRows["entries"][number];

type FileLiveRow = TaskCommentsLiveRows["files"][number];

function byId(one: string, other: string): number {
  return one < other ? -1 : one > other ? 1 : 0;
}

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

function askedOf(row: EntryLiveRow): DescriptionCommentAsked | undefined {
  if (row.askedActor === DESCRIPTION_COMMENT_ACTOR.APP)
    return { actor: DESCRIPTION_COMMENT_ACTOR.APP };
  return row.askedActor === DESCRIPTION_COMMENT_ACTOR.AGENT && row.askedAgentId !== null
    ? { actor: DESCRIPTION_COMMENT_ACTOR.AGENT, agentId: row.askedAgentId }
    : undefined;
}

function entryOf(row: EntryLiveRow, files: readonly FileLiveRow[]): DescriptionCommentEntry {
  const by =
    row.actor === DESCRIPTION_COMMENT_ACTOR.MEMBER && row.userId !== null && row.userName !== null
      ? { by: { userId: row.userId, name: row.userName } }
      : undefined;
  const carried = files
    .toSorted((one, other) => (one.position ?? Infinity) - (other.position ?? Infinity))
    .map(
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
    entries: entries
      .toSorted((one, other) => one.seq - other.seq)
      .map((entry) => entryOf(entry, filesOf.get(entry.id) ?? [])),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    revision: row.revision,
  };
}

export function threadsOfLiveRows(rows: TaskCommentsLiveRows): readonly DescriptionCommentThread[] {
  const entriesOf = groupedBy(rows.entries, (entry) => entry.threadId);
  const filesOf = groupedBy(rows.files, (file) => file.entryId);
  return rows.threads
    .toSorted((one, other) => one.createdAt - other.createdAt || byId(one.id, other.id))
    .map((row) => threadOf(row, entriesOf.get(row.id) ?? [], filesOf));
}
