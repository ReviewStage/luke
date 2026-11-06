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

/**
 * description-revisions.ts -- a description's history: every save kept as a revision under the writer who made it.
 *
 * The description's one write (`description-notes.ts`) records each save that changed the
 * description here, inside the transaction that holds the task's row, so the description
 * and its history never disagree. A revision is the description's content after it,
 * its whole text, so reading one or going back to one is a read and never a
 * replay.
 * Saves the same writer makes one after another are one revision, moved on
 * by each: the notetaker's, a coding agent's, or the developer's, each
 * while the revision's latest save is a few minutes old at most. A
 * revision names the member it was made for, the developer editing or the
 * one whose turn the notetaker wrote on, so two members' saves are never one
 * revision, and each reads the other's by name. A description
 * that was written before history began has no revision for that content, so
 * the first save that finds it records it first, under `earlier`, at the
 * description's last save, and the save after it has something to differ from. The
 * developer restoring a revision is a save like any other, kept as a revision
 * of its own that names the one it brought back; it joins nothing before it,
 * and nothing after it joins it, so each restore stands in the history, and
 * a restore is undone by restoring the revision before it.
 * Who last changed each section is read off the newest revisions, each
 * against the one before it, rather than kept beside the description.
 *
 * A save is recorded for a task id handed by a caller that already holds the
 * task's row under its lock; the history is read under the account's
 * membership of the task's workspace, so every member reads the history any
 * of them wrote, and a task of a workspace the account is not in reads as a
 * task with none.
 */

/** How the history is kept. */
export const DESCRIPTION_REVISION = {
  /** How long after a revision's latest save the same writer's next save still joins it. */
  JOIN_WITHIN_MS: 10 * 60_000,
  /** The newest revisions who last changed each section is read off; a section none of them changed names nobody. */
  SECTION_HISTORY: 50,
} as const;

/**
 * Who made a save: the notetaker, a coding agent, or the developer, editing
 * a field or, with the revision they restored, restoring one.
 */
export type DescriptionWriter =
  | { readonly actor: typeof DESCRIPTION_ACTOR.NOTETAKER }
  | { readonly actor: typeof DESCRIPTION_ACTOR.AGENT; readonly agentId: string }
  | { readonly actor: typeof DESCRIPTION_ACTOR.DEVELOPER; readonly restoredFrom?: number };

/** One save to record: the description, its writer and the member who made it, its content before and after, and how many changes it made. */
export interface DescriptionSaveRecord {
  readonly taskId: string;
  readonly writer: DescriptionWriter;
  /**
   * The member the save is made for: the developer editing, or the one whose
   * turn the notetaker writes on. A coding agent's save names none.
   */
  readonly userId: string;
  /** The description's text before the save. */
  readonly before: string;
  /** Its text after it. */
  readonly after: string;
  readonly changes: number;
  /** The description's last save before this one, where it has been saved; none for a description never written. */
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

/** The id of the transaction a write is part of, read in the write's own `RETURNING`, which Realtime names each change it delivers by. */
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

/** The revision a restore brought back, read beside the restore that names it. */
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

/**
 * A page of the description's revisions, the newest first, before the one
 * `before` names where it names one, with one past the page read to say
 * whether an older page stands.
 */
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
  // Every revision is the description's text since the backfill, so a row with none is the store breaking its own contract.
  document: Schema.String,
});

/** The content of the description at each revision named, with the task's name as it stands now. */
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

/** The description's newest revisions with their text, newest first, with one past the bound read as the text the oldest changed. */
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

/** The member a revision names, where its account still stands; a coding agent's names none. */
function editorOf(row: { readonly editorId: string | null; readonly editorName: string | null }): {
  readonly by?: DescriptionEditor;
} {
  return row.editorId === null || row.editorName === null
    ? {}
    : { by: { userId: row.editorId, name: row.editorName } };
}

