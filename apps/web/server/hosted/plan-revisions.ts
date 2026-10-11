import { type PlanContent, planFieldsSchema } from "@sidecar/hosted/plan-template";
import { PLAN_ACTOR, type PlanLastEdit, planAssumptionSchema } from "@sidecar/hosted/plan-wire";
import { and, desc, eq } from "drizzle-orm";
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
 * whole, so reading one or going back to one is a read and never a replay.
 * Saves the same writer makes one after another are one revision, moved on
 * by each: the notetaker's on one call, or a coding agent's, each while the
 * revision's latest save is a few minutes old at most. A plan
 * that was written before history began has no revision for that content, so
 * the first save that finds it records it first, under `earlier`, at the
 * plan's last save, and the save after it has something to differ from.
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

/** Who made a save: the notetaker, on the call it listens to where it has one, or a coding agent. */
export type PlanWriter =
  | { readonly actor: typeof PLAN_ACTOR.NOTETAKER; readonly liveSessionId?: string }
  | { readonly actor: typeof PLAN_ACTOR.AGENT; readonly agentId: string };

/** One save to record: the plan, its writer, its content before and after, and how many changes it made. */
export interface PlanSaveRecord {
  readonly planId: string;
  readonly writer: PlanWriter;
  readonly before: PlanContent;
  readonly after: PlanContent;
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
    fields: planFieldsSchema,
    assumptions: Schema.Array(planAssumptionSchema),
    changes: Schema.Number,
    startedAt: Schema.Date,
    at: Schema.Date,
  }),
  execute: (revision) => db.insert(planRevision).values(revision),
});

const moveRevisionOn = SqlSchema.void({
  Request: Schema.Struct({
    planId: Schema.String,
    seq: Schema.Number,
    fields: planFieldsSchema,
    assumptions: Schema.Array(planAssumptionSchema),
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

/** One revision as the plan's history lists it, the newest first. */
export interface PlanRevisionLine {
  readonly seq: number;
  readonly lastEdit: PlanLastEdit;
  /** Epoch milliseconds of the revision's first save. */
  readonly startedAt: number;
  readonly changes: number;
}

const RevisionLineRowSchema = Schema.Struct({
  ...LastEditRowSchema.fields,
  seq: Schema.Number,
  startedAt: InstantColumnSchema,
  changes: Schema.Number,
});

type LastEditRow = typeof LastEditRowSchema.Type;

const findRevisionLines = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String }),
  Result: RevisionLineRowSchema,
  execute: ({ userId, planId }) =>
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
      })
      .from(planRevision)
      .innerJoin(plan, eq(plan.id, planRevision.planId))
      .leftJoin(codingAgent, eq(codingAgent.id, planRevision.agentId))
      .where(and(eq(planRevision.planId, planId), eq(plan.userId, userId)))
      .orderBy(desc(planRevision.seq)),
});

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

/** Whether a save by the writer, now, joins the newest revision rather than starting one. */
function joins(newest: RevisionRow, writer: PlanWriter, now: Date): boolean {
  return (
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
          fields: record.before.fields,
          assumptions: record.before.assumptions,
          changes: 0,
          startedAt: at,
          at,
        }),
        1,
      ),
  });
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
        fields: after.fields,
        assumptions: after.assumptions,
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
      fields: after.fields,
      assumptions: after.assumptions,
      changes: record.changes,
      startedAt: now,
      at: now,
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
 * Every revision of the account's plan, the newest first; none for a plan
 * with no history yet, and for a plan id the account does not own.
 */
export function listRevisions(
  userId: string,
  planId: string,
): Effect.Effect<readonly PlanRevisionLine[], RevisionFailure, SqlClient.SqlClient> {
  return Effect.map(findRevisionLines({ userId, planId }), (rows) =>
    rows.map((row) => ({
      seq: row.seq,
      lastEdit: lastEditOf(row),
      startedAt: row.startedAt.getTime(),
      changes: row.changes,
    })),
  );
}
