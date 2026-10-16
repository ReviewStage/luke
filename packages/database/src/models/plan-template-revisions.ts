import { changedSections } from "@luke/features/plan-document";
import {
  DEFAULT_PLAN_TEMPLATE,
  type PlanTemplateRevisionAnswer,
  type PlanTemplateRevisionLine,
  type PlanTemplateRevisionsAnswer,
} from "@luke/features/plan-document-template";
import { PLAN_ACTOR, PLAN_HISTORY_BOUNDS, type PlanDocument } from "@luke/features/task-wire";
import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { planTemplateRevision } from "../schemas/plan-template-revision.js";
import { InstantColumnSchema } from "./columns.js";
import { PLAN_REVISION } from "./plan-revisions.js";

/**
 * plan-template-revisions.ts -- an account's plan template history: every write that changed it kept as a revision.
 *
 * The template's one write (`account-store.ts`'s `writePlanTemplate`)
 * records each write that changed the template here, inside the transaction
 * that holds the account's preference row under its lock, so two writes
 * never take one number. A revision is the template's whole text after it,
 * or null where it is the built-in default, so reading one or going back to
 * one is a read and never a replay, and going back to a reset goes back to
 * the default rather than to a copy of it. The developer's writes within a
 * few minutes of one another are one revision, moved on by each, as a plan's
 * are (`plan-revisions.ts`); a restore and a reset each stand as a revision
 * of their own that joins nothing and that nothing joins. The account's
 * template from before history has no revision, so the first write that
 * finds none records what stood first, under `earlier`, and the write after
 * it has something to differ from. Every read is under the account, so no
 * account reads another's history.
 */

/** One write to record: the account, the template before and after it (null for the default), and the revision it restored, where it is a restore. */
export interface TemplateSaveRecord {
  readonly userId: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly restoredFrom?: number;
}

type RevisionFailure = QueryError | Schema.SchemaError;

const RevisionRowSchema = Schema.Struct({
  seq: Schema.Number,
  actor: Schema.Literals(Object.values(PLAN_ACTOR)),
  document: Schema.NullOr(Schema.String),
  changes: Schema.Number,
  at: InstantColumnSchema,
  restoredFrom: Schema.NullOr(Schema.Number),
});

type RevisionRow = typeof RevisionRowSchema.Type;

const findNewestRevision = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: RevisionRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          seq: planTemplateRevision.seq,
          actor: planTemplateRevision.actor,
          document: planTemplateRevision.document,
          changes: planTemplateRevision.changes,
          at: planTemplateRevision.at,
          restoredFrom: planTemplateRevision.restoredFrom,
        })
        .from(planTemplateRevision)
        .where(eq(planTemplateRevision.userId, userId))
        .orderBy(desc(planTemplateRevision.seq))
        .limit(1),
    ),
});

const insertRevision = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    seq: Schema.Number,
    actor: Schema.Literals(Object.values(PLAN_ACTOR)),
    document: Schema.NullOr(Schema.String),
    changes: Schema.Number,
    startedAt: Schema.Date,
    at: Schema.Date,
    restoredFrom: Schema.NullOr(Schema.Number),
  }),
  execute: (revision) => Database.use((db) => db.insert(planTemplateRevision).values(revision)),
});

const moveRevisionOn = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    seq: Schema.Number,
    document: Schema.NullOr(Schema.String),
    changes: Schema.Number,
    at: Schema.Date,
  }),
  execute: ({ userId, seq, ...moved }) =>
    Database.use((db) =>
      db
        .update(planTemplateRevision)
        .set(moved)
        .where(and(eq(planTemplateRevision.userId, userId), eq(planTemplateRevision.seq, seq))),
    ),
});

/** Whether a revision is the built-in default, read without its text. */
const isNullColumn = sql<boolean>`${planTemplateRevision.document} is null`;

/** The revision a restore brought back, read beside the restore that names it. */
const restored = alias(planTemplateRevision, "restored");

const RevisionLineRowSchema = Schema.Struct({
  seq: Schema.Number,
  actor: Schema.Literals(Object.values(PLAN_ACTOR)),
  isDefault: Schema.Boolean,
  changes: Schema.Number,
  startedAt: InstantColumnSchema,
  at: InstantColumnSchema,
  restoredFrom: Schema.NullOr(Schema.Number),
  restoredAt: Schema.NullOr(InstantColumnSchema),
});

