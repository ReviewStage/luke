import { type PlanSectionWriter, planSectionWriterSchema } from "@sidecar/hosted/plan-document";
import { DEFAULT_PLAN_TEMPLATE } from "@sidecar/hosted/plan-document-template";
import {
  EMPTY_PLAN_FIELDS,
  type PlanAgentEdit,
  type PlanFieldWriter,
  planAgentEditSchema,
  planBody,
  planFieldWriterSchema,
} from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  PLAN_BOUNDS,
  type Plan,
  type PlanDocument,
  type PlanFieldEdit,
  type PlanFields,
  type PlanLastEdit,
  type PlanSectionEdit,
  type PlanSummary,
  planAssumptionSchema,
  planFieldsSchema,
} from "@sidecar/hosted/plan-wire";
import { and, desc, eq, exists, inArray, isNull } from "drizzle-orm";
import { Data, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { codingAgent } from "../db/coding-agent-schema.js";
import { plan } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import { conversations } from "../db/storage-schema.js";
import { CONVERSATION_KIND } from "../db/storage-vocabulary.js";
import { readPlanTemplate } from "./account-store.js";
import { readLastEdit, UNKNOWN_AGENT_LABEL } from "./plan-revisions.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * plan-store.ts -- the named plans an account owns, and the one document each holds.
 *
 * Every statement here names the account it runs for beside the plan, so a
 * plan id another account owns reads, saves, changes, and deletes exactly as an
 * id that names nothing: as no plan. A pin and an archive are stamps on the
 * row, so they are the account's and read alike on every Mac it signs in on. A plan's repository is kept here as
 * handed and confirmed nowhere here: whether the account reaches it through
 * the Luke GitHub App is the route's to settle before it calls, on the
 * service that reads GitHub (`github/github-app.ts`). A save is one `update` over the row that
 * stands and never an insert, so a plan deleted before a save lands stays
 * deleted, and a save that fails leaves the document as it was. A plan's
 * conversation is a `plan` conversation of the same account, opened once and
 * named on the row, and it goes with the plan: deleting the plan stamps it
 * `deleted_at`, and the conversations of the plan's coding agents with it,
 * so the purge takes their words thirty days on. Every function is an effect over the ambient `SqlClient` and names
 * no database of its own.
 */

export type PlanStoreFailure = SqlError | Schema.SchemaError;

/** What a plan store operation answers: an effect over the ambient client, composed into whatever called it. */
export type PlanStoreEffect<A> = Effect.Effect<A, PlanStoreFailure, SqlClient.SqlClient>;

/** The plan is archived, so it takes the write asked of it only once it is brought back; nothing was written. */
export class PlanArchived extends Data.TaggedError("PlanArchived") {}

/** One save a coding agent made, with the agent named as its row names it now. */
export interface LabelledAgentEdit extends PlanAgentEdit {
  readonly label: string;
}

/**
 * A plan as the service holds it: what the window reads, the fields its body
 * was formatted from or, for a plan that is one document, its text, the saves
 * coding agents made with their notes, and the conversation it resumes in, if
 * one is attached.
 */
export interface StoredPlan {
  readonly plan: Plan;
  /** The fixed template's fields; the untouched template's for a plan that is one document, which keeps none. */
  readonly fields: PlanFields;
  /** The whole text of a plan that is one document; undefined for a plan still kept as the template's fields. */
  readonly text: string | undefined;
  readonly agentEdits: readonly LabelledAgentEdit[];
  readonly conversationId: string | undefined;
  /** Whether the document was ever saved: false for a plan untouched since it started, or since the template's reset. */
  readonly saved: boolean;
  /** Who last changed each field a save has changed since this was kept; none for a plan that is one document. */
  readonly fieldWriters: readonly PlanFieldWriter[];
  /** Who last changed each section of a plan that is one document; none for any other plan. */
  readonly sectionWriters: readonly PlanSectionWriter[];
}

/** A plan to start: its name, and the repository it is about where one is chosen. */
export interface NewPlan {
  readonly name: string;
  readonly repository?: string | null;
}

/** What a change to a plan names: a new name, a repository or null to clear it, pinned or not, archived or not, or any of them at once. */
export interface PlanChanges {
  readonly name?: string;
  readonly repository?: string | null;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}

/**
 * The columns a line of the list reads: none of the document. Note that the
 * list projects these alone, because a migration that reshapes the document
 * lands before the build that reads the new shape is live, and a list that
 * decoded the document would then refuse every plan rather than just the one
 * opened.
 */
const PLAN_SUMMARY_COLUMNS = {
  id: plan.id,
  name: plan.name,
  repository: plan.repository,
  pinnedAt: plan.pinnedAt,
  archivedAt: plan.archivedAt,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
};

/** The columns every other read and every `returning` projects, so a row decodes one way whatever wrote it. */
const PLAN_COLUMNS = {
  ...PLAN_SUMMARY_COLUMNS,
  userId: plan.userId,
  body: plan.body,
  assumptions: plan.assumptions,
  fields: plan.fields,
  agentEdits: plan.agentEdits,
  fieldWriters: plan.fieldWriters,
  document: plan.document,
  sectionWriters: plan.sectionWriters,
  conversationId: plan.conversationId,
};

const PlanSummaryRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  repository: Schema.NullOr(Schema.String),
  pinnedAt: Schema.NullOr(InstantColumnSchema),
  archivedAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
  updatedAt: InstantColumnSchema,
});

