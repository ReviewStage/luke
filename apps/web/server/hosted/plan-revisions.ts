import {
  EMPTY_PLAN_FIELDS,
  type PlanContent,
  type PlanFieldWriterWho,
  planBody,
} from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  PLAN_HISTORY_BOUNDS,
  type PlanDocument,
  type PlanLastEdit,
  type PlanRevisionAnswer,
  type PlanRevisionLine,
  type PlanRevisionsAnswer,
  planAssumptionSchema,
  planFieldsSchema,
} from "@sidecar/hosted/plan-wire";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { codingAgent } from "../db/coding-agent-schema.js";
import { planRevision } from "../db/plan-revision-schema.js";
import { plan } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * plan-revisions.ts -- a plan's history: every save kept as a revision under the writer who made it.
 *
 * The plan's one write (`plan-notes.ts`) records each save that changed the
 * plan here, inside the transaction that holds the plan's row, so the plan
 * and its history never disagree. A revision is the plan's content after it,
 * whole, the template's fields or a document's text, so reading one or going
 * back to one is a read and never a replay.
 * Saves the same writer makes one after another are one revision, moved on
 * by each: the notetaker's on one call, a coding agent's, or the developer's,
 * each while the revision's latest save is a few minutes old at most. A plan
 * that was written before history began has no revision for that content, so
 * the first save that finds it records it first, under `earlier`, at the
 * plan's last save, and the save after it has something to differ from. The
 * developer restoring a revision is a save like any other, kept as a revision
 * of its own that names the one it brought back; it joins nothing before it,
 * and nothing after it joins it, so each restore stands in the history, and
 * a restore is undone by restoring the revision before it.
 *
 * A save is recorded for a plan id handed by a caller that already holds the
 * account's own row under its lock; the history is read under the account,
 * so another account's plan id reads as a plan with none.
 */

/** How the history is kept. */
export const PLAN_REVISION = {
  /** How long after a revision's latest save the same writer's next save still joins it. */
  JOIN_WITHIN_MS: 10 * 60_000,
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

/** A plan's content as a revision keeps it: the template's fields and assumptions, or the whole text of a plan that is one document. */
export type RevisionContent = PlanContent | { readonly text: string };

/** One save to record: the plan, its writer, its content before and after, and how many changes it made. */
export interface PlanSaveRecord {
  readonly planId: string;
  readonly writer: PlanWriter;
  readonly before: RevisionContent;
  readonly after: RevisionContent;
  readonly changes: number;
  /** The plan's last save before this one, where it has been saved; none for a plan never written. */
  readonly savedBefore: Option.Option<Date>;
}

type RevisionFailure = SqlError | Schema.SchemaError;

const RevisionRowSchema = Schema.Struct({
  seq: Schema.Number,
  actor: Schema.Literals(Object.values(PLAN_ACTOR)),
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
  execute: (planId) =>
    db
      .select({
        seq: planRevision.seq,
        actor: planRevision.actor,
        agentId: planRevision.agentId,
        liveSessionId: planRevision.liveSessionId,
        changes: planRevision.changes,
        at: planRevision.at,
        restoredFrom: planRevision.restoredFrom,
      })
      .from(planRevision)
      .where(eq(planRevision.planId, planId))
      .orderBy(desc(planRevision.seq))
      .limit(1),
});

const insertRevision = SqlSchema.void({
  Request: Schema.Struct({
    planId: Schema.String,
    seq: Schema.Number,
    actor: Schema.Literals(Object.values(PLAN_ACTOR)),
    agentId: Schema.NullOr(Schema.String),
    liveSessionId: Schema.NullOr(Schema.String),
    fields: Schema.NullOr(planFieldsSchema),
    assumptions: Schema.Array(planAssumptionSchema),
    document: Schema.NullOr(Schema.String),
    changes: Schema.Number,
    startedAt: Schema.Date,
    at: Schema.Date,
    restoredFrom: Schema.NullOr(Schema.Number),
  }),
  execute: (revision) => db.insert(planRevision).values(revision),
});

const moveRevisionOn = SqlSchema.void({
  Request: Schema.Struct({
    planId: Schema.String,
    seq: Schema.Number,
    fields: Schema.NullOr(planFieldsSchema),
    assumptions: Schema.Array(planAssumptionSchema),
    document: Schema.NullOr(Schema.String),
    changes: Schema.Number,
    at: Schema.Date,
  }),
  execute: ({ planId, seq, ...moved }) =>
    db
      .update(planRevision)
      .set(moved)
      .where(and(eq(planRevision.planId, planId), eq(planRevision.seq, seq))),
});

const LastEditRowSchema = Schema.Struct({
  actor: Schema.Literals(Object.values(PLAN_ACTOR)),
  liveSessionId: Schema.NullOr(Schema.String),
  at: InstantColumnSchema,
  agentModel: Schema.NullOr(Schema.String),
  agentTitle: Schema.NullOr(Schema.String),
});

const findLastEdit = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: LastEditRowSchema,
  execute: (planId) =>
    db
      .select({
        actor: planRevision.actor,
        liveSessionId: planRevision.liveSessionId,
        at: planRevision.at,
        agentModel: codingAgent.model,
        agentTitle: codingAgent.title,
      })
      .from(planRevision)
      .leftJoin(codingAgent, eq(codingAgent.id, planRevision.agentId))
      .where(eq(planRevision.planId, planId))
      .orderBy(desc(planRevision.seq))
      .limit(1),
});