/**
 * The account's template as it stood at an instant, null for the default:
 * its newest revision by then, or, before its history began, the template
 * it held then; nothing for an account with no history, whose template has
 * stood as it is. Note that a revision keeps only the text its saves left,
 * so an instant inside one reads as its latest save.
 */
export function readTemplateAt(
  userId: string,
  at: Date,
): Effect.Effect<Option.Option<string | null>, RevisionFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const held = yield* findTemplateHeldAt({ userId, at });
    const found = Option.isSome(held) ? held : yield* findFirstTemplate(userId);
    return Option.map(found, (row) => row.document);
  });
}

/**
 * A page of the account's template revisions, the newest first, before the
 * one `before` names where it names one, with one past the page read to say
 * whether an older page stands. Note that the text itself is not read, only
 * whether it is the default, because a page of lines draws no words.
 */
const findRevisionLines = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, before: Schema.NullOr(Schema.Number) }),
  Result: RevisionLineRowSchema,
  execute: ({ userId, before }) =>
    Database.use((db) =>
      db
        .select({
          seq: planTemplateRevision.seq,
          actor: planTemplateRevision.actor,
          isDefault: isNullColumn,
          changes: planTemplateRevision.changes,
          startedAt: planTemplateRevision.startedAt,
          at: planTemplateRevision.at,
          restoredFrom: planTemplateRevision.restoredFrom,
          restoredAt: restored.at,
        })
        .from(planTemplateRevision)
        .leftJoin(
          restored,
          and(
            eq(restored.userId, planTemplateRevision.userId),
            eq(restored.seq, planTemplateRevision.restoredFrom),
          ),
        )
        .where(
          and(
            eq(planTemplateRevision.userId, userId),
            before === null ? undefined : lt(planTemplateRevision.seq, before),
          ),
        )
        .orderBy(desc(planTemplateRevision.seq))
        .limit(PLAN_HISTORY_BOUNDS.PAGE + 1),
    ),
});

const RevisionContentRowSchema = Schema.Struct({
  seq: Schema.Number,
  document: Schema.NullOr(Schema.String),
});

/** The account's template at each revision named. */
const findRevisionContents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, seqs: Schema.Array(Schema.Number) }),
  Result: RevisionContentRowSchema,
  execute: ({ userId, seqs }) =>
    Database.use((db) =>
      db
        .select({ seq: planTemplateRevision.seq, document: planTemplateRevision.document })
        .from(planTemplateRevision)
        .where(
          and(
            eq(planTemplateRevision.userId, userId),
            inArray(planTemplateRevision.seq, [...seqs]),
          ),
        ),
    ),
});

const TemplateWordsRowSchema = Schema.Struct({ document: Schema.NullOr(Schema.String) });

/** The account's newest template revision whose latest save was at or before an instant. */
const findTemplateHeldAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, at: Schema.Date }),
  Result: TemplateWordsRowSchema,
  execute: ({ userId, at }) =>
    Database.use((db) =>
      db
        .select({ document: planTemplateRevision.document })
        .from(planTemplateRevision)
        .where(and(eq(planTemplateRevision.userId, userId), lte(planTemplateRevision.at, at)))
        .orderBy(desc(planTemplateRevision.seq))
        .limit(1),
    ),
});

/** The account's first template revision: the template it held when its history began. */
const findFirstTemplate = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: TemplateWordsRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ document: planTemplateRevision.document })
        .from(planTemplateRevision)
        .where(eq(planTemplateRevision.userId, userId))
        .orderBy(asc(planTemplateRevision.seq))
        .limit(1),
    ),
});

/** The template's words as they read: its own, or the default's where it holds none. */
function wordsOf(template: string | null): string {
  return template ?? DEFAULT_PLAN_TEMPLATE;
}

/**
 * Whether a write now joins the newest revision rather than starting one.
 * Note that a restore and a reset join nothing and nothing joins them,
 * because each is the one revision that undoes it, and nothing joins the
 * template from before history either.
 */
