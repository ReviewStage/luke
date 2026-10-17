import {
  type PlanSectionWriter,
  type PlanSectionWriterWho,
  sectionWritersOf,
} from "@luke/features/plan-document";
import {
  PLAN_ACTOR,
  PLAN_HISTORY_BOUNDS,
  type PlanDocument,
  type PlanEditor,
  type PlanLastEdit,
  type PlanRevisionAnswer,
  type PlanRevisionLine,
  type PlanRevisionsAnswer,
} from "@luke/features/task-wire";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { user } from "../schemas/auth.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { planRevision } from "../schemas/plan-revision.js";
import { task } from "../schemas/task.js";
import { voiceSessions } from "../schemas/voice.js";
import { InstantColumnSchema } from "./columns.js";
import { taskReachableBy } from "./workspace-store.js";

/**
 * plan-revisions.ts -- a plan's history: every save kept as a revision under the writer who made it.
 *
 * The plan's one write (`plan-notes.ts`) records each save that changed the
 * plan here, inside the transaction that holds the plan's row, so the plan
 * and its history never disagree. A revision is the plan's content after it,
 * its whole text, so reading one or going back to one is a read and never a
 * replay.
 * Saves the same writer makes one after another are one revision, moved on
 * by each: the notetaker's on one call, a coding agent's, or the developer's,
 * each while the revision's latest save is a few minutes old at most. A
 * revision names the member it was made for, the developer editing or the
 * one whose call the notetaker wrote on, so two members' saves are never one
 * revision, and each reads the other's by name. A plan
 * that was written before history began has no revision for that content, so
 * the first save that finds it records it first, under `earlier`, at the
 * plan's last save, and the save after it has something to differ from. The
 * developer restoring a revision is a save like any other, kept as a revision
 * of its own that names the one it brought back; it joins nothing before it,
 * and nothing after it joins it, so each restore stands in the history, and
 * a restore is undone by restoring the revision before it.
 * Who last changed each section is read off the newest revisions, each
 * against the one before it, rather than kept beside the plan.
 *
 * A save is recorded for a plan id handed by a caller that already holds the
 * plan's row under its lock; the history is read under the account's
 * membership of the plan's workspace, so every member reads the history any
 * of them wrote, and a plan of a workspace the account is not in reads as a
 * plan with none.
 */

/** How the history is kept. */
export const PLAN_REVISION = {
  /** How long after a revision's latest save the same writer's next save still joins it. */
  JOIN_WITHIN_MS: 10 * 60_000,
  /** The newest revisions who last changed each section is read off; a section none of them changed names nobody. */
  SECTION_HISTORY: 50,
} as const;

/** How an agent whose row is gone is named: a discarded start, or a row from before the journal. */
export const UNKNOWN_AGENT_LABEL = "a coding agent";

/**
 * Who made a save: the notetaker, on the call it listens to where it has
 * one, a coding agent, or the developer, editing a field or, with the
 * revision they restored, restoring one.
 */
export type PlanWriter =
  | { readonly actor: typeof PLAN_ACTOR.NOTETAKER; readonly liveSessionId?: string }
  | { readonly actor: typeof PLAN_ACTOR.AGENT; readonly agentId: string }
  | { readonly actor: typeof PLAN_ACTOR.DEVELOPER; readonly restoredFrom?: number };

/** One save to record: the plan, its writer and the member who made it, its content before and after, and how many changes it made. */
export interface PlanSaveRecord {
  readonly taskId: string;
  readonly writer: PlanWriter;
  /**
   * The member the save is made for: the developer editing, or the one whose
   * call or turn the notetaker writes on. A coding agent's save names none.
   */
  readonly userId: string;
  /** The plan's text before the save. */
  readonly before: string;
  /** Its text after it. */
  readonly after: string;
  readonly changes: number;
  /** The plan's last save before this one, where it has been saved; none for a plan never written. */
  readonly savedBefore: Option.Option<Date>;
}