type PlanSummaryRow = typeof PlanSummaryRowSchema.Type;

const PlanRowSchema = Schema.Struct({
  ...PlanSummaryRowSchema.fields,
  userId: Schema.String,
  body: Schema.String,
  assumptions: Schema.Array(planAssumptionSchema),
  fields: Schema.NullOr(planFieldsSchema),
  agentEdits: Schema.Array(planAgentEditSchema),
  fieldWriters: Schema.Array(planFieldWriterSchema),
  document: Schema.NullOr(Schema.String),
  sectionWriters: Schema.Array(planSectionWriterSchema),
  conversationId: Schema.NullOr(Schema.String),
});

type PlanRow = typeof PlanRowSchema.Type;

const PlanKeySchema = Schema.Struct({ userId: Schema.String, planId: Schema.String });

const PlanIdRowSchema = Schema.Struct({ id: Schema.String });

/** The agents the journal names, as their rows name them now; a row that is gone names nothing. */
const findAgentLabels = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    model: Schema.String,
    title: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, agentIds }) =>
    db
      .select({ id: codingAgent.id, model: codingAgent.model, title: codingAgent.title })
      .from(codingAgent)
      .where(and(eq(codingAgent.userId, userId), inArray(codingAgent.id, agentIds))),
});

/**
 * The agents the journal and the fields' writers name, by id, as their rows
 * name them now, so a renamed agent reads renamed everywhere: the label is
 * the row's title, or its model while it has none. The row's own account is
 * the one they are read under.
 */
function agentLabelsOf(row: PlanRow): PlanStoreEffect<ReadonlyMap<string, string>> {
  const writers = [...row.fieldWriters, ...row.sectionWriters];
  const named = [
    ...row.agentEdits.map((edit) => edit.agentId),
    ...writers.flatMap((writer) => (writer.agentId === undefined ? [] : [writer.agentId])),
  ];
  const agentIds = [...new Set(named)];
  if (agentIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findAgentLabels({ userId: row.userId, agentIds }),
    (agents) => new Map(agents.map((agent) => [agent.id, agent.title ?? agent.model])),
  );
}

/**
 * Who made a save, as a section's line reads it: a coding agent named by its
 * label, or as an agent whose row is gone, or whose writer was kept before
 * agents were.
 */
function editOf(
  writer: PlanFieldWriter | PlanSectionWriter,
  labels: ReadonlyMap<string, string>,
): PlanLastEdit {
  const { actor, at } = writer;
  const label = writer.agentId === undefined ? undefined : labels.get(writer.agentId);
  return {
    actor,
    ...(actor === PLAN_ACTOR.AGENT ? { label: label ?? UNKNOWN_AGENT_LABEL } : undefined),
    at,
    duringCall: writer.duringCall === true,
  };
}

/** Who last changed one field, as the window's section lines read it. */
function fieldEditOf(writer: PlanFieldWriter, labels: ReadonlyMap<string, string>): PlanFieldEdit {
  return { field: writer.field, ...editOf(writer, labels) };
}

