import {
  type DescriptionSectionWriter,
  type DescriptionSectionWriterWho,
  sectionWritersOf,
} from "@repo/features/description-document";
import {
  DESCRIPTION_ACTOR,
  DESCRIPTION_HISTORY_BOUNDS,
  type DescriptionDocument,
  type DescriptionEditor,
  type DescriptionLastEdit,
  type DescriptionRevisionAnswer,
  type DescriptionRevisionLine,
  type DescriptionRevisionsAnswer,
  UNKNOWN_AGENT_LABEL,
} from "@repo/features/task-wire";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { user } from "../schemas/auth.js";
import { descriptionRevision } from "../schemas/description-revision.js";
import { task } from "../schemas/task.js";
import { InstantColumnSchema } from "./columns.js";
import { taskReachableBy } from "./workspace-store.js";

export const DESCRIPTION_REVISION = {
  JOIN_WITHIN_MS: 10 * 60_000,
  SECTION_HISTORY: 50,
} as const;

export type DescriptionWriter =
  | { readonly actor: typeof DESCRIPTION_ACTOR.NOTETAKER }
  | { readonly actor: typeof DESCRIPTION_ACTOR.AGENT; readonly agentId: string }
  | { readonly actor: typeof DESCRIPTION_ACTOR.DEVELOPER; readonly restoredFrom?: number };

export interface DescriptionSaveRecord {
  readonly taskId: string;
  readonly writer: DescriptionWriter;
  readonly userId: string;
  readonly before: string;
  readonly after: string;
  readonly changes: number;
  readonly savedBefore: Option.Option<Date>;
}

const RevisionRowSchema = Schema.Struct({
  seq: Schema.Number,
  actor: Schema.Literals(Object.values(DESCRIPTION_ACTOR)),
  userId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  changes: Schema.Number,
  at: InstantColumnSchema,
  restoredFrom: Schema.NullOr(Schema.Number),
});

type RevisionRow = typeof RevisionRowSchema.Type;

const findNewestRevision = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: RevisionRowSchema,
  execute: (taskId) =>
    Database.use((db) =>
      db
        .select({
          seq: descriptionRevision.seq,
          actor: descriptionRevision.actor,
          userId: descriptionRevision.userId,
          agentId: descriptionRevision.agentId,
          changes: descriptionRevision.changes,
          at: descriptionRevision.at,
          restoredFrom: descriptionRevision.restoredFrom,
        })
        .from(descriptionRevision)
        .where(eq(descriptionRevision.taskId, taskId))
        .orderBy(desc(descriptionRevision.seq))
        .limit(1),
    ),
});

const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

const TxIdSchema = Schema.Struct({ txid: Schema.String });

const insertRevision = SqlSchema.findOne({
  Request: Schema.Struct({
    taskId: Schema.String,
    seq: Schema.Number,
    actor: Schema.Literals(Object.values(DESCRIPTION_ACTOR)),
    userId: Schema.NullOr(Schema.String),
    agentId: Schema.NullOr(Schema.String),
    document: Schema.String,
    changes: Schema.Number,
    startedAt: Schema.Date,
    at: Schema.Date,
    restoredFrom: Schema.NullOr(Schema.Number),
  }),
  Result: TxIdSchema,
  execute: (revision) =>
    Database.use((db) => db.insert(descriptionRevision).values(revision).returning(TXID)),
});

const moveRevisionOn = SqlSchema.findOne({
  Request: Schema.Struct({
    taskId: Schema.String,
    seq: Schema.Number,
    document: Schema.String,
    changes: Schema.Number,
    at: Schema.Date,
  }),
  Result: TxIdSchema,
  execute: ({ taskId, seq, ...moved }) =>
    Database.use((db) =>
      db
        .update(descriptionRevision)
        .set(moved)
        .where(and(eq(descriptionRevision.taskId, taskId), eq(descriptionRevision.seq, seq)))
        .returning(TXID),
    ),
});

const LastEditRowSchema = Schema.Struct({
  actor: Schema.Literals(Object.values(DESCRIPTION_ACTOR)),
  editorId: Schema.NullOr(Schema.String),
  editorName: Schema.NullOr(Schema.String),
  at: InstantColumnSchema,
  agentId: Schema.NullOr(Schema.String),
  agentModel: Schema.NullOr(Schema.String),
  agentTitle: Schema.NullOr(Schema.String),
});

const findLastEdit = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: LastEditRowSchema,
  execute: (taskId) =>
    Database.use((db) =>
      db
        .select({
          actor: descriptionRevision.actor,
          editorId: user.id,
          editorName: user.name,
          at: descriptionRevision.at,
          agentId: descriptionRevision.agentId,
          agentModel: agentTable.model,
          agentTitle: agentTable.title,
        })
        .from(descriptionRevision)
        .leftJoin(agentTable, eq(agentTable.id, descriptionRevision.agentId))
        .leftJoin(user, eq(user.id, descriptionRevision.userId))
        .where(eq(descriptionRevision.taskId, taskId))
        .orderBy(desc(descriptionRevision.seq))
        .limit(1),
    ),
});