/** A revision's writer and latest save as the window reads them, a coding agent named as its row names it now. */
function lastEditOf(row: LastEditRow): DescriptionLastEdit {
  return {
    actor: row.actor,
    ...editorOf(row),
    ...(row.actor === DESCRIPTION_ACTOR.AGENT
      ? { label: row.agentTitle ?? row.agentModel ?? UNKNOWN_AGENT_LABEL }
      : undefined),
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    at: row.at.getTime(),
    // Note that no revision is written on a call any more, and a released desktop still requires the key.
    duringCall: false,
  };
}

/** The member a save is kept under: none for a coding agent's, whose writer is the agent. */
function memberOf(record: DescriptionSaveRecord): string | null {
  return record.writer.actor === DESCRIPTION_ACTOR.AGENT ? null : record.userId;
}

/** The writer's agent, where a coding agent wrote it. */
function agentOf(writer: DescriptionWriter): string | null {
  return writer.actor === DESCRIPTION_ACTOR.AGENT ? writer.agentId : null;
}

/** The revision the writer restored, where the save is the developer's restore of one. */
function restoredOf(writer: DescriptionWriter): number | null {
  return writer.actor === DESCRIPTION_ACTOR.DEVELOPER ? (writer.restoredFrom ?? null) : null;
}

/**
 * Whether a save by the writer, now, joins the newest revision rather than
 * starting one. Note that a restore joins nothing and nothing joins it,
 * because each is the one revision that undoes it, and that two members'
 * saves never join, because each revision names one member.
 */
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

/**
 * The revision a description from before history stood at, recorded as the description's
 * first, so the first revision recorded after it has something to differ
 * from; nothing for a description never written, whose first revision differs from
 * the text it started as. Answers the number it took, zero where it took none.
 */
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

/** A revision's writer as each section it changed names them: the actor, and the member or the agent where one wrote. */
function writerOf(row: SectionRevisionRow): DescriptionSectionWriterWho {
  return {
    actor: row.actor,
    ...editorOf(row),
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
  };
}

/**
 * Records one save that changed the description: the newest revision moved on where
 * the same writer, for the same member, made it lately, a new revision
 * otherwise, kept under the member. Run inside the
 * transaction that holds the task's row, so two saves of one description never take
 * one number. Answers the id of the transaction it was written in, which a
 * reader following the history over Realtime waits for.
 */
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

/**
 * The description's newest revision as its "Edited by" line reads it: who wrote it,
 * a coding agent named as its row names it now, and when; nothing for a description
 * with no history yet.
 */
export function readLastEdit(
  taskId: string,
): Effect.Effect<Option.Option<DescriptionLastEdit>, StoreFailure, DatabaseServices> {
  return Effect.map(findLastEdit(taskId), Option.map(lastEditOf));
}

/**
 * Who last changed each section of a description, read off its newest revisions
 * (`sectionWritersOf`); none for a description with no history yet. The oldest read
 * is only the text the next changed where it is past the bound or the description
 * as it stood before history, `earlier`, which no writer wrote. The description's
 * first revision is read against the empty text every description starts as, where
 * it is among those read.
 */
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

/**
 * A page of the description's revisions, the newest first, before the
 * revision `before` names where it names one, and what the next older page
 * is read before where one stands; no revision for a description with no history
 * yet, and for a task id the account does not own.
 */
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

/** The description's text at one revision; nothing where it has no such revision, or the account reaches no such task. */
export function readRevisionContent(
  userId: string,
  taskId: string,
  seq: number,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(findRevisionContents({ userId, taskId, seqs: [seq] }), (rows) =>
    Option.map(Option.fromNullishOr(rows[0]), (row) => row.document),
  );
}

/**
 * One revision of the description as the History tab shows it: the description
 * after it and before it, the first revision having nothing before it, each
 * its text as the document's body; nothing where the description
 * has no such revision, or the account reaches no such task.
 */
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