/** Who last changed one section of a document plan, as its line reads it. */
function sectionEditOf(
  writer: PlanSectionWriter,
  labels: ReadonlyMap<string, string>,
): PlanSectionEdit {
  return { section: writer.section, ...editOf(writer, labels) };
}

/**
 * The document and the writers the window reads for the row. Note that a plan
 * that is one document answers its text as the body with no assumptions and
 * no fields, because every desktop edits a field only where `fields` stands,
 * so a build that knows nothing of documents draws the text and edits
 * nothing; a plan still kept as fields answers as it always has, its empty
 * body formatted from the fields so it is always the current template's.
 */
function documentOf(
  row: PlanRow,
  name: string,
  labels: ReadonlyMap<string, string>,
): Pick<Plan, "document" | "fields" | "fieldEdits" | "sectionEdits"> {
  if (row.document !== null) {
    return {
      document: { body: row.document, assumptions: [] },
      sectionEdits: row.sectionWriters.map((writer) => sectionEditOf(writer, labels)),
    };
  }
  const fields = row.fields ?? EMPTY_PLAN_FIELDS;
  return {
    document: {
      body: row.body === "" ? planBody({ name }, fields) : row.body,
      assumptions: row.assumptions,
    },
    fields,
    fieldEdits: row.fieldWriters.map((writer) => fieldEditOf(writer, labels)),
  };
}

/**
 * A coding agent's save from the journal as a plan's last edit, for a plan
 * whose history has not begun: an agent's save made before it is the newest
 * thing the service can name a writer for.
 */
function journaledEdit(edit: LabelledAgentEdit): PlanLastEdit {
  return { actor: PLAN_ACTOR.AGENT, label: edit.label, at: edit.at, duringCall: false };
}

/**
 * The row's document, as the window and the model read it (`documentOf`).
 * The row's own account is the one its agents are read under. Its last edit
 * is its newest revision, or, before its history begins, the newest save a
 * coding agent made; each field or section it has a writer for says who.
 */
function storedPlanOf(row: PlanRow): PlanStoreEffect<StoredPlan> {
  return Effect.gen(function* () {
    const summary = summaryOf(row);
    const isDocument = row.document !== null;
    const labels = yield* agentLabelsOf(row);
    const agentEdits = row.agentEdits.map((edit) => ({
      ...edit,
      label: labels.get(edit.agentId) ?? UNKNOWN_AGENT_LABEL,
    }));
    const lastEdit = Option.orElse(yield* readLastEdit(row.id), () =>
      Option.map(Option.fromUndefinedOr(agentEdits.at(-1)), journaledEdit),
    );
    return {
      plan: {
        ...summary,
        agentEdits: agentEdits.map(({ agentId, label, at }) => ({ agentId, label, at })),
        ...(Option.isSome(lastEdit) ? { lastEdit: lastEdit.value } : undefined),
        ...documentOf(row, summary.name, labels),
      },
      fields: isDocument ? EMPTY_PLAN_FIELDS : (row.fields ?? EMPTY_PLAN_FIELDS),
      text: row.document ?? undefined,
      agentEdits,
      conversationId: row.conversationId ?? undefined,
      saved: row.fields !== null,
      fieldWriters: isDocument ? [] : row.fieldWriters,
      sectionWriters: row.sectionWriters,
    };
  });
}

/** The row's plan alone, for the writes that answer one. */
function planOf(row: PlanRow): PlanStoreEffect<Plan> {
  return Effect.map(storedPlanOf(row), (stored) => stored.plan);
}

/**
 * The row as one line of the list. Note that `openedAt` is still answered,
 * as the start, because a desktop through v0.7.1 refuses a summary without it.
 * It goes once a release whose decoder treats it as optional has shipped and
 * v0.7.1 is no longer supported. A pin and an archive are answered only where
 * they stand, so a plan that is neither reads as every plan did before them.
 */