type RevisionFailure = QueryError | Schema.SchemaError;

const RevisionRowSchema = Schema.Struct({
  seq: Schema.Number,
  actor: Schema.Literals(Object.values(PLAN_ACTOR)),
  userId: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  liveSessionId: Schema.NullOr(Schema.String),
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
          seq: planRevision.seq,
          actor: planRevision.actor,
          userId: planRevision.userId,
          agentId: planRevision.agentId,
          liveSessionId: planRevision.liveSessionId,
          changes: planRevision.changes,
          at: planRevision.at,
          restoredFrom: planRevision.restoredFrom,
        })
        .from(planRevision)
        .where(eq(planRevision.taskId, taskId))
        .orderBy(desc(planRevision.seq))
        .limit(1),
    ),
});

const insertRevision = SqlSchema.void({
  Request: Schema.Struct({
    taskId: Schema.String,
    seq: Schema.Number,
    actor: Schema.Literals(Object.values(PLAN_ACTOR)),
    userId: Schema.NullOr(Schema.String),
    agentId: Schema.NullOr(Schema.String),
    liveSessionId: Schema.NullOr(Schema.String),
    document: Schema.String,
    changes: Schema.Number,
    startedAt: Schema.Date,
    at: Schema.Date,
    restoredFrom: Schema.NullOr(Schema.Number),
  }),
  execute: (revision) => Database.use((db) => db.insert(planRevision).values(revision)),
});

const moveRevisionOn = SqlSchema.void({
  Request: Schema.Struct({
    taskId: Schema.String,
    seq: Schema.Number,
    document: Schema.String,
    changes: Schema.Number,
    at: Schema.Date,
  }),
  execute: ({ taskId, seq, ...moved }) =>
    Database.use((db) =>
      db
        .update(planRevision)
        .set(moved)
        .where(and(eq(planRevision.taskId, taskId), eq(planRevision.seq, seq))),
    ),
});

const LastEditRowSchema = Schema.Struct({
  actor: Schema.Literals(Object.values(PLAN_ACTOR)),
  editorId: Schema.NullOr(Schema.String),
  editorName: Schema.NullOr(Schema.String),
  liveSessionId: Schema.NullOr(Schema.String),
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
          actor: planRevision.actor,
          editorId: user.id,
          editorName: user.name,
          liveSessionId: planRevision.liveSessionId,
          at: planRevision.at,
          agentId: planRevision.agentId,
          agentModel: codingAgent.model,
          agentTitle: codingAgent.title,
        })
        .from(planRevision)
        .leftJoin(codingAgent, eq(codingAgent.id, planRevision.agentId))
        .leftJoin(user, eq(user.id, planRevision.userId))
        .where(eq(planRevision.taskId, taskId))
        .orderBy(desc(planRevision.seq))
        .limit(1),
    ),
});

/** The revision a restore brought back, read beside the restore that names it. */
const restored = alias(planRevision, "restored");

const RevisionLineRowSchema = Schema.Struct({
  ...LastEditRowSchema.fields,
  callId: Schema.NullOr(Schema.String),
  seq: Schema.Number,
  startedAt: InstantColumnSchema,
  changes: Schema.Number,
  restoredFrom: Schema.NullOr(Schema.Number),
  restoredAt: Schema.NullOr(InstantColumnSchema),
});

type LastEditRow = typeof LastEditRowSchema.Type;