/** The revision a restore brought back, read beside the restore that names it. */
const restored = alias(planRevision, "restored");

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
 * A page of the account's plan's revisions, the newest first, before the one
 * `before` names where it names one, with one past the page read to say
 * whether an older page stands.
 */
const findRevisionLines = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    before: Schema.NullOr(Schema.Number),
  }),
  Result: RevisionLineRowSchema,
  execute: ({ userId, planId, before }) =>
    db
      .select({
        actor: planRevision.actor,
        liveSessionId: planRevision.liveSessionId,
        at: planRevision.at,
        agentModel: codingAgent.model,
        agentTitle: codingAgent.title,
        seq: planRevision.seq,
        startedAt: planRevision.startedAt,
        changes: planRevision.changes,
        restoredFrom: planRevision.restoredFrom,
        restoredAt: restored.at,
      })
      .from(planRevision)
      .innerJoin(plan, eq(plan.id, planRevision.planId))
      .leftJoin(codingAgent, eq(codingAgent.id, planRevision.agentId))
      .leftJoin(
        restored,
        and(eq(restored.planId, planRevision.planId), eq(restored.seq, planRevision.restoredFrom)),
      )
      .where(
        and(
          eq(planRevision.planId, planId),
          eq(plan.userId, userId),
          before === null ? undefined : lt(planRevision.seq, before),
        ),
      )
      .orderBy(desc(planRevision.seq))
      .limit(PLAN_HISTORY_BOUNDS.PAGE + 1),
});

const RevisionContentRowSchema = Schema.Struct({
  seq: Schema.Number,
  name: Schema.String,
  fields: Schema.NullOr(planFieldsSchema),
  assumptions: Schema.Array(planAssumptionSchema),
  document: Schema.NullOr(Schema.String),
});

type RevisionContentRow = typeof RevisionContentRowSchema.Type;

/** The content of the account's plan at each revision named, with the plan's name as it stands now. */
const findRevisionContents = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    seqs: Schema.Array(Schema.Number),
  }),
  Result: RevisionContentRowSchema,
  execute: ({ userId, planId, seqs }) =>
    db
      .select({
        seq: planRevision.seq,
        name: plan.name,
        fields: planRevision.fields,
        assumptions: planRevision.assumptions,
        document: planRevision.document,
      })
      .from(planRevision)
      .innerJoin(plan, eq(plan.id, planRevision.planId))
      .where(
        and(
          eq(planRevision.planId, planId),
          eq(plan.userId, userId),
          inArray(planRevision.seq, [...seqs]),
        ),
      ),
});

/** The columns a revision keeps its content in: the fields and assumptions, or the text with neither. */
function contentColumns(content: RevisionContent) {
  return "text" in content
    ? { fields: null, assumptions: [], document: content.text }
    : { fields: content.fields, assumptions: content.assumptions, document: null };
}