function summaryOf(row: PlanSummaryRow): PlanSummary {
  const createdAt = row.createdAt.getTime();
  return {
    id: row.id,
    name: row.name,
    createdAt,
    updatedAt: row.updatedAt.getTime(),
    repository: row.repository,
    openedAt: createdAt,
    ...(row.pinnedAt === null ? undefined : { pinnedAt: row.pinnedAt.getTime() }),
    ...(row.archivedAt === null ? undefined : { archivedAt: row.archivedAt.getTime() }),
  };
}

/** The account's plan, when it owns one under this id. */
function ownedPlan(userId: string, planId: string) {
  return and(eq(plan.id, planId), eq(plan.userId, userId));
}

const insertPlan = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    repository: Schema.NullOr(Schema.String),
    document: Schema.String,
    now: Schema.Date,
  }),
  Result: PlanRowSchema,
  execute: (write) =>
    db
      .insert(plan)
      .values({
        userId: write.userId,
        name: write.name,
        repository: write.repository,
        document: write.document,
        assumptions: [],
        createdAt: write.now,
        updatedAt: write.now,
      })
      .returning(PLAN_COLUMNS),
});

const findPlans = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, includeArchived: Schema.Boolean }),
  Result: PlanSummaryRowSchema,
  execute: ({ userId, includeArchived }) =>
    db
      .select(PLAN_SUMMARY_COLUMNS)
      .from(plan)
      .where(and(eq(plan.userId, userId), includeArchived ? undefined : isNull(plan.archivedAt)))
      .orderBy(desc(plan.createdAt), desc(plan.id)),
});

const findPlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: PlanRowSchema,
  execute: ({ userId, planId }) =>
    db.select(PLAN_COLUMNS).from(plan).where(ownedPlan(userId, planId)).limit(1),
});

const replaceDocument = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    body: Schema.String,
    assumptions: Schema.Array(planAssumptionSchema),
    fields: Schema.optionalKey(planFieldsSchema),
    agentEdits: Schema.optionalKey(Schema.Array(planAgentEditSchema)),
    fieldWriters: Schema.optionalKey(Schema.Array(planFieldWriterSchema)),
    now: Schema.Date,
  }),
  Result: PlanRowSchema,
  execute: ({ userId, planId, body, assumptions, fields, agentEdits, fieldWriters, now }) =>
    db
      .update(plan)
      .set({
        body,
        assumptions,
        ...(fields ? { fields } : undefined),
        ...(agentEdits ? { agentEdits } : undefined),
        ...(fieldWriters ? { fieldWriters } : undefined),
        updatedAt: now,
      })
      .where(ownedPlan(userId, planId))
      .returning(PLAN_COLUMNS),
});

const replaceText = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    text: Schema.String,
    sectionWriters: Schema.optionalKey(Schema.Array(planSectionWriterSchema)),
    agentEdits: Schema.optionalKey(Schema.Array(planAgentEditSchema)),
    now: Schema.Date,
  }),
  Result: PlanRowSchema,
  execute: ({ userId, planId, text, sectionWriters, agentEdits, now }) =>
    db
      .update(plan)
      .set({
        document: text,
        ...(sectionWriters ? { sectionWriters } : undefined),
        ...(agentEdits ? { agentEdits } : undefined),
        updatedAt: now,
      })
      .where(ownedPlan(userId, planId))
      .returning(PLAN_COLUMNS),
});

/** The plan row under its own lock, so a rename and a save of notes each format the body the other cannot replace meanwhile. */
const lockPlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: PlanRowSchema,
  execute: ({ userId, planId }) =>
    db.select(PLAN_COLUMNS).from(plan).where(ownedPlan(userId, planId)).for("update"),
});

/** The row changed: whichever of the name, the body, the repository, the pin, and the archive the change names, in one statement. */
const applyChanges = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    name: Schema.optionalKey(Schema.String),
    body: Schema.optionalKey(Schema.String),
    repository: Schema.optionalKey(Schema.NullOr(Schema.String)),
    pinnedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
    archivedAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
  }),
  Result: PlanRowSchema,
  execute: ({ userId, planId, ...changes }) =>
    db.update(plan).set(changes).where(ownedPlan(userId, planId)).returning(PLAN_COLUMNS),
});

const findPlanOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: PlanRowSchema,
  execute: ({ userId, conversationId }) =>
    db
      .select(PLAN_COLUMNS)
      .from(plan)
      .where(and(eq(plan.userId, userId), eq(plan.conversationId, conversationId)))
      .limit(1),
});

const PlanConversationRowSchema = Schema.Struct({
  conversationId: Schema.NullOr(Schema.String),
  conversationDeletedAt: Schema.NullOr(InstantColumnSchema),
});

/** The plan row under its own lock, with the conversation it names and whether that conversation still stands. */
const lockPlanConversation = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: PlanConversationRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select({
        conversationId: plan.conversationId,
        conversationDeletedAt: conversations.deletedAt,
      })
      .from(plan)
      .leftJoin(conversations, eq(conversations.id, plan.conversationId))
      .where(ownedPlan(userId, planId))
      .for("update", { of: plan }),
});

const insertPlanConversation = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  Result: PlanIdRowSchema,
  execute: ({ userId, now }) =>
    db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.PLAN, createdAt: now, lastActivityAt: now })
      .returning({ id: conversations.id }),
});

const removePlan = SqlSchema.findOneOption({
  Request: PlanKeySchema,
  Result: Schema.Struct({ conversationId: Schema.NullOr(Schema.String) }),
  execute: ({ userId, planId }) =>
    db
      .delete(plan)
      .where(ownedPlan(userId, planId))
      .returning({ conversationId: plan.conversationId }),
});

const stampConversations = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationIds: Schema.Array(Schema.String),
    now: Schema.Date,
  }),
  Result: PlanIdRowSchema,
  execute: ({ userId, conversationIds, now }) =>
    db
      .update(conversations)
      .set({ deletedAt: now })
      .where(
        and(
          inArray(conversations.id, conversationIds),
          eq(conversations.userId, userId),
          isNull(conversations.deletedAt),
        ),
      )
      .returning({ id: conversations.id }),
});

/** The conversations of the plan's coding agents, read before the delete cascades the rows that name them. */
const findAgentConversations = SqlSchema.findAll({
  Request: PlanKeySchema,
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ userId, planId }) =>
    db
      .select({ conversationId: codingAgent.conversationId })
      .from(codingAgent)
      .where(and(eq(codingAgent.planId, planId), eq(codingAgent.userId, userId))),
});

/**
 * Only a standing conversation of the same account may be attached, so the
 * association can name nothing the plan's owner could not read themselves.
 */
const setConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    planId: Schema.String,
    conversationId: Schema.String,
  }),
  Result: PlanIdRowSchema,
  execute: ({ userId, planId, conversationId }) =>
    db
      .update(plan)
      .set({ conversationId })
      .where(
        and(
          ownedPlan(userId, planId),
          exists(
            db
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.id, conversationId),
                  eq(conversations.userId, userId),
                  isNull(conversations.deletedAt),
                ),
              ),
          ),
        ),
      )
      .returning({ id: plan.id }),
});

/**
 * Starts a plan under the account as one document, a copy of the account's
 * own template or the default where it keeps none, with the repository it
 * was handed; it stands first in the list. Note that the template is copied,
 * not referred to, because an edit of the template must leave every plan
 * started from it as it stands.
 */
export function createPlan(userId: string, started: NewPlan): PlanStoreEffect<Plan> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const template = yield* readPlanTemplate(userId);
    const row = yield* insertPlan({
      userId,
      name: started.name,
      repository: started.repository ?? null,
      document: template ?? DEFAULT_PLAN_TEMPLATE,
      now,
    }).pipe(
      // An insert that returned no row is the database breaking its own contract, not an outcome.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return yield* planOf(row);
  });
}

/**
 * Every plan the account owns, newest started first, without their documents,
 * and without the archived ones unless `includeArchived` asks for them.
 * Nothing but starting a plan moves the order: opening, reading, saving,
 * pinning, and archiving one leave every row where it stood, and the order a
 * pin draws is the window's to draw from `pinnedAt`.
 */
export function listPlans(
  userId: string,
  options: { readonly includeArchived?: boolean } = {},
): PlanStoreEffect<readonly PlanSummary[]> {
  return Effect.map(
    findPlans({ userId, includeArchived: options.includeArchived === true }),
    (rows) => rows.map(summaryOf),
  );
}