function joins(newest: RevisionRow, record: TemplateSaveRecord, now: Date): boolean {
  return (
    newest.actor === PLAN_ACTOR.DEVELOPER &&
    newest.restoredFrom === null &&
    newest.document !== null &&
    record.restoredFrom === undefined &&
    record.after !== null &&
    now.getTime() - newest.at.getTime() <= PLAN_REVISION.JOIN_WITHIN_MS
  );
}

/**
 * Records one write that changed the template: the newest revision moved on
 * where the developer wrote it lately, a new revision otherwise, after the
 * template from before history where the account has none yet. Run inside
 * the transaction that holds the account's preference row under its lock.
 */
export function recordTemplateRevision(
  record: TemplateSaveRecord,
): Effect.Effect<void, RevisionFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const { userId, before, after } = record;
    const changes = changedSections(wordsOf(before), wordsOf(after)).length;
    const newest = yield* findNewestRevision(userId);
    if (Option.isSome(newest) && joins(newest.value, record, now)) {
      return yield* moveRevisionOn({
        userId,
        seq: newest.value.seq,
        document: after,
        changes: newest.value.changes + changes,
        at: now,
      });
    }
    // The template from before history is recorded first, so this write has something to differ from.
    if (Option.isNone(newest)) {
      yield* insertRevision({
        userId,
        seq: 1,
        actor: PLAN_ACTOR.EARLIER,
        document: before,
        changes: 0,
        startedAt: now,
        at: now,
        restoredFrom: null,
      });
    }
    yield* insertRevision({
      userId,
      seq: Option.isSome(newest) ? newest.value.seq + 1 : 2,
      actor: PLAN_ACTOR.DEVELOPER,
      document: after,
      changes,
      startedAt: now,
      at: now,
      restoredFrom: record.restoredFrom ?? null,
    });
  });
}

/**
 * A page of the account's template revisions, the newest first, before the
 * revision `before` names where it names one, and what the next older page
 * is read before where one stands; none for an account with no history yet.
 */
export function listTemplateRevisions(
  userId: string,
  before?: number,
): Effect.Effect<PlanTemplateRevisionsAnswer, RevisionFailure, DatabaseServices> {
  return Effect.map(findRevisionLines({ userId, before: before ?? null }), (rows) => {
    const page = rows.slice(0, PLAN_HISTORY_BOUNDS.PAGE);
    const revisions = page.map(
      (row): PlanTemplateRevisionLine => ({
        seq: row.seq,
        lastEdit: { actor: row.actor, at: row.at.getTime(), duringCall: false },
        startedAt: row.startedAt.getTime(),
        changes: row.changes,
        ...(row.restoredFrom === null || row.restoredAt === null
          ? undefined
          : { restoredFrom: { seq: row.restoredFrom, at: row.restoredAt.getTime() } }),
        ...(row.isDefault ? { default: true } : undefined),
      }),
    );
    const oldest = page.at(-1);
    return rows.length > page.length && oldest !== undefined
      ? { revisions, earlier: oldest.seq }
      : { revisions };
  });
}

/** The account's template at one revision, null for the default; nothing where it has no such revision. */
export function readTemplateRevisionContent(
  userId: string,
  seq: number,
): Effect.Effect<Option.Option<string | null>, RevisionFailure, DatabaseServices> {
  return Effect.map(findRevisionContents({ userId, seqs: [seq] }), (rows) =>
    Option.map(Option.fromNullishOr(rows[0]), (row) => row.document),
  );
}

/**
 * One revision of the account's template as its version history shows it:
 * the template after it and before it, the first revision having nothing
 * before it, the default drawn as its words; nothing where the account has
 * no such revision.
 */
export function readTemplateRevision(
  userId: string,
  seq: number,
): Effect.Effect<
  Option.Option<PlanTemplateRevisionAnswer["revision"]>,
  RevisionFailure,
  DatabaseServices
> {
  return Effect.map(findRevisionContents({ userId, seqs: [seq - 1, seq] }), (rows) => {
    const documentAt = (at: number): PlanDocument | null => {
      const row = rows.find((each) => each.seq === at);
      return row === undefined ? null : { body: wordsOf(row.document), assumptions: [] };
    };
    const document = documentAt(seq);
    return document === null
      ? Option.none()
      : Option.some({ seq, document, previous: documentAt(seq - 1) });
  });
}