/**
 * A page of the plan's revisions, the newest first, before the one
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
          actor: planRevision.actor,
          editorId: user.id,
          editorName: user.name,
          liveSessionId: planRevision.liveSessionId,
          at: planRevision.at,
          agentModel: codingAgent.model,
          agentTitle: codingAgent.title,
          agentId: planRevision.agentId,
          callId: voiceSessions.id,
          seq: planRevision.seq,
          startedAt: planRevision.startedAt,
          changes: planRevision.changes,
          restoredFrom: planRevision.restoredFrom,
          restoredAt: restored.at,
        })
        .from(planRevision)
        .innerJoin(task, eq(task.id, planRevision.taskId))
        .leftJoin(codingAgent, eq(codingAgent.id, planRevision.agentId))
        .leftJoin(user, eq(user.id, planRevision.userId))
        // The call a revision names by its Live API id, read as the transcript names it.
        .leftJoin(
          voiceSessions,
          and(
            eq(voiceSessions.liveSessionId, planRevision.liveSessionId),
            eq(voiceSessions.userId, userId),
          ),
        )
        .leftJoin(
          restored,
          and(
            eq(restored.taskId, planRevision.taskId),
            eq(restored.seq, planRevision.restoredFrom),
          ),
        )
        .where(
          and(
            eq(planRevision.taskId, taskId),
            taskReachableBy(userId),
            before === null ? undefined : lt(planRevision.seq, before),
          ),
        )
        .orderBy(desc(planRevision.seq))
        .limit(PLAN_HISTORY_BOUNDS.PAGE + 1),
    ),
});

const RevisionContentRowSchema = Schema.Struct({
  seq: Schema.Number,
  // Every revision is the plan's text since the backfill, so a row with none is the store breaking its own contract.
  document: Schema.String,
});

/** The content of the plan at each revision named, with the plan's name as it stands now. */
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
          seq: planRevision.seq,
          document: planRevision.document,
        })
        .from(planRevision)
        .innerJoin(task, eq(task.id, planRevision.taskId))
        .where(
          and(
            eq(planRevision.taskId, taskId),
            taskReachableBy(userId),
            inArray(planRevision.seq, [...seqs]),
          ),
        ),
    ),
});

const SectionRevisionRowSchema = Schema.Struct({
  actor: Schema.Literals(Object.values(PLAN_ACTOR)),
  editorId: Schema.NullOr(Schema.String),
  editorName: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  liveSessionId: Schema.NullOr(Schema.String),
  at: InstantColumnSchema,
  document: Schema.String,
});

type SectionRevisionRow = typeof SectionRevisionRowSchema.Type;

/** The plan's newest revisions with their text, newest first, with one past the bound read as the text the oldest changed. */
const findSectionRevisions = SqlSchema.findAll({
  Request: Schema.String,
  Result: SectionRevisionRowSchema,
  execute: (taskId) =>
    Database.use((db) =>
      db
        .select({
          actor: planRevision.actor,
          editorId: user.id,
          editorName: user.name,
          agentId: planRevision.agentId,
          liveSessionId: planRevision.liveSessionId,
          at: planRevision.at,
          document: planRevision.document,
        })
        .from(planRevision)
        .leftJoin(user, eq(user.id, planRevision.userId))
        .where(eq(planRevision.taskId, taskId))
        .orderBy(desc(planRevision.seq))
        .limit(PLAN_REVISION.SECTION_HISTORY + 1),
    ),
});

/** The member a revision names, where its account still stands; a coding agent's names none. */
function editorOf(row: { readonly editorId: string | null; readonly editorName: string | null }): {
  readonly by?: PlanEditor;
} {
  return row.editorId === null || row.editorName === null
    ? {}
    : { by: { userId: row.editorId, name: row.editorName } };
}

/** A revision's writer and latest save as the window reads them, a coding agent named as its row names it now. */
function lastEditOf(row: LastEditRow): PlanLastEdit {
  return {
    actor: row.actor,
    ...editorOf(row),
    ...(row.actor === PLAN_ACTOR.AGENT
      ? { label: row.agentTitle ?? row.agentModel ?? UNKNOWN_AGENT_LABEL }
      : undefined),
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    at: row.at.getTime(),
    duringCall: row.liveSessionId !== null,
  };
}