/**
 * The plan with its saved document and its conversation, or nothing for a
 * plan the account does not own. This is the read the window opens a plan
 * through and the planning model starts and resumes from.
 */
export function readPlan(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<StoredPlan>> {
  return Effect.flatMap(findPlan({ userId, planId }), (found) =>
    Effect.transposeOption(Option.map(found, storedPlanOf)),
  );
}

/**
 * The plan as `readPlan` reads it, held under the row's lock until the
 * enclosing transaction ends, so a save formatted from it is not crossed by
 * a rename.
 */
export function readPlanForUpdate(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<StoredPlan>> {
  return Effect.flatMap(lockPlan({ userId, planId }), (locked) =>
    Effect.transposeOption(Option.map(locked, storedPlanOf)),
  );
}

/** What a save writes beside the document, each where it is handed. */
export interface PlanSaveExtras {
  /** The fields the body was formatted from. */
  readonly fields?: PlanFields;
  /** The coding agents' journal. */
  readonly agentEdits?: readonly PlanAgentEdit[];
  /** Who last changed each field. */
  readonly fieldWriters?: readonly PlanFieldWriter[];
}

/**
 * Replaces the plan's document whole, with the fields its body was formatted
 * from, the agents' journal, and the fields' writers where they are handed,
 * and answers it as saved, or nothing where the account owns no such plan;
 * nothing is ever created here.
 */
export function savePlanDocument(
  userId: string,
  planId: string,
  document: PlanDocument,
  extras: PlanSaveExtras = {},
): PlanStoreEffect<Option.Option<Plan>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const row = yield* replaceDocument({
      userId,
      planId,
      body: document.body,
      assumptions: document.assumptions,
      ...extras,
      now,
    });
    return yield* Effect.transposeOption(Option.map(row, planOf));
  });
}

/** What a save of a document plan's text writes beside it, each where it is handed. */
export interface PlanTextSaveExtras {
  /** Who last changed each section. */
  readonly sectionWriters?: readonly PlanSectionWriter[];
  /** The coding agents' journal. */
  readonly agentEdits?: readonly PlanAgentEdit[];
}

/**
 * Replaces the text of a plan that is one document, with who last changed
 * each section and the agents' journal where they are handed, and answers
 * the plan as saved, or nothing where the account owns no such plan; nothing
 * is ever created here.
 */
export function savePlanText(
  userId: string,
  planId: string,
  text: string,
  extras: PlanTextSaveExtras = {},
): PlanStoreEffect<Option.Option<Plan>> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const row = yield* replaceText({ userId, planId, text, ...extras, now });
    return yield* Effect.transposeOption(Option.map(row, planOf));
  });
}

/**
 * The body a renamed plan keeps. Note that only a body formatted from the
 * stored fields under the old name, as the formatter writes it now or wrote
 * it before it dropped a rule's list markers, is formatted again under the
 * new one, because its heading is the name; an empty body already reads as the
 * template under whatever name stands, and any other body, or one the longer
 * heading would carry past the body's bound, is left as saved until the next
 * save of notes formats it.
 */
function retitledBody(row: PlanRow, name: string): string {
  if (row.body === "" || row.fields === null) return row.body;
  if (row.body !== planBody({ name: row.name }, row.fields)) return row.body;
  const retitled = planBody({ name }, row.fields);
  return retitled.length > PLAN_BOUNDS.MAX_BODY_CHARS ? row.body : retitled;
}

/**
 * The instant a pin or an archive stands from after a change: now where it
 * is asked for, the one already standing where it already was, so asking
 * twice moves nothing, and none where it is taken away.
 */
function stampOf(asked: boolean, standing: Date | null, now: Date): Date | null {
  if (!asked) return null;
  return standing ?? now;
}

/**
 * Changes the plan, a new name with its document's heading, a repository or
 * none, pinned or not, archived or not, and answers it as changed, or nothing
 * where the account owns no such plan. The changes arrive already read under
 * the wire's rules, and a repository already confirmed reachable. A change is
 * not a save: the document's `updatedAt` and the list's order stand. A pin
 * and an archive are kept apart, so a pinned plan archived and brought back
 * is pinned again. An archived plan is neither renamed nor given another
 * repository, read under the same lock, unless the same change brings it
 * back; its pin and its archive still change.
 */
