import type { PlanSectionWriterWho } from "@sidecar/hosted/plan-document";
import {
  PLAN_ACTOR,
  PLAN_HISTORY_BOUNDS,
  type PlanDocument,
  type PlanLastEdit,
  type PlanRevisionAnswer,
  type PlanRevisionLine,
  type PlanRevisionsAnswer,
  type Rollout,
  rolloutSchema,
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
import { voiceSessions } from "../db/voice-schema.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * plan-revisions.ts -- a plan's history: every save kept as a revision under the writer who made it.
 *
 * The plan's one write (`plan-notes.ts`) records each save that changed the
 * plan here, inside the transaction that holds the plan's row, so the plan
 * and its history never disagree. A revision is the plan's content after it,
 * its whole text with the rollout beside it, so reading one or going back to one is a read and never a
 * replay.
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

/** A revision's text and the rollout beside it, as a restore takes them back. */
export interface RevisionSnapshot {
  readonly text: string;
  readonly rollout: Rollout;
}

/** One save to record: the plan, its writer, its text and rollout before and after, and how many changes it made. */
export interface PlanSaveRecord {
  readonly planId: string;
  readonly writer: PlanWriter;
  /** The plan's text and rollout before the save. */
  readonly before: RevisionSnapshot;
  /** Its text and rollout after it. */
  readonly after: RevisionSnapshot;
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
    document: Schema.String,
    rollout: rolloutSchema,
    changes: Schema.Number,
    startedAt: Schema.Date,
    at: Schema.Date,
    restoredFrom: Schema.NullOr(Schema.Number),
  }),
  // Note that the fixed template's fields and assumptions are left to their columns' defaults, null and empty, until the migration that drops them.
  execute: (revision) => db.insert(planRevision).values(revision),
});

const moveRevisionOn = SqlSchema.void({
  Request: Schema.Struct({
    planId: Schema.String,
    seq: Schema.Number,
    document: Schema.String,
    rollout: rolloutSchema,
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
  agentId: Schema.NullOr(Schema.String),
  callId: Schema.NullOr(Schema.String),
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
        agentId: planRevision.agentId,
        callId: voiceSessions.id,
        seq: planRevision.seq,
        startedAt: planRevision.startedAt,
        changes: planRevision.changes,
        restoredFrom: planRevision.restoredFrom,
        restoredAt: restored.at,
      })
      .from(planRevision)
      .innerJoin(plan, eq(plan.id, planRevision.planId))
      .leftJoin(codingAgent, eq(codingAgent.id, planRevision.agentId))
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
  // Every revision is the plan's text since the backfill, so a row with none is the store breaking its own contract.
  document: Schema.String,
  rollout: rolloutSchema,
});

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
        document: planRevision.document,
        rollout: planRevision.rollout,
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
          document: record.before.text,
          rollout: record.before.rollout,
          changes: 0,
          startedAt: at,
          at,
          restoredFrom: null,
        }),
        1,
      ),
  });
}

/** The writer as each section their save changed keeps them: the actor, the agent where one wrote, and whether on a call. */
export function writerOf(writer: PlanWriter): PlanSectionWriterWho {
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
        document: after.text,
        rollout: after.rollout,
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
      document: after.text,
      rollout: after.rollout,
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

/** The account's plan's text and rollout at one revision; nothing where it has no such revision, or the account owns no such plan. */
export function readRevisionContent(
  userId: string,
  planId: string,
  seq: number,
): Effect.Effect<Option.Option<RevisionSnapshot>, RevisionFailure, SqlClient.SqlClient> {
  return Effect.map(findRevisionContents({ userId, planId, seqs: [seq] }), (rows) =>
    Option.map(Option.fromNullishOr(rows[0]), (row) => ({
      text: row.document,
      rollout: row.rollout,
    })),
  );
}

/**
 * One revision of the account's plan as the History tab shows it: the plan
 * after it and before it, the first revision having nothing before it, each
 * its text as the document's body with its rollout beside it; nothing where the plan
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
    const documentOf = (row: { readonly document: string }): PlanDocument => ({
      body: row.document,
      assumptions: [],
    });
    const shown = rows.find((each) => each.seq === seq);
    const previous = rows.find((each) => each.seq === seq - 1);
    if (shown === undefined) return Option.none();
    return Option.some({
      seq,
      document: documentOf(shown),
      rollout: shown.rollout,
      previous: previous === undefined ? null : documentOf(previous),
      previousRollout: previous === undefined ? null : previous.rollout,
    });
  });
}