const restored = alias(descriptionRevision, "restored");

const RevisionLineRowSchema = Schema.Struct({
  ...LastEditRowSchema.fields,
  seq: Schema.Number,
  startedAt: InstantColumnSchema,
  changes: Schema.Number,
  restoredFrom: Schema.NullOr(Schema.Number),
  restoredAt: Schema.NullOr(InstantColumnSchema),
});

type LastEditRow = typeof LastEditRowSchema.Type;

const findRevisionLines = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    before: Schema.NullOr(Schema.Number),
  }),
  Result: RevisionLineRowSchema,
  execute: ({ userId, taskId, before }) =>
    Database.use((db) =>
      db
        .select({
          actor: descriptionRevision.actor,
          editorId: user.id,
          editorName: user.name,
          at: descriptionRevision.at,
          agentModel: agentTable.model,
          agentTitle: agentTable.title,
          agentId: descriptionRevision.agentId,
          seq: descriptionRevision.seq,
          startedAt: descriptionRevision.startedAt,
          changes: descriptionRevision.changes,
          restoredFrom: descriptionRevision.restoredFrom,
          restoredAt: restored.at,
        })
        .from(descriptionRevision)
        .innerJoin(task, eq(task.id, descriptionRevision.taskId))
        .leftJoin(agentTable, eq(agentTable.id, descriptionRevision.agentId))
        .leftJoin(user, eq(user.id, descriptionRevision.userId))
        .leftJoin(
          restored,
          and(
            eq(restored.taskId, descriptionRevision.taskId),
            eq(restored.seq, descriptionRevision.restoredFrom),
          ),
        )
        .where(
          and(
            eq(descriptionRevision.taskId, taskId),
            taskReachableBy(userId),
            before === null ? undefined : lt(descriptionRevision.seq, before),
          ),
        )
        .orderBy(desc(descriptionRevision.seq))
        .limit(DESCRIPTION_HISTORY_BOUNDS.PAGE + 1),
    ),
});

const RevisionContentRowSchema = Schema.Struct({
  seq: Schema.Number,
  document: Schema.String,
});

const findRevisionContents = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.String,
    seqs: Schema.Array(Schema.Number),
  }),
  Result: RevisionContentRowSchema,
  execute: ({ userId, taskId, seqs }) =>
    Database.use((db) =>
      db
        .select({
          seq: descriptionRevision.seq,
          document: descriptionRevision.document,
        })
        .from(descriptionRevision)
        .innerJoin(task, eq(task.id, descriptionRevision.taskId))
        .where(
          and(
            eq(descriptionRevision.taskId, taskId),
            taskReachableBy(userId),
            inArray(descriptionRevision.seq, [...seqs]),
          ),
        ),
    ),
});

const SectionRevisionRowSchema = Schema.Struct({
  actor: Schema.Literals(Object.values(DESCRIPTION_ACTOR)),
  editorId: Schema.NullOr(Schema.String),
  editorName: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  at: InstantColumnSchema,
  document: Schema.String,
});

type SectionRevisionRow = typeof SectionRevisionRowSchema.Type;

const findSectionRevisions = SqlSchema.findAll({
  Request: Schema.String,
  Result: SectionRevisionRowSchema,
  execute: (taskId) =>
    Database.use((db) =>
      db
        .select({
          actor: descriptionRevision.actor,
          editorId: user.id,
          editorName: user.name,
          agentId: descriptionRevision.agentId,
          at: descriptionRevision.at,
          document: descriptionRevision.document,
        })
        .from(descriptionRevision)
        .leftJoin(user, eq(user.id, descriptionRevision.userId))
        .where(eq(descriptionRevision.taskId, taskId))
        .orderBy(desc(descriptionRevision.seq))
        .limit(DESCRIPTION_REVISION.SECTION_HISTORY + 1),
    ),
});

function editorOf(row: { readonly editorId: string | null; readonly editorName: string | null }): {
  readonly by?: DescriptionEditor;
} {
  return row.editorId === null || row.editorName === null
    ? {}
    : { by: { userId: row.editorId, name: row.editorName } };
}

function lastEditOf(row: LastEditRow): DescriptionLastEdit {
  return {
    actor: row.actor,
    ...editorOf(row),
    ...(row.actor === DESCRIPTION_ACTOR.AGENT
      ? { label: row.agentTitle ?? row.agentModel ?? UNKNOWN_AGENT_LABEL }
      : undefined),
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    at: row.at.getTime(),
    duringCall: false,
  };
}

function memberOf(record: DescriptionSaveRecord): string | null {
  return record.writer.actor === DESCRIPTION_ACTOR.AGENT ? null : record.userId;
}

function agentOf(writer: DescriptionWriter): string | null {
  return writer.actor === DESCRIPTION_ACTOR.AGENT ? writer.agentId : null;
}

function restoredOf(writer: DescriptionWriter): number | null {
  return writer.actor === DESCRIPTION_ACTOR.DEVELOPER ? (writer.restoredFrom ?? null) : null;
}