export function updatePlan(
  userId: string,
  planId: string,
  changes: PlanChanges,
): Effect.Effect<Option.Option<Plan>, PlanStoreFailure | PlanArchived, SqlClient.SqlClient> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockPlan({ userId, planId });
        if (Option.isNone(locked)) return Option.none();
        const stillArchived = locked.value.archivedAt !== null && changes.archived !== false;
        const reworded = changes.name !== undefined || changes.repository !== undefined;
        if (stillArchived && reworded) return yield* new PlanArchived();
        const now = yield* DateTime.nowAsDate;
        const row = yield* applyChanges({
          userId,
          planId,
          ...(changes.name === undefined
            ? undefined
            : { name: changes.name, body: retitledBody(locked.value, changes.name) }),
          ...(changes.repository === undefined ? undefined : { repository: changes.repository }),
          ...(changes.pinned === undefined
            ? undefined
            : { pinnedAt: stampOf(changes.pinned, locked.value.pinnedAt, now) }),
          ...(changes.archived === undefined
            ? undefined
            : { archivedAt: stampOf(changes.archived, locked.value.archivedAt, now) }),
        }).pipe(
          // The row is held under this transaction's lock, so an update that missed it is the database breaking its own contract.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        return Option.some(yield* planOf(row));
      }),
    ),
  );
}

/**
 * Deletes the plan and its document, and stamps its conversation and its
 * coding agents' conversations cleared; false where the account owned no
 * such plan. The agents' conversations are read before the delete, because
 * the delete cascades the agent rows that name them.
 */
export function deletePlan(userId: string, planId: string): PlanStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const agents = yield* findAgentConversations({ userId, planId });
        const removed = yield* removePlan({ userId, planId });
        if (Option.isNone(removed)) return false;
        const { conversationId } = removed.value;
        const conversationIds = [
          ...(conversationId === null ? [] : [conversationId]),
          ...agents.map((agent) => agent.conversationId),
        ];
        if (conversationIds.length > 0) {
          const now = yield* DateTime.nowAsDate;
          yield* stampConversations({ userId, conversationIds, now });
        }
        return true;
      }),
    ),
  );
}

/**
 * Names the conversation the plan resumes in. False, and nothing written,
 * where the account owns no such plan or no such standing conversation.
 */
export function attachPlanConversation(
  userId: string,
  planId: string,
  conversationId: string,
): PlanStoreEffect<boolean> {
  return Effect.map(setConversation({ userId, planId, conversationId }), Option.isSome);
}

/**
 * The conversation the plan's planning model runs in, opened and attached
 * now where the plan names none that still stands; nothing where the account
 * owns no such plan. The plan row's lock holds two opens of one plan one
 * after the other, so the second finds the first's conversation rather than
 * opening another.
 */
export function openPlanConversation(
  userId: string,
  planId: string,
): PlanStoreEffect<Option.Option<string>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockPlanConversation({ userId, planId });
        if (Option.isNone(locked)) return Option.none();
        const { conversationId, conversationDeletedAt } = locked.value;
        if (conversationId !== null && conversationDeletedAt === null) {
          return Option.some(conversationId);
        }
        const now = yield* DateTime.nowAsDate;
        const opened = yield* insertPlanConversation({ userId, now }).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        if (!(yield* attachPlanConversation(userId, planId, opened.id))) {
          return yield* Effect.die(new Error("the plan's new conversation did not attach"));
        }
        return Option.some(opened.id);
      }),
    ),
  );
}

/**
 * The plan a conversation of the account belongs to, with its saved document;
 * nothing for a conversation no plan of the account names. This is how a
 * planning turn, admitted for a conversation, finds the document it is handed
 * and the plan whose repository its reads are bound to.
 */
export function readPlanOfConversation(
  userId: string,
  conversationId: string,
): PlanStoreEffect<Option.Option<StoredPlan>> {
  return Effect.flatMap(findPlanOfConversation({ userId, conversationId }), (found) =>
    Effect.transposeOption(Option.map(found, storedPlanOf)),
  );
}