/** The member a save is kept under: none for a coding agent's, whose writer is the agent. */
function memberOf(record: PlanSaveRecord): string | null {
  return record.writer.actor === PLAN_ACTOR.AGENT ? null : record.userId;
}

/** The writer's agent, where a coding agent wrote it. */
function agentOf(writer: PlanWriter): string | null {
  return writer.actor === PLAN_ACTOR.AGENT ? writer.agentId : null;
}

/** The writer's call, where the notetaker wrote it on one. */
function callOf(writer: PlanWriter): string | null {
  return writer.actor === PLAN_ACTOR.NOTETAKER ? (writer.liveSessionId ?? null) : null;
}

/** The revision the writer restored, where the save is the developer's restore of one. */
function restoredOf(writer: PlanWriter): number | null {
  return writer.actor === PLAN_ACTOR.DEVELOPER ? (writer.restoredFrom ?? null) : null;
}

/**
 * Whether a save by the writer, now, joins the newest revision rather than
 * starting one. Note that a restore joins nothing and nothing joins it,
 * because each is the one revision that undoes it, and that two members'
 * saves never join, because each revision names one member.
 */
function joins(newest: RevisionRow, record: PlanSaveRecord, now: Date): boolean {
  const { writer } = record;
  return (
    newest.restoredFrom === null &&
    restoredOf(writer) === null &&
    newest.actor === writer.actor &&
    newest.userId === memberOf(record) &&
    newest.agentId === agentOf(writer) &&
    newest.liveSessionId === callOf(writer) &&
    now.getTime() - newest.at.getTime() <= PLAN_REVISION.JOIN_WITHIN_MS
  );
}

/**
 * The revision a plan from before history stood at, recorded as the plan's
 * first, so the first revision recorded after it has something to differ
 * from; nothing for a plan never written, whose first revision differs from
 * the untouched template. Answers the number it took, zero where it took none.
 */
function recordEarlier(
  record: PlanSaveRecord,
): Effect.Effect<number, RevisionFailure, DatabaseServices> {
  return Option.match(record.savedBefore, {
    onNone: () => Effect.succeed(0),
    onSome: (at) =>
      Effect.as(
        insertRevision({
          taskId: record.taskId,
          seq: 1,
          actor: PLAN_ACTOR.EARLIER,
          userId: null,
          agentId: null,
          liveSessionId: null,
          document: record.before,
          changes: 0,
          startedAt: at,
          at,
          restoredFrom: null,
        }),
        1,
      ),
  });
}

/** A revision's writer as each section it changed names them: the actor, the member or the agent where one wrote, and whether on a call. */
function writerOf(row: SectionRevisionRow): PlanSectionWriterWho {
  return {
    actor: row.actor,
    ...editorOf(row),
    ...(row.agentId === null ? undefined : { agentId: row.agentId }),
    ...(row.liveSessionId === null ? undefined : { duringCall: true }),
  };
}

/**
 * Records one save that changed the plan: the newest revision moved on where
 * the same writer, for the same member, made it lately, a new revision
 * otherwise, kept under the member. Run inside the
 * transaction that holds the plan's row, so two saves of one plan never take
 * one number.
 */
export function recordRevision(
  record: PlanSaveRecord,
): Effect.Effect<void, RevisionFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const { writer, after } = record;
    const newest = yield* findNewestRevision(record.taskId);
    if (Option.isSome(newest) && joins(newest.value, record, now)) {
      return yield* moveRevisionOn({
        taskId: record.taskId,
        seq: newest.value.seq,
        document: after,
        changes: newest.value.changes + record.changes,
        at: now,
      });
    }
    const last = Option.isSome(newest) ? newest.value.seq : yield* recordEarlier(record);
    yield* insertRevision({
      taskId: record.taskId,
      seq: last + 1,
      actor: writer.actor,
      userId: memberOf(record),
      agentId: agentOf(writer),
      liveSessionId: callOf(writer),
      document: after,
      changes: record.changes,
      startedAt: now,
      at: now,
      restoredFrom: restoredOf(writer),
    });
  });
}