function joins(newest: RevisionRow, record: DescriptionSaveRecord, now: Date): boolean {
  const { writer } = record;
  return (
    newest.restoredFrom === null &&
    restoredOf(writer) === null &&
    newest.actor === writer.actor &&
    newest.userId === memberOf(record) &&
    newest.agentId === agentOf(writer) &&
    now.getTime() - newest.at.getTime() <= DESCRIPTION_REVISION.JOIN_WITHIN_MS
  );
}

function recordEarlier(
  record: DescriptionSaveRecord,
): Effect.Effect<number, StoreFailure, DatabaseServices> {
  return Option.match(record.savedBefore, {
    onNone: () => Effect.succeed(0),
    onSome: (at) =>
      Effect.as(
        insertRevision({
          taskId: record.taskId,
          seq: 1,
          actor: DESCRIPTION_ACTOR.EARLIER,
          userId: null,
          agentId: null,
          document: record.before,
          changes: 0,
          startedAt: at,
          at,
          restoredFrom: null,
        }).pipe(Effect.catchTag("NoSuchElementError", Effect.die)),
        1,
      ),
  });
}

function writerOf(row: SectionRevisionRow): DescriptionSectionWriterWho {
  return {
    actor: row.actor,
    ...editorOf(row),
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
  };
}

export function recordRevision(
  record: DescriptionSaveRecord,
): Effect.Effect<string, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const { writer, after } = record;
    const newest = yield* findNewestRevision(record.taskId);
    if (Option.isSome(newest) && joins(newest.value, record, now)) {
      const moved = yield* moveRevisionOn({
        taskId: record.taskId,
        seq: newest.value.seq,
        document: after,
        changes: newest.value.changes + record.changes,
        at: now,
      }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
      return moved.txid;
    }
    const last = Option.isSome(newest) ? newest.value.seq : yield* recordEarlier(record);
    const inserted = yield* insertRevision({
      taskId: record.taskId,
      seq: last + 1,
      actor: writer.actor,
      userId: memberOf(record),
      agentId: agentOf(writer),
      document: after,
      changes: record.changes,
      startedAt: now,
      at: now,
      restoredFrom: restoredOf(writer),
    }).pipe(Effect.catchTag("NoSuchElementError", Effect.die));
    return inserted.txid;
  });
}

export function readLastEdit(
  taskId: string,
): Effect.Effect<Option.Option<DescriptionLastEdit>, StoreFailure, DatabaseServices> {
  return Effect.map(findLastEdit(taskId), Option.map(lastEditOf));
}

export function readSectionWriters(
  taskId: string,
): Effect.Effect<readonly DescriptionSectionWriter[], StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const rows = [...(yield* findSectionRevisions(taskId))].reverse();
    const first = rows[0];
    if (first === undefined) return [];
    const fromStart =
      rows.length <= DESCRIPTION_REVISION.SECTION_HISTORY &&
      first.actor !== DESCRIPTION_ACTOR.EARLIER;
    const base = fromStart ? "" : first.document;
    const written = fromStart ? rows : rows.slice(1);
    return sectionWritersOf(
      base,
      written.map((row) => ({ text: row.document, who: writerOf(row), at: row.at.getTime() })),
    );
  });
}

export function listRevisions(
  userId: string,
  taskId: string,
  before?: number,
): Effect.Effect<DescriptionRevisionsAnswer, StoreFailure, DatabaseServices> {
  return Effect.map(findRevisionLines({ userId, taskId, before: before ?? null }), (rows) => {
    const page = rows.slice(0, DESCRIPTION_HISTORY_BOUNDS.PAGE);
    const revisions = page.map(
      (row): DescriptionRevisionLine => ({
        seq: row.seq,
        lastEdit: lastEditOf(row),
        ...(row.agentId === null ? undefined : { agentId: row.agentId }),
        startedAt: row.startedAt.getTime(),
        changes: row.changes,
        ...(row.restoredFrom === null || row.restoredAt === null
          ? undefined
          : { restoredFrom: { seq: row.restoredFrom, at: row.restoredAt.getTime() } }),
      }),
    );
    const oldest = page.at(-1);
    return rows.length > page.length && oldest !== undefined
      ? { revisions, earlier: oldest.seq }
      : { revisions };
  });
}

export function readRevisionContent(
  userId: string,
  taskId: string,
  seq: number,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(findRevisionContents({ userId, taskId, seqs: [seq] }), (rows) =>
    Option.map(Option.fromNullishOr(rows[0]), (row) => row.document),
  );
}

export function readRevision(
  userId: string,
  taskId: string,
  seq: number,
): Effect.Effect<
  Option.Option<DescriptionRevisionAnswer["revision"]>,
  StoreFailure,
  DatabaseServices
> {
  return Effect.map(findRevisionContents({ userId, taskId, seqs: [seq - 1, seq] }), (rows) => {
    const documentAt = (at: number): DescriptionDocument | null => {
      const row = rows.find((each) => each.seq === at);
      return row === undefined ? null : { body: row.document, assumptions: [] };
    };
    const document = documentAt(seq);
    return document === null
      ? Option.none()
      : Option.some({ seq, document, previous: documentAt(seq - 1) });
  });
}