/** A revision's writer and latest save as the window reads them, a coding agent named as its row names it now. */
function lastEditOf(row: LastEditRow): PlanLastEdit {
  return {
    actor: row.actor,
    ...(row.actor === PLAN_ACTOR.AGENT
      ? { label: row.agentTitle ?? row.agentModel ?? UNKNOWN_AGENT_LABEL }
      : undefined),
    at: row.at.getTime(),
    duringCall: row.liveSessionId !== null,
  };
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
 * because each is the one revision that undoes it.
 */
function joins(newest: RevisionRow, writer: PlanWriter, now: Date): boolean {
  return (
    newest.restoredFrom === null &&
    restoredOf(writer) === null &&
    newest.actor === writer.actor &&
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
): Effect.Effect<number, RevisionFailure, SqlClient.SqlClient> {
  return Option.match(record.savedBefore, {
    onNone: () => Effect.succeed(0),
    onSome: (at) =>
      Effect.as(
        insertRevision({
          planId: record.planId,
          seq: 1,
          actor: PLAN_ACTOR.EARLIER,
          agentId: null,
          liveSessionId: null,
          ...contentColumns(record.before),
          changes: 0,
          startedAt: at,
          at,
          restoredFrom: null,
        }),
        1,
      ),
  });
}

/** The writer as each field their save changed keeps them: the actor, the agent where one wrote, and whether on a call. */
export function fieldWriterOf(writer: PlanWriter): PlanFieldWriterWho {
  const agentId = agentOf(writer);
  return {
    actor: writer.actor,
    ...(agentId === null ? undefined : { agentId }),
    ...(callOf(writer) === null ? undefined : { duringCall: true }),
  };
}

/**
 * Records one save that changed the plan: the newest revision moved on where
 * the same writer made it lately, a new revision otherwise. Run inside the
 * transaction that holds the plan's row, so two saves of one plan never take
 * one number.
 */
export function recordRevision(
  record: PlanSaveRecord,
): Effect.Effect<void, RevisionFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const { writer, after } = record;
    const newest = yield* findNewestRevision(record.planId);
    if (Option.isSome(newest) && joins(newest.value, writer, now)) {
      return yield* moveRevisionOn({
        planId: record.planId,
        seq: newest.value.seq,
        ...contentColumns(after),
        changes: newest.value.changes + record.changes,
        at: now,
      });
    }
    const last = Option.isSome(newest) ? newest.value.seq : yield* recordEarlier(record);
    yield* insertRevision({
      planId: record.planId,
      seq: last + 1,
      actor: writer.actor,
      agentId: agentOf(writer),
      liveSessionId: callOf(writer),
      ...contentColumns(after),
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
  planId: string,
): Effect.Effect<Option.Option<PlanLastEdit>, RevisionFailure, SqlClient.SqlClient> {
  return Effect.map(findLastEdit(planId), Option.map(lastEditOf));
}

/**
 * A page of the account's plan's revisions, the newest first, before the
 * revision `before` names where it names one, and what the next older page
 * is read before where one stands; no revision for a plan with no history
 * yet, and for a plan id the account does not own.
 */
export function listRevisions(
  userId: string,
  planId: string,
  before?: number,
): Effect.Effect<PlanRevisionsAnswer, RevisionFailure, SqlClient.SqlClient> {
  return Effect.map(findRevisionLines({ userId, planId, before: before ?? null }), (rows) => {
    const page = rows.slice(0, PLAN_HISTORY_BOUNDS.PAGE);
    const revisions = page.map(
      (row): PlanRevisionLine => ({
        seq: row.seq,
        lastEdit: lastEditOf(row),
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

/** The account's plan's content at one revision; nothing where it has no such revision, or the account owns no such plan. */
export function readRevisionContent(
  userId: string,
  planId: string,
  seq: number,
): Effect.Effect<Option.Option<RevisionContent>, RevisionFailure, SqlClient.SqlClient> {
  return Effect.map(findRevisionContents({ userId, planId, seqs: [seq] }), (rows) =>
    Option.map(
      Option.fromNullishOr(rows[0]),
      ({ fields, assumptions, document }): RevisionContent =>
        document !== null
          ? { text: document }
          : { fields: fields ?? EMPTY_PLAN_FIELDS, assumptions },
    ),
  );
}

/**
 * A revision as the History tab reads it: a document plan's text as its body,
 * or the template's fields formatted under the plan's name as it stands now.
 */
function revisionDocument(row: RevisionContentRow): PlanDocument {
  if (row.document !== null) return { body: row.document, assumptions: [] };
  return {
    body: planBody({ name: row.name }, row.fields ?? EMPTY_PLAN_FIELDS),
    assumptions: row.assumptions,
  };
}

/**
 * One revision of the account's plan as the History tab shows it: the plan
 * after it and before it, the first revision having nothing before it, each
 * as `revisionDocument` reads it; nothing where the plan
 * has no such revision, or the account owns no such plan.
 */
export function readRevision(
  userId: string,
  planId: string,
  seq: number,
): Effect.Effect<
  Option.Option<PlanRevisionAnswer["revision"]>,
  RevisionFailure,
  SqlClient.SqlClient
> {
  return Effect.map(findRevisionContents({ userId, planId, seqs: [seq - 1, seq] }), (rows) => {
    const documentAt = (at: number): PlanDocument | null => {
      const row = rows.find((each) => each.seq === at);
      return row === undefined ? null : revisionDocument(row);
    };
    const document = documentAt(seq);
    return document === null
      ? Option.none()
      : Option.some({ seq, document, previous: documentAt(seq - 1) });
  });
}