/**
 * The plan's newest revision as its "Edited by" line reads it: who wrote it,
 * a coding agent named as its row names it now, when, and whether on a call;
 * nothing for a plan with no history yet.
 */
export function readLastEdit(
  taskId: string,
): Effect.Effect<Option.Option<PlanLastEdit>, RevisionFailure, DatabaseServices> {
  return Effect.map(findLastEdit(taskId), Option.map(lastEditOf));
}

/**
 * Who last changed each section of a plan, read off its newest revisions
 * (`sectionWritersOf`); none for a plan with no history yet. The oldest read
 * is only the text the next changed where it is past the bound or the plan
 * as it stood before history, `earlier`, which no writer wrote. The plan's
 * first revision is read against `started`, the text the plan started as,
 * read only where the first revision is among those read.
 */
export function readSectionWriters<E, R>(
  taskId: string,
  started: Effect.Effect<string, E, R>,
): Effect.Effect<readonly PlanSectionWriter[], RevisionFailure | E, DatabaseServices | R> {
  return Effect.gen(function* () {
    const rows = [...(yield* findSectionRevisions(taskId))].reverse();
    const first = rows[0];
    if (first === undefined) return [];
    const fromStart =
      rows.length <= PLAN_REVISION.SECTION_HISTORY && first.actor !== PLAN_ACTOR.EARLIER;
    const base = fromStart ? yield* started : first.document;
    const written = fromStart ? rows : rows.slice(1);
    return sectionWritersOf(
      base,
      written.map((row) => ({ text: row.document, who: writerOf(row), at: row.at.getTime() })),
    );
  });
}

/**
 * A page of the plan's revisions, the newest first, before the
 * revision `before` names where it names one, and what the next older page
 * is read before where one stands; no revision for a plan with no history
 * yet, and for a plan id the account does not own.
 */
export function listRevisions(
  userId: string,
  taskId: string,
  before?: number,
): Effect.Effect<PlanRevisionsAnswer, RevisionFailure, DatabaseServices> {
  return Effect.map(findRevisionLines({ userId, taskId, before: before ?? null }), (rows) => {
    const page = rows.slice(0, PLAN_HISTORY_BOUNDS.PAGE);
    const revisions = page.map(
      (row): PlanRevisionLine => ({
        seq: row.seq,
        lastEdit: lastEditOf(row),
        ...(row.agentId === null ? undefined : { agentId: row.agentId }),
        ...(row.callId === null ? undefined : { callId: row.callId }),
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

/** The plan's text at one revision; nothing where it has no such revision, or the account reaches no such plan. */
export function readRevisionContent(
  userId: string,
  taskId: string,
  seq: number,
): Effect.Effect<Option.Option<string>, RevisionFailure, DatabaseServices> {
  return Effect.map(findRevisionContents({ userId, taskId, seqs: [seq] }), (rows) =>
    Option.map(Option.fromNullishOr(rows[0]), (row) => row.document),
  );
}

/**
 * One revision of the plan as the History tab shows it: the plan
 * after it and before it, the first revision having nothing before it, each
 * its text as the document's body; nothing where the plan
 * has no such revision, or the account reaches no such plan.
 */
export function readRevision(
  userId: string,
  taskId: string,
  seq: number,
): Effect.Effect<Option.Option<PlanRevisionAnswer["revision"]>, RevisionFailure, DatabaseServices> {
  return Effect.map(findRevisionContents({ userId, taskId, seqs: [seq - 1, seq] }), (rows) => {
    const documentAt = (at: number): PlanDocument | null => {
      const row = rows.find((each) => each.seq === at);
      return row === undefined ? null : { body: row.document, assumptions: [] };
    };
    const document = documentAt(seq);
    return document === null
      ? Option.none()
      : Option.some({ seq, document, previous: documentAt(seq - 1) });
  });
}
